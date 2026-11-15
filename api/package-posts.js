import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CODE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/
const POST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PAYLOAD_LENGTH = 4_000_000
const MAX_ROWS = 50_000

function getClient(environment) {
  const url = environment.SUPABASE_URL?.trim() || environment.VITE_SUPABASE_URL?.trim()
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getOwnerHash(request) {
  const code = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!code || !CODE_PATTERN.test(code)) return null
  return createHash('sha256').update(code).digest('hex')
}

async function getCanonicalOwnerHash(client, keyHash) {
  const { data, error } = await client
    .from('history_key_aliases')
    .select('owner_key_hash')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error?.code === '42P01' || error?.code === 'PGRST205') return keyHash
  if (error) throw error
  return data?.owner_key_hash || keyHash
}

function validatePost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Post valid package results.'
  }
  if (JSON.stringify(body).length > MAX_PAYLOAD_LENGTH) {
    return 'This result is too large to save. Try a smaller workbook.'
  }
  if (
    typeof body.file_name !== 'string'
    || body.file_name.length === 0
    || body.file_name.length > 255
    || !Array.isArray(body.headers)
    || body.headers.length !== 3
    || body.headers.some((header) => typeof header !== 'string' || header.length > 200)
    || !Number.isInteger(body.id_column_index)
    || body.id_column_index < 0
    || body.id_column_index > 2
    || !body.groups
    || typeof body.groups !== 'object'
    || Array.isArray(body.groups)
  ) {
    return 'Package result data is invalid.'
  }

  const starts = ['100', '200', '300', '400', '500', '600', '700', '800']
  let totalPackages = 0
  for (const start of starts) {
    const rows = body.groups[start]
    if (!Array.isArray(rows) || rows.some((row) => (
      !Array.isArray(row)
      || row.length !== 3
      || row.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    ))) {
      return 'Package group data is invalid.'
    }
    totalPackages += rows.length
  }
  if (totalPackages > MAX_ROWS) return 'This result contains too many rows to save.'
  if (body.total_packages !== totalPackages) return 'Package total does not match the saved groups.'

  return null
}

export default async function handler(request, response, environment = process.env) {
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE')
    return response.status(405).json({ error: 'Use GET, POST, or DELETE for package history.' })
  }

  const keyHash = getOwnerHash(request)
  if (!keyHash) return response.status(401).json({ error: 'Enter a valid history access code.' })

  const client = getClient(environment)
  if (!client) {
    return response.status(503).json({
      error: 'Cloud history is not configured. Add the server-side Supabase URL and service role key.',
    })
  }

  try {
    const ownerHash = await getCanonicalOwnerHash(client, keyHash)
    if (request.method === 'GET') {
      const { data, error } = await client
        .from('package_posts')
        .select('id, saved_at, file_name, headers, id_column_index, groups, total_packages')
        .eq('owner_key_hash', ownerHash)
        .order('saved_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return response.status(200).json(data)
    }

    if (request.method === 'POST') {
      const validationError = validatePost(request.body)
      if (validationError) return response.status(400).json({ error: validationError })

      const { data, error } = await client
        .from('package_posts')
        .insert({
          file_name: request.body.file_name,
          headers: request.body.headers,
          id_column_index: request.body.id_column_index,
          groups: request.body.groups,
          total_packages: request.body.total_packages,
          owner_key_hash: ownerHash,
          user_id: null,
        })
        .select('id, saved_at, file_name, headers, id_column_index, groups, total_packages')
        .single()
      if (error) throw error
      return response.status(201).json(data)
    }

    const postId = request.query?.id
    if (typeof postId !== 'string' || !POST_ID_PATTERN.test(postId)) {
      return response.status(400).json({ error: 'Select a valid posted result to delete.' })
    }
    const { data, error } = await client
      .from('package_posts')
      .delete()
      .eq('id', postId)
      .eq('owner_key_hash', ownerHash)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return response.status(404).json({ error: 'Posted result was not found.' })
    return response.status(200).json({ id: data.id })
  } catch (error) {
    console.error('Package history request failed:', error)
    return response.status(500).json({ error: 'Cloud history request failed. Please try again.' })
  }
}
