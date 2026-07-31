import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(repositoryRoot, 'extension/.output/chrome-mv3')
const manifestPath = path.join(outputDirectory, 'manifest.json')
const defaultProductionApiBaseUrl = 'https://lumos-ai-writer.pages.dev/api'
const expectedApiBaseUrl = (
  process.env.WXT_PUBLIC_API_BASE_URL || defaultProductionApiBaseUrl
).replace(/\/+$/, '')
const expectedApiOrigin = new URL(expectedApiBaseUrl).origin

function fail(message) {
  console.error(`Extension artifact check failed: ${message}`)
  process.exitCode = 1
}

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return listJavaScriptFiles(entryPath)
      return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : []
    }),
  )
  return files.flat()
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []
const extensionCsp = manifest.content_security_policy?.extension_pages ?? ''
const javaScriptFiles = await listJavaScriptFiles(outputDirectory)
const bundleContents = await Promise.all(javaScriptFiles.map((file) => readFile(file, 'utf8')))

if (!hostPermissions.includes(`${expectedApiOrigin}/*`)) {
  fail(`manifest is missing host permission for ${expectedApiOrigin}`)
}

if (!extensionCsp.includes(expectedApiOrigin)) {
  fail(`extension CSP is missing ${expectedApiOrigin}`)
}

if (!bundleContents.some((contents) => contents.includes(expectedApiBaseUrl))) {
  fail(`built JavaScript does not contain ${expectedApiBaseUrl}`)
}

if (!process.exitCode) {
  console.log(`Extension artifact targets ${expectedApiBaseUrl}`)
}
