import { validateAddressWithFedex } from '../server/fedex.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Use POST to verify an address with FedEx.' })
  }

  const result = await validateAddressWithFedex(request.body)
  return response.status(result.status).json(result.body)
}
