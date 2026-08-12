import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import worker from '../worker/index.js'

const workerSource = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8')

test('Sites worker serves ASSETS and falls back to index.html for HTML routes', () => {
  assert.match(workerSource, /env\.ASSETS\.fetch\(request\)/)
  assert.match(workerSource, /isStaticAsset/)
  assert.match(workerSource, /\/index\.html/)
  assert.match(workerSource, /export default worker/)
})

test('Sites worker behavior preserves assets, serves SPA routes, and keeps missing assets as 404', async () => {
  const requestedPaths = []
  const env = {
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname
        requestedPaths.push(path)
        if (path === '/index.html') return new Response('DAYMARK', { status: 200 })
        if (path === '/assets/app.js') return new Response('asset', { status: 200 })
        return new Response('missing', { status: 404 })
      },
    },
  }

  const assetResponse = await worker.fetch(new Request('https://daymark.test/assets/app.js'), env)
  assert.equal(assetResponse.status, 200)
  assert.equal(await assetResponse.text(), 'asset')

  const routeResponse = await worker.fetch(
    new Request('https://daymark.test/workspace/order', {
      headers: { Accept: 'text/html' },
    }),
    env,
  )
  assert.equal(routeResponse.status, 200)
  assert.equal(await routeResponse.text(), 'DAYMARK')
  assert.equal(routeResponse.headers.get('Cache-Control'), 'no-store')

  const defaultAcceptRouteResponse = await worker.fetch(
    new Request('https://daymark.test/workspace/order'),
    env,
  )
  assert.equal(defaultAcceptRouteResponse.status, 200)
  assert.equal(await defaultAcceptRouteResponse.text(), 'DAYMARK')

  const missingResponse = await worker.fetch(
    new Request('https://daymark.test/assets/missing.js'),
    env,
  )
  assert.equal(missingResponse.status, 404)

  const postResponse = await worker.fetch(
    new Request('https://daymark.test/workspace/order', {
      method: 'POST',
      headers: { Accept: 'text/html' },
      body: 'mutation',
    }),
    env,
  )
  assert.equal(postResponse.status, 404)
  assert.deepEqual(requestedPaths, [
    '/assets/app.js',
    '/index.html',
    '/index.html',
    '/assets/missing.js',
    '/workspace/order',
  ])
})

test('Sites worker serves AI discovery dynamically without stale static assets', async () => {
  const env = {
    ASSETS: {
      async fetch() {
        return new Response('stale asset', { status: 200 })
      },
    },
  }

  const manifestResponse = await worker.fetch(new Request('https://daymark.test/daymark-agent.json'), env)
  const manifest = await manifestResponse.json()
  assert.equal(manifestResponse.headers.get('Cache-Control'), 'no-store')
  assert.equal(manifest.version, 4)
  assert.equal(manifest.integration, 'openapi-http')
  assert.equal(manifest.openapi, 'https://daymark.test/api/agent/v1/openapi.json')

  const discoveryResponse = await worker.fetch(new Request('https://daymark.test/.well-known/daymark-ai.json'), env)
  const discovery = await discoveryResponse.json()
  assert.equal(discoveryResponse.headers.get('Cache-Control'), 'no-store')
  assert.equal(discovery.version, 4)
  assert.equal(discovery.manifest, 'https://daymark.test/daymark-agent.json')
})

test('Sites worker exposes non-sensitive Daymark health diagnostics', async () => {
  const response = await worker.fetch(
    new Request('https://daymark.test/api/health'),
    { DB: {} },
  )
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.service, 'daymark')
  assert.equal(payload.status, 'ready')
  assert.equal(payload.protocolVersion, 3)
  assert.equal(payload.transport, 'same-origin-browser-bridge')
  assert.equal('state' in payload, false)
  assert.equal('syncKey' in payload, false)
})

test('Sites worker returns a changed workspace immediately from the revision stream', async () => {
  const state = {
    schemaVersion: 5,
    revision: 1876,
    updatedAt: '2026-08-12T19:50:00.000Z',
    projects: {},
    sections: {},
    filters: {},
    tasks: {},
    orderItems: {},
    notes: {},
    diaryEntries: {},
    preferences: {},
    undoStack: [],
  }
  const db = {
    prepare(statement) {
      assert.match(statement, /daymark_sync_states/)
      return {
        bind(syncKey) {
          assert.equal(syncKey, 'A1b2C3d4E5f6G7h8I9j0K_')
          return {
            async first() {
              return {
                revision: 1876,
                state_json: JSON.stringify(state),
                updated_at: state.updatedAt,
              }
            },
          }
        },
      }
    },
  }
  const response = await worker.fetch(
    new Request('https://daymark.test/api/sync/A1b2C3d4E5f6G7h8I9j0K_/changes?after=1875'),
    { DB: db },
  )
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.revision, 1876)
  assert.deepEqual(payload.state, state)
})

test('plain production navigation pairs to the highest-revision canonical workspace', async () => {
  const statements = []
  const db = {
    prepare(statement) {
      statements.push(statement)
      if (statement.includes('CREATE TABLE')) return { async run() {} }
      if (statement.includes("config_key = 'canonical_sync_key'")) {
        return { async first() { return null } }
      }
      if (statement.includes('ORDER BY revision DESC')) {
        return { async first() { return { sync_key: 'A1b2C3d4E5f6G7h8I9j0K_' } } }
      }
      if (statement.includes('INSERT OR IGNORE')) {
        return { bind() { return { async run() {} } } }
      }
      throw new Error(`Unexpected SQL: ${statement}`)
    },
  }
  const response = await worker.fetch(
    new Request('https://daymark.test/'),
    {
      DB: db,
      ASSETS: { async fetch() { return new Response('DAYMARK') } },
    },
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Set-Cookie'), /daymark\.sync-key=A1b2C3d4E5f6G7h8I9j0K_/)
  assert.ok(statements.some((statement) => statement.includes('ORDER BY revision DESC')))
})

test('canonical pairing API bypasses cached HTML and sets the workspace cookie', async () => {
  const db = {
    prepare(statement) {
      if (statement.includes('CREATE TABLE')) return { async run() {} }
      if (statement.includes("config_key = 'canonical_sync_key'")) {
        return { async first() { return { config_value: 'A1b2C3d4E5f6G7h8I9j0K_' } } }
      }
      throw new Error(`Unexpected SQL: ${statement}`)
    },
  }
  const response = await worker.fetch(
    new Request('https://daymark.test/api/sync/pair-canonical', { method: 'POST' }),
    { DB: db },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { paired: true })
  const cookies = response.headers.getSetCookie()
  assert.ok(cookies.some((cookie) => /daymark\.sync-key=A1b2C3d4E5f6G7h8I9j0K_/.test(cookie)))
  assert.ok(cookies.some((cookie) => /daymark\.canonical-workspace=1/.test(cookie)))
})
