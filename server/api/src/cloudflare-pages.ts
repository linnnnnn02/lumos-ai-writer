import { handle } from 'hono/cloudflare-pages'
import { apiApp } from './app.js'

const handleApiRequest = handle(apiApp)

function stripApiPrefix(request: Request) {
  const url = new URL(request.url)

  if (url.pathname === '/api') {
    url.pathname = '/'
  } else if (url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice('/api'.length)
  }

  return new Request(url, request)
}

export const onRequest: typeof handleApiRequest = (context) =>
  handleApiRequest({
    ...context,
    request: stripApiPrefix(context.request),
  })
