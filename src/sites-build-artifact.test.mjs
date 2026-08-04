import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

test('production build emits the checked-in Sites worker entrypoint', () => {
  const source = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8')
  const outputPath = new URL('../dist/server/index.js', import.meta.url)

  assert.equal(existsSync(outputPath), true)
  assert.equal(readFileSync(outputPath, 'utf8'), source)
})
