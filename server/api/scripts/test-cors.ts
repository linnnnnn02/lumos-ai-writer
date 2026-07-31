import assert from 'node:assert/strict'
import { createApiApp } from '../src/app.js'

const webOrigin = 'https://lumos-ai-writer.pages.dev'
const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`

async function preflight(origin: string, allowChromeExtensions: boolean) {
  const app = createApiApp()
  return app.request(
    'http://localhost/v1/folders',
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    },
    {
      APP_ENV: 'production',
      PUBLIC_APP_URL: webOrigin,
      CORS_ALLOWED_ORIGINS: webOrigin,
      CORS_ALLOW_CHROME_EXTENSIONS: allowChromeExtensions ? 'true' : 'false',
    },
  )
}

const webResponse = await preflight(webOrigin, true)
assert.equal(webResponse.status, 204)
assert.equal(webResponse.headers.get('access-control-allow-origin'), webOrigin)

const extensionResponse = await preflight(extensionOrigin, true)
assert.equal(extensionResponse.status, 204)
assert.equal(extensionResponse.headers.get('access-control-allow-origin'), extensionOrigin)

const disabledResponse = await preflight(extensionOrigin, false)
assert.equal(disabledResponse.status, 204)
assert.equal(disabledResponse.headers.get('access-control-allow-origin'), null)

const malformedResponse = await preflight('chrome-extension://not-a-valid-extension', true)
assert.equal(malformedResponse.status, 204)
assert.equal(malformedResponse.headers.get('access-control-allow-origin'), null)

console.log('API CORS policy accepts configured web and valid Chrome extension origins.')
