import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf8')
}

function attributeValue(source, name) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return match?.[1] ?? null
}

export function parseAndroidMarkers(html) {
  const rootElement = html.match(/<div\s+id="root"([\s\S]*?)>/i)?.[1] ?? ''
  return {
    release: attributeValue(html.match(/<meta\s+name="daymark-release"[^>]*>/i)?.[0] ?? '', 'content'),
    firstFrame: attributeValue(
      html.match(/<meta\s+name="daymark-first-frame"[^>]*>/i)?.[0] ?? '',
      'content',
    ),
    rootReady: attributeValue(rootElement, 'data-daymark-ready'),
    rootFirstFrame: attributeValue(rootElement, 'data-daymark-first-frame'),
    rootInteractive: attributeValue(rootElement, 'data-daymark-interactive'),
    rootVersion: attributeValue(rootElement, 'data-daymark-version'),
  }
}

export function collectReminderSyncProof() {
  const html = read('index.html')
  const main = read('src/main.jsx')
  const headers = read('public/_headers')
  const builtHtmlPath = new URL('../dist/client/index.html', import.meta.url)
  const builtHtml = existsSync(builtHtmlPath) ? readFileSync(builtHtmlPath, 'utf8') : null
  return {
    sourceMarkers: parseAndroidMarkers(html),
    builtMarkers: builtHtml ? parseAndroidMarkers(builtHtml) : null,
    mainHasReadyBridge: main.includes("setAttribute('data-daymark-ready', 'true')")
      && main.includes('window.DaymarkAndroid?.onAppReady?.()'),
    mainHasInteractiveMarker: main.includes("setAttribute('data-daymark-interactive', 'true')")
      && main.includes("setAttribute('data-daymark-first-frame', FIRST_FRAME_MARKER)"),
    syncFetchIsFresh: /fetch\(['"]\/api\/sync\/pair-canonical['"][\s\S]*?cache:\s*['"]no-store['"]/.test(main),
    headersAreFresh: /\/api\/\*\s+Cache-Control: no-store/.test(headers),
  }
}

test('Android marker parser proves the source first frame and readiness contract', () => {
  const proof = collectReminderSyncProof()
  assert.deepEqual(proof.sourceMarkers, {
    release: '1.4.44',
    firstFrame: 'interactive',
    rootReady: 'false',
    rootFirstFrame: 'interactive',
    rootInteractive: 'false',
    rootVersion: '1.4.44',
  })
  assert.equal(proof.mainHasReadyBridge, true)
  assert.equal(proof.mainHasInteractiveMarker, true)
  assert.equal(proof.syncFetchIsFresh, true)
  assert.equal(proof.headersAreFresh, true)
})

test('built client keeps Android markers when a production artifact exists', () => {
  const proof = collectReminderSyncProof()
  if (!proof.builtMarkers) return
  assert.deepEqual(proof.builtMarkers, {
    release: '1.4.44',
    firstFrame: 'interactive',
    rootReady: 'false',
    rootFirstFrame: 'interactive',
    rootInteractive: 'false',
    rootVersion: '1.4.44',
  })
})
