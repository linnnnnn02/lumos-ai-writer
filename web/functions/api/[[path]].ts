import { handle } from 'hono/cloudflare-pages'
import { apiApp } from '@lumos-ai/api'

export const onRequest = handle(apiApp, '/api')
