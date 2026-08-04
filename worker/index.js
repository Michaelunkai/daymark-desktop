/**
 * Sites runtime entry for the Vite-built Daymark SPA.
 *
 * Static files are served by the platform ASSETS binding. A browser
 * navigation to a client-side route receives index.html so the app router can
 * render the requested view. Missing non-HTML assets remain 404s.
 */
const worker = {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname
    const isStaticAsset = pathname.startsWith('/assets/') || /\.[^/]+$/.test(pathname)
    if (!isStaticAsset && ['GET', 'HEAD'].includes(request.method)) {
      const headers = new Headers(request.headers)
      headers.set('Accept', 'text/html')
      const fallbackRequest = new Request(new URL('/index.html', request.url), {
        method: request.method,
        headers,
      })
      return env.ASSETS.fetch(fallbackRequest)
    }

    return env.ASSETS.fetch(request)
  },
}

export default worker
