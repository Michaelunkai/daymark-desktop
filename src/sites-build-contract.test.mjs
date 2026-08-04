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
