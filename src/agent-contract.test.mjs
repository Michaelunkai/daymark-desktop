import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('publishes a discoverable Daymark agent contract', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/daymark-agent.json'), 'utf8'))
  assert.equal(manifest.bridge, 'DaymarkAI')
  assert.equal(manifest.alias, 'DaymarkAgent')
  assert.equal(manifest.version, 2)
  assert.equal(manifest.channel, 'daymark-agent')
  assert.equal(manifest.messageEvent, 'window.postMessage')
  assert.ok(manifest.operations.includes('getState'))
  assert.ok(manifest.operations.includes('startSession'))
})
