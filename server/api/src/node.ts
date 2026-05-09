import { existsSync } from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { apiApp } from './app.js'

for (const envPath of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../..', '.env')]) {
  if (!existsSync(envPath)) continue
  loadEnv({ path: envPath })
  break
}

const port = Number(process.env.PORT || 8788)
const app = new Hono()

app.get('/', (c) =>
  c.json({
    ok: true,
    service: 'lumos-api-dev',
    api: '/api/health',
  }),
)
app.route('/api', apiApp)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.info(`Lumos API dev server listening on http://localhost:${info.port}`)
  },
)
