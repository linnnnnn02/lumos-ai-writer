import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const distDirectory = resolve(process.cwd(), '../../web/dist')
const html = readFileSync(`${distDirectory}/index.html`, 'utf8')
const entryMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)

assert.ok(entryMatch, 'production HTML must include a JavaScript entry')

const initialAssetPaths = Array.from(
  new Set(
    Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)).map(
      (match) => match[1],
    ),
  ),
)
const initialAssets = initialAssetPaths.map((assetPath) => ({
  assetPath,
  size: statSync(`${distDirectory}${assetPath}`).size,
}))
const entryAsset = initialAssets.find(({ assetPath }) => assetPath === entryMatch[1])

assert.ok(entryAsset, 'production entry must be included in the initial asset set')
assert.ok(
  entryAsset.size <= 350_000,
  `web entry is ${entryAsset.size} bytes; keep it at or below 350000 bytes`,
)

const totalInitialBytes = initialAssets.reduce((total, asset) => total + asset.size, 0)
assert.ok(
  totalInitialBytes <= 1_100_000,
  `initial JavaScript is ${totalInitialBytes} bytes; keep it at or below 1100000 bytes`,
)

const oversizedChunks = readdirSync(`${distDirectory}/assets`)
  .filter((filename) => filename.endsWith('.js'))
  .map((filename) => ({
    filename,
    size: statSync(`${distDirectory}/assets/${filename}`).size,
  }))
  .filter(({ size }) => size > 400_000)
assert.deepEqual(
  oversizedChunks,
  [],
  `production JavaScript chunks must stay at or below 400000 bytes`,
)

for (const lazyPageName of [
  'library-manager',
  'learn-workspace',
  'draft-version-history',
  'writing-profile-dialog',
]) {
  assert.ok(
    !initialAssetPaths.some((assetPath) => assetPath.includes(lazyPageName)),
    `${lazyPageName} must not be preloaded on the project list`,
  )
}

console.log(
  `web build budget passed: entry ${entryAsset.size} bytes, initial JavaScript ${totalInitialBytes} bytes`,
)
