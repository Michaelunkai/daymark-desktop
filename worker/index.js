/**
 * Sites runtime entry for the Vite-built Daymark SPA.
 *
 * Static files are served by the platform ASSETS binding. A browser
 * navigation to a client-side route receives index.html so the app router can
 * render the requested view. Missing non-HTML assets remain 404s.
 */
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname
    const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})$/)
    if (syncMatch) {
      return env.DB
        ? handleSync(request, env.DB, syncMatch[1])
        : json({ error: "sync_unavailable" }, 503)
    }

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

async function handleSync(request, db, syncKey) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_sync_states (sync_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run()

  if (request.method === "GET") {
    const row = await db
      .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
      .bind(syncKey)
      .first()
    if (!row) return json({ error: "not_found" }, 404)
    return json({
      revision: row.revision,
      state: JSON.parse(row.state_json),
      updatedAt: row.updated_at,
    })
  }

  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405)
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 2_500_000) return json({ error: "payload_too_large" }, 413)

  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }
  const state = payload?.state
  const expectedRevision = Number(payload?.expectedRevision)
  if (
    !state ||
    typeof state !== "object" ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return json({ error: "invalid_payload" }, 400)
  }
  const current = await db
    .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
    .bind(syncKey)
    .first()
  if ((current?.revision ?? 0) !== expectedRevision) {
    return json({
      error: "conflict",
      revision: current?.revision ?? 0,
      state: current ? JSON.parse(current.state_json) : null,
    }, 409)
  }

  const updatedAt = new Date().toISOString()
  const stateJson = JSON.stringify(state)
  if (current) {
    const result = await db
      .prepare("UPDATE daymark_sync_states SET revision = ?1, state_json = ?2, updated_at = ?3 WHERE sync_key = ?4 AND revision = ?5")
      .bind(state.revision, stateJson, updatedAt, syncKey, expectedRevision)
      .run()
    if (!result.meta?.changes) {
      const latest = await db
        .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
        .bind(syncKey)
        .first()
      return json({
        error: "conflict",
        revision: latest?.revision ?? 0,
        state: latest ? JSON.parse(latest.state_json) : null,
      }, 409)
    }
  } else {
    await db
      .prepare("INSERT INTO daymark_sync_states (sync_key, revision, state_json, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(syncKey, state.revision, stateJson, updatedAt)
      .run()
  }
  return json({ revision: state.revision, state, updatedAt })
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

export default worker
