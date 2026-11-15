import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const HISTORY_CODE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/i
const PIN_PATTERN = /^\d{4}$/
const REQUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/
const PAIRING_TTL_MINUTES = 5

function getClient(environment) {
  const url = environment.SUPABASE_URL?.trim() || environment.VITE_SUPABASE_URL?.trim()
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null

  return {
    client: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    serviceRoleKey,
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hashPin(pin, pepper) {
  return createHmac('sha256', pepper).update(pin).digest('hex')
}

function getBearerToken(request) {
  return request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
}

async function getOwnerHash(client, code) {
  if (!HISTORY_CODE_PATTERN.test(code)) return null
  const keyHash = hash(code)
  const { data, error } = await client
    .from('history_key_aliases')
    .select('owner_key_hash')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error) throw error
  return data?.owner_key_hash || keyHash
}

function invalidPin(response) {
  return response.status(400).json({ error: 'That PIN is invalid or has expired. Create a new PIN on the other device.' })
}

export default async function handler(request, response, environment = process.env) {
  const allowedMethods = ['GET', 'POST']
  if (!allowedMethods.includes(request.method)) {
    response.setHeader('Allow', allowedMethods.join(', '))
    return response.status(405).json({ error: 'Use GET or POST for device pairing.' })
  }

  const configured = getClient(environment)
  if (!configured) {
    return response.status(503).json({
      error: 'Device pairing is not configured. Add the server-side Supabase URL and service role key.',
    })
  }

  const { client, serviceRoleKey } = configured
  try {
    if (request.method === 'GET') {
      const action = request.query?.action
      if (action === 'status') {
        const requestToken = getBearerToken(request)
        if (!REQUEST_TOKEN_PATTERN.test(requestToken)) {
          return response.status(401).json({ error: 'The pairing request is invalid or has expired.' })
        }
        const { data, error } = await client
          .from('history_pairing_requests')
          .select('approved_at, rejected_at, session:history_pairing_sessions(expires_at)')
          .eq('request_token_hash', hash(requestToken))
          .maybeSingle()
        if (error) throw error
        if (!data) return response.status(404).json({ error: 'The pairing request was not found.' })
        if (data.rejected_at) return response.status(200).json({ status: 'rejected' })
        if (new Date(data.session.expires_at) <= new Date()) {
          return response.status(200).json({ status: 'expired' })
        }
        return response.status(200).json({ status: data.approved_at ? 'approved' : 'pending' })
      }

      return response.status(400).json({ error: 'Select a valid pairing action.' })
    }

    const { action } = request.body || {}
    if (action === 'request') {
      const { pin, new_key_hash: newKeyHash, verification_code: verificationCode } = request.body
      if (
        typeof pin !== 'string'
        || !PIN_PATTERN.test(pin)
        || typeof newKeyHash !== 'string'
        || !HASH_PATTERN.test(newKeyHash)
        || typeof verificationCode !== 'string'
        || !PIN_PATTERN.test(verificationCode)
      ) {
        return response.status(400).json({ error: 'Enter the four-digit PIN and retry pairing.' })
      }
      const requestToken = randomBytes(32).toString('base64url')
      const { data, error } = await client.rpc('request_history_pairing', {
        p_pin_hash: hashPin(pin, serviceRoleKey),
        p_request_token_hash: hash(requestToken),
        p_new_key_hash: newKeyHash.toLowerCase(),
        p_verification_code: verificationCode,
      })
      if (error) throw error
      if (!data) return invalidPin(response)
      return response.status(201).json({ request_token: requestToken })
    }

    const code = getBearerToken(request)
    const ownerKeyHash = await getOwnerHash(client, code)
    if (!ownerKeyHash) return response.status(401).json({ error: 'Enter a valid history access code.' })

    if (action === 'requests') {
      const { pin } = request.body
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return invalidPin(response)

      const { data: pairingSession, error: sessionError } = await client
        .from('history_pairing_sessions')
        .select('id')
        .eq('pin_hash', hashPin(pin, serviceRoleKey))
        .eq('owner_key_hash', ownerKeyHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!pairingSession) return invalidPin(response)

      const { data, error } = await client
        .from('history_pairing_requests')
        .select('id, verification_code, created_at')
        .eq('session_id', pairingSession.id)
        .is('approved_at', null)
        .is('rejected_at', null)
        .order('created_at', { ascending: true })
      if (error) throw error
      return response.status(200).json(data)
    }

    if (action === 'start') {
      const { error: expiredSessionError } = await client
        .from('history_pairing_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString())
      if (expiredSessionError) throw expiredSessionError

      const { error: revokeSessionError } = await client
        .from('history_pairing_sessions')
        .update({ expires_at: new Date().toISOString() })
        .eq('owner_key_hash', ownerKeyHash)
        .gt('expires_at', new Date().toISOString())
      if (revokeSessionError) throw revokeSessionError

      const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString()
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const pin = String(randomInt(0, 10000)).padStart(4, '0')
        const { error } = await client
          .from('history_pairing_sessions')
          .insert({
            id: randomUUID(),
            pin_hash: hashPin(pin, serviceRoleKey),
            owner_key_hash: ownerKeyHash,
            expires_at: expiresAt,
          })
        if (!error) return response.status(201).json({ pin, expires_at: expiresAt })
        if (error.code !== '23505') throw error
      }
      return response.status(503).json({ error: 'Could not create a unique pairing PIN. Try again.' })
    }

    if (action === 'approve' || action === 'reject') {
      const { pin, request_id: requestId } = request.body
      if (
        typeof pin !== 'string'
        || !PIN_PATTERN.test(pin)
        || typeof requestId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      ) {
        return response.status(400).json({ error: 'Select a valid device pairing request.' })
      }
      const { data: pairingSession, error: sessionError } = await client
        .from('history_pairing_sessions')
        .select('id')
        .eq('pin_hash', hashPin(pin, serviceRoleKey))
        .eq('owner_key_hash', ownerKeyHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!pairingSession) return invalidPin(response)

      if (action === 'approve') {
        const { data, error } = await client.rpc('approve_history_pairing', {
          p_request_id: requestId,
          p_owner_key_hash: ownerKeyHash,
        })
        if (error) throw error
        if (!data) return response.status(404).json({ error: 'This pairing request has expired or was already handled.' })
        return response.status(200).json({ status: 'approved' })
      }

      const { data, error } = await client
        .from('history_pairing_requests')
        .update({ rejected_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('session_id', pairingSession.id)
        .is('approved_at', null)
        .is('rejected_at', null)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) return response.status(404).json({ error: 'This pairing request has expired or was already handled.' })
      return response.status(200).json({ status: 'rejected' })
    }

    return response.status(400).json({ error: 'Select a valid pairing action.' })
  } catch (error) {
    console.error('Device pairing request failed:', error)
    if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code)) {
      return response.status(503).json({
        error: 'Apply the PIN pairing SQL migration in Supabase before pairing devices.',
      })
    }
    return response.status(500).json({ error: 'Device pairing failed. Please try again.' })
  }
}
