import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const [index, serviceWorker] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/daymark-sw.js", import.meta.url), "utf8"),
])

test("web startup registers a stale-while-revalidate cache without caching API data", () => {
  assert.match(index, /navigator\.serviceWorker\.register\("\/daymark-sw\.js"/)
  assert.match(serviceWorker, /CACHE_NAME = "daymark-static-v1"/)
  assert.match(serviceWorker, /request\.mode === "navigate"/)
  assert.match(serviceWorker, /event\.waitUntil\(refresh\)/)
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/)
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/assets\/"\)/)
  assert.match(serviceWorker, /url\.pathname === "\/daymark-agent\.json"/)
  assert.match(serviceWorker, /new Response\("Daymark is temporarily offline\./)
  assert.ok(root)
})
