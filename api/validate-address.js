import { validateAddressWithSmarty } from '../server/smarty.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Use POST to verify an address.' })
  }

  const result = await validateAddressWithSmarty(request.body)
  return response.status(result.status).json(result.body)
}
