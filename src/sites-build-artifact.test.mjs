import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

test('production build emits the checked-in Sites worker entrypoint', () => {
  const source = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8')
  const outputPath = new URL('../dist/server/index.js', import.meta.url)
  const clientIndex = new URL('../dist/client/index.html', import.meta.url)
  const clientAssets = new URL('../dist/client/assets', import.meta.url)
  const cacheHeaders = new URL('../dist/client/_headers', import.meta.url)

  assert.equal(existsSync(outputPath), true)
  assert.equal(readFileSync(outputPath, 'utf8'), source)
  assert.equal(existsSync(clientIndex), true)
  assert.equal(existsSync(clientAssets), true)
  assert.equal(existsSync(cacheHeaders), true)
  assert.match(readFileSync(cacheHeaders, 'utf8'), /\/index\.html\s+Cache-Control: no-store/)
  assert.match(readFileSync(cacheHeaders, 'utf8'), /\/daymark-agent\.json\s+Cache-Control: no-store/)
  assert.ok(readdirSync(clientAssets).length > 0)
  assert.equal(existsSync(new URL('../dist/index.html', import.meta.url)), false)
  assert.equal(existsSync(new URL('../dist/assets', import.meta.url)), false)
})
