import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('publishes a discoverable versioned Daymark AI contract and connector bootstrap', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/daymark-agent.json'), 'utf8'))
  const client = JSON.parse(await readFile(resolve(root, 'public/daymark-ai-client.json'), 'utf8'))
  const connector = await readFile(resolve(root, 'public/daymark-ai-connector.mjs'), 'utf8')
  assert.equal(manifest.version, 4)
  assert.equal(manifest.integration, 'openapi-http')
  assert.equal(manifest.openapi, '/api/agent/v1/openapi.json')
  assert.equal(manifest.authentication.scheme, 'bearer')
  assert.ok(manifest.operations.includes('listTasks'))
  assert.ok(manifest.operations.includes('createTask'))
  assert.ok(manifest.operations.includes('search'))
  assert.ok(manifest.operations.includes('upsertDiaryEntry'))
  assert.ok(manifest.scopes.includes('notes:read'))
  assert.ok(manifest.scopes.includes('undo:write'))
  assert.ok(manifest.safeguardedActions.includes('task.delete'))
  assert.equal(client.version, '2.0.0')
  assert.equal(client.discovery, '/.well-known/daymark-ai.json')
  assert.match(connector, /createDaymarkClient/)
})
