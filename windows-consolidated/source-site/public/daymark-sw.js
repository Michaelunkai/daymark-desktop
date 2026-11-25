const CACHE_NAME = "daymark-static-v1"
const INDEX_CACHE_KEY = "/index.html"

function isApiRequest(url) {
  return url.pathname.startsWith("/api/")
}

function isKnownLaunchQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (key !== "native" && key !== "startup" && key !== "sync") return false
  }
  return true
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/assets/") || url.pathname === "/daymark-agent.json"
}

async function cacheResponse(cache, key, response) {
  if (response.ok) await cache.put(key, response.clone())
  return response
}

async function refreshNavigation(request, cache) {
  try {
    return await cacheResponse(cache, INDEX_CACHE_KEY, await fetch(request))
  } catch {
    return null
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin || isApiRequest(url)) return

  if (request.mode === "navigate" && isKnownLaunchQuery(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(INDEX_CACHE_KEY)
      const refresh = refreshNavigation(request, cache)
      if (cached) {
        event.waitUntil(refresh)
        return cached
      }
      const network = await refresh
      return network ?? new Response("Daymark is temporarily offline.", { status: 503 })
    })())
    return
  }

  if (!isStaticAsset(url)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    const refresh = fetch(request).then((response) => cacheResponse(cache, request, response)).catch(() => null)
    if (cached) {
      event.waitUntil(refresh)
      return cached
    }
    return (await refresh) ?? new Response(null, { status: 504 })
  })())
})
