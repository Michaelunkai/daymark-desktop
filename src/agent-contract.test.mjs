import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('publishes a discoverable least-privilege Daymark task assistant contract', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/daymark-agent.json'), 'utf8'))
  assert.equal(manifest.version, 3)
  assert.equal(manifest.integration, 'openapi-http')
  assert.equal(manifest.openapi, '/api/agent/v1/openapi.json')
  assert.equal(manifest.authentication.scheme, 'bearer')
  assert.ok(manifest.operations.includes('listTasks'))
  assert.ok(manifest.operations.includes('createTask'))
  assert.ok(manifest.operations.includes('completeTask'))
  assert.ok(manifest.excludedData.includes('notes'))
  assert.ok(manifest.excludedActions.includes('task.delete'))
})
