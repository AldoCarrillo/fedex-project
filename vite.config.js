import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { validateAddressWithFedex } from './server/fedex.js'
import { validateAddressWithSmarty } from './server/smarty.js'

function addressValidationApiPlugin(environment) {
  return {
    name: 'address-validation-api',
    configureServer(server) {
      const routes = [
        ['/api/validate-address-fedex', (input) => validateAddressWithFedex(input, environment)],
        ['/api/validate-address', (input) => validateAddressWithSmarty(input, environment)],
      ]

      for (const [path, validateAddress] of routes) {
        server.middlewares.use(path, async (request, response, next) => {
          if (request.method !== 'POST') {
            response.statusCode = 405
            response.setHeader('Allow', 'POST')
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: 'Use POST to verify an address.' }))
            return
          }

          let body = ''
          try {
            for await (const chunk of request) {
              body += chunk
              if (body.length > 16_384) {
                response.statusCode = 413
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(JSON.stringify({ error: 'Address request is too large.' }))
                return
              }
            }

            const input = JSON.parse(body)
            const result = await validateAddress(input)
            response.statusCode = result.status
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify(result.body))
          } catch (error) {
            if (error instanceof SyntaxError) {
              response.statusCode = 400
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.end(JSON.stringify({ error: 'Send the address as valid JSON.' }))
              return
            }
            next(error)
          }
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      addressValidationApiPlugin({
        SMARTY_AUTH_ID: env.SMARTY_AUTH_ID,
        SMARTY_AUTH_TOKEN: env.SMARTY_AUTH_TOKEN,
        FEDEX_CLIENT_ID: env.FEDEX_CLIENT_ID,
        FEDEX_CLIENT_SECRET: env.FEDEX_CLIENT_SECRET,
        FEDEX_ENVIRONMENT: env.FEDEX_ENVIRONMENT,
      }),
    ],
  }
})
