const LOCAL_API_BASE_URL = 'http://localhost:8788/api'
const PRODUCTION_API_BASE_URL = 'https://lumos-ai-writer.pages.dev/api'

export function getCloudApiBaseUrl() {
  const env = (import.meta as unknown as {
    env?: Record<string, string | undefined>
  }).env
  const fallbackUrl = env?.COMMAND === 'serve' ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL
  return (env?.WXT_PUBLIC_API_BASE_URL || fallbackUrl).replace(/\/+$/, '')
}
