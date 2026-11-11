const STATE_CODE_PATTERN = /^[A-Z]{2}$/
const ZIP_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/
const MAX_FIELD_LENGTH = 100
const TOKEN_SAFETY_WINDOW_SECONDS = 60

let cachedToken
let tokenExpiresAt = 0
let cachedTokenBaseUrl

function normalizeAddress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Enter an address to verify.' }
  }

  const address = {
    streetAddress: String(input.streetAddress || '').trim(),
    apartment: String(input.apartment || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim().toUpperCase(),
    postalCode: String(input.postalCode || '').trim(),
  }

  if (!address.streetAddress || !address.city || !address.state || !address.postalCode) {
    return { error: 'Enter the street, city, state, and ZIP code before checking.' }
  }

  if (
    address.streetAddress.length > MAX_FIELD_LENGTH
    || address.apartment.length > MAX_FIELD_LENGTH
    || address.city.length > MAX_FIELD_LENGTH
    || !STATE_CODE_PATTERN.test(address.state)
    || !ZIP_CODE_PATTERN.test(address.postalCode)
  ) {
    return { error: 'Check the address fields and enter a valid state and ZIP code.' }
  }

  return { address }
}

function isFedexTrue(value) {
  return value === true || value === 'true'
}

function isFedexFalse(value) {
  return value === false || value === 'false'
}

async function getAccessToken(clientId, clientSecret, baseUrl) {
  if (cachedToken && cachedTokenBaseUrl === baseUrl && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  let response
  try {
    response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    return {
      error: error.name === 'TimeoutError'
        ? 'FedEx authentication took too long. Please try again.'
        : 'Could not reach FedEx authentication. Check your connection and try again.',
      status: error.name === 'TimeoutError' ? 504 : 502,
    }
  }

  if (!response.ok) {
    return {
      error: response.status === 401 || response.status === 403
        ? 'FedEx rejected the server credentials. Check the configured API credentials.'
        : 'FedEx authentication failed. Please try again later.',
      status: 502,
    }
  }

  let data
  try {
    data = await response.json()
  } catch {
    return { error: 'FedEx returned an unreadable authentication response.', status: 502 }
  }

  if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) {
    return { error: 'FedEx returned an incomplete authentication response.', status: 502 }
  }

  cachedToken = data.access_token
  cachedTokenBaseUrl = baseUrl
  tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - TOKEN_SAFETY_WINDOW_SECONDS) * 1000
  return cachedToken
}

function interpretFedexResult(data, submittedAddress, environment) {
  const resolved = data.output?.resolvedAddresses?.[0]
  if (!resolved) {
    return {
      found: false,
      matched: false,
      resolved: false,
      environment,
      message: environment === 'sandbox'
        ? 'This is a FedEx sandbox response. Sandbox results do not verify real delivery addresses.'
        : 'FedEx could not resolve a matching address. Check the details and try again.',
      standardizedAddress: '',
    }
  }

  const attributes = resolved.attributes || {}
  const isResolved = isFedexTrue(attributes.Resolved)
  const isStandardized = attributes.AddressState === 'STANDARDIZED'
  const hasValidDeliveryPoint = isFedexTrue(attributes.DPV)
    && isFedexFalse(attributes.Interpolated)
  const standardizedState = String(resolved.stateOrProvinceCode || '').toUpperCase()
  const standardizedPostalCode = String(resolved.postalCode || '').replace(/\D/g, '')
  const submittedPostalCode = submittedAddress.postalCode.replace(/\D/g, '')
  const candidateConflictsWithInput = (
    (resolved.city && resolved.city.toLowerCase() !== submittedAddress.city.toLowerCase())
    || (standardizedState && standardizedState !== submittedAddress.state)
    || (standardizedPostalCode && submittedPostalCode && !standardizedPostalCode.startsWith(submittedPostalCode))
  )
  const matched = isFedexTrue(attributes.Matched) && !candidateConflictsWithInput
  const deliverable = matched
    && isResolved
    && isStandardized
    && hasValidDeliveryPoint
  const standardizedAddress = [
    ...(Array.isArray(resolved.streetLines) ? resolved.streetLines : []),
    [resolved.city, resolved.stateOrProvinceCode, resolved.postalCode]
      .filter(Boolean)
      .join(' '),
  ].filter(Boolean).join(', ')

  let message
  if (environment === 'sandbox') {
    message = 'This is a FedEx sandbox response. Sandbox may return sample addresses and does not verify real delivery addresses.'
  } else if (candidateConflictsWithInput) {
    message = 'FedEx returned a different city, state, or ZIP code than the address entered. This is not a confirmed match.'
  } else if (!matched) {
    message = 'FedEx returned an address candidate but did not confirm an exact match.'
  } else if (deliverable) {
    message = 'FedEx matched and standardized the address, and confirmed a valid delivery point.'
  } else if (isResolved) {
    message = 'FedEx resolved the address, but did not confirm a valid delivery point.'
  } else {
    message = 'FedEx returned an address candidate, but did not resolve it.'
  }

  return {
    found: true,
    matched,
    resolved: isResolved,
    environment,
    deliverable,
    candidateConflictsWithInput,
    message,
    standardizedAddress: environment === 'sandbox' ? '' : standardizedAddress,
  }
}

export async function validateAddressWithFedex(input, env = process.env) {
  const normalized = normalizeAddress(input)
  if (normalized.error) return { status: 400, body: { error: normalized.error } }

  const clientId = env.FEDEX_CLIENT_ID?.trim()
  const clientSecret = env.FEDEX_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return { status: 503, body: { error: 'FedEx verification is not configured on the server yet.' } }
  }

  const environment = env.FEDEX_ENVIRONMENT?.trim().toLowerCase() || 'sandbox'
  if (!['sandbox', 'production'].includes(environment)) {
    return { status: 500, body: { error: 'FEDEX_ENVIRONMENT must be sandbox or production.' } }
  }
  const baseUrl = environment === 'production'
    ? 'https://apis.fedex.com'
    : 'https://apis-sandbox.fedex.com'

  const token = await getAccessToken(clientId, clientSecret, baseUrl)
  if (typeof token !== 'string') {
    return { status: token.status, body: { error: token.error } }
  }

  const { address } = normalized
  const requestBody = {
    addressesToValidate: [{
      address: {
        streetLines: [address.streetAddress, address.apartment].filter(Boolean),
        city: address.city,
        stateOrProvinceCode: address.state,
        postalCode: address.postalCode,
        countryCode: 'US',
      },
    }],
  }

  let response
  try {
    response = await fetch(`${baseUrl}/address/v1/addresses/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    return {
      status: error.name === 'TimeoutError' ? 504 : 502,
      body: {
        error: error.name === 'TimeoutError'
          ? 'FedEx address verification took too long. Please try again.'
          : 'Could not reach FedEx address verification. Check your connection and try again.',
      },
    }
  }

  if (!response.ok) {
    return {
      status: response.status === 429 ? 503 : 502,
      body: {
        error: response.status === 429
          ? 'FedEx rate limit reached. Please try again later.'
          : 'FedEx could not verify this address. Check the API project permissions and try again.',
      },
    }
  }

  let data
  try {
    data = await response.json()
  } catch {
    return { status: 502, body: { error: 'FedEx returned an unreadable address response.' } }
  }

  return {
    status: 200,
    body: interpretFedexResult(data, address, environment),
  }
}
