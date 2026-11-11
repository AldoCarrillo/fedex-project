const STATE_CODE_PATTERN = /^[A-Z]{2}$/
const ZIP_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/
const MAX_FIELD_LENGTH = 100

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

function interpretCandidate(candidate) {
  const matchCode = candidate.analysis?.dpv_match_code || ''
  let message = 'Smarty returned a candidate, but USPS did not confirm the delivery point.'

  if (matchCode === 'Y') {
    message = 'Address matched and the delivery point was confirmed by USPS.'
  } else if (matchCode === 'D') {
    message = 'Street address matched, but a secondary unit is needed for delivery-point confirmation.'
  } else if (matchCode === 'S') {
    message = 'Street address matched, but the secondary unit could not be confirmed.'
  }

  return {
    found: true,
    deliverable: matchCode === 'Y',
    matchCode,
    message,
    standardizedAddress: [candidate.delivery_line_1, candidate.last_line]
      .filter(Boolean)
      .join(', '),
  }
}

export async function validateAddressWithSmarty(input, env = process.env) {
  const normalized = normalizeAddress(input)
  if (normalized.error) return { status: 400, body: { error: normalized.error } }

  const authId = env.SMARTY_AUTH_ID?.trim()
  const authToken = env.SMARTY_AUTH_TOKEN?.trim()
  if (!authId || !authToken) {
    return {
      status: 503,
      body: { error: 'Smarty verification is not configured on the server yet.' },
    }
  }

  const { address } = normalized
  const url = new URL('https://us-street.api.smarty.com/street-address')
  url.searchParams.set('auth-id', authId)
  url.searchParams.set('auth-token', authToken)
  url.searchParams.set('street', address.streetAddress)
  if (address.apartment) url.searchParams.set('street2', address.apartment)
  url.searchParams.set('city', address.city)
  url.searchParams.set('state', address.state)
  url.searchParams.set('zipcode', address.postalCode)
  url.searchParams.set('candidates', '1')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let smartyResponse

  try {
    smartyResponse = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    return {
      status: error.name === 'AbortError' ? 504 : 502,
      body: {
        error: error.name === 'AbortError'
          ? 'Smarty took too long to respond. Please try again.'
          : 'Could not reach Smarty. Check your connection and try again.',
      },
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!smartyResponse.ok) {
    if (smartyResponse.status === 401 || smartyResponse.status === 403) {
      return {
        status: 502,
        body: { error: 'Smarty rejected the server credentials. Check the configured API credentials.' },
      }
    }

    return {
      status: smartyResponse.status === 429 ? 503 : 502,
      body: {
        error: smartyResponse.status === 429
          ? 'Smarty rate limit reached. Please try again later.'
          : 'Smarty could not verify this address right now. Please try again later.',
      },
    }
  }

  let candidates
  try {
    candidates = await smartyResponse.json()
  } catch {
    return { status: 502, body: { error: 'Smarty returned an unreadable response.' } }
  }

  if (!Array.isArray(candidates)) {
    return { status: 502, body: { error: 'Smarty returned an unexpected response.' } }
  }

  if (candidates.length === 0) {
    return {
      status: 200,
      body: {
        found: false,
        deliverable: false,
        matchCode: '',
        message: 'Smarty could not find a matching address. Check the details and try again.',
        standardizedAddress: '',
      },
    }
  }

  return { status: 200, body: interpretCandidate(candidates[0]) }
}
