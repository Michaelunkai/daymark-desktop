/**
 * Sites runtime entry for the Vite-built Daymark SPA.
 *
 * Static files are served by the platform ASSETS binding. A browser
 * navigation to a client-side route receives index.html so the app router can
 * render the requested view. Missing non-HTML assets remain 404s.
 */
const worker = {
  async fetch(request, env) {
    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) return assetResponse

    const pathname = new URL(request.url).pathname
    const isStaticAsset = pathname.startsWith('/assets/') || /\.[^/]+$/.test(pathname)
    if (isStaticAsset || !['GET', 'HEAD'].includes(request.method)) {
      return assetResponse
    }

    const fallbackUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
  },
}

export default worker
