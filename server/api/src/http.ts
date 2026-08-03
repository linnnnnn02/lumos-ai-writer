import type { Context } from 'hono'
import type { ApiErrorCode } from '@lumos-ai/shared'

type ErrorOptions = {
  code: ApiErrorCode
  message: string
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504
  details?: unknown
}

export function jsonError(c: Context, options: ErrorOptions) {
  return c.json(
    {
      ok: false,
      error: {
        code: options.code,
        message: options.message,
        requestId: c.get('requestId'),
        ...(options.details === undefined ? {} : { details: options.details }),
      },
    },
    options.status,
  )
}

export function getBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader) return ''
  const [scheme, token] = authorizationHeader.split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer') return ''
  return token ?? ''
}
