import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { validateAddressWithFedex } from './server/fedex.js'
import { validateAddressWithSmarty } from './server/smarty.js'
import historyPairingHandler from './api/history-pairing.js'
import packagePostsHandler from './api/package-posts.js'

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

      server.middlewares.use('/api/package-posts', async (request, response, next) => {
        let body
        try {
          if (request.method === 'POST') {
            let rawBody = ''
            for await (const chunk of request) {
              rawBody += chunk
              if (rawBody.length > 4_000_000) {
                response.statusCode = 413
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(JSON.stringify({ error: 'This result is too large to save.' }))
                return
              }
            }
            body = JSON.parse(rawBody)
          }

          const query = new URL(request.url, 'http://localhost').searchParams
          let result
          let statusCode = 200
          const apiResponse = {
            setHeader() {},
            status(code) {
              statusCode = code
              return this
            },
            json(value) {
              result = value
              return this
            },
          }

          await packagePostsHandler({
            method: request.method,
            headers: request.headers,
            body,
            query: { id: query.get('id') },
          }, apiResponse, environment)

          response.statusCode = statusCode
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(result))
        } catch (error) {
          if (error instanceof SyntaxError) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: 'Send package results as valid JSON.' }))
            return
          }
          next(error)
        }
      })

      server.middlewares.use('/api/history-pairing', async (request, response, next) => {
        let body
        try {
          if (request.method === 'POST') {
            let rawBody = ''
            for await (const chunk of request) {
              rawBody += chunk
              if (rawBody.length > 16_384) {
                response.statusCode = 413
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(JSON.stringify({ error: 'Pairing request is too large.' }))
                return
              }
            }
            body = JSON.parse(rawBody)
          }

          const query = new URL(request.url, 'http://localhost').searchParams
          let result
          let statusCode = 200
          const apiResponse = {
            setHeader() {},
            status(code) {
              statusCode = code
              return this
            },
            json(value) {
              result = value
              return this
            },
          }

          await historyPairingHandler({
            method: request.method,
            headers: request.headers,
            body,
            query: { action: query.get('action') },
          }, apiResponse, environment)

          response.statusCode = statusCode
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(result))
        } catch (error) {
          if (error instanceof SyntaxError) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: 'Send pairing data as valid JSON.' }))
            return
          }
          next(error)
        }
      })
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
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    ],
  }
})
