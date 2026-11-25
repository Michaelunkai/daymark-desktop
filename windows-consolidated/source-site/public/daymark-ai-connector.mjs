export async function createDaymarkClient({
  baseUrl,
  token,
  fetchImpl = fetch,
}) {
  if (!baseUrl || !token) throw new Error("A Daymark base URL and API key are required.")
  const origin = new URL(baseUrl).origin
  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Accept", "application/json")
    const response = await fetchImpl(new URL(path, origin), { ...init, headers })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `Daymark API request failed (${response.status}).`)
      error.status = response.status
      error.payload = payload
      throw error
    }
    return payload
  }
  return {
    discovery: () => fetchImpl(new URL("/.well-known/daymark-ai.json", origin)).then((response) => response.json()),
    health: () => fetchImpl(new URL("/api/agent/v1/health", origin)).then((response) => response.json()),
    readiness: () => fetchImpl(new URL("/api/agent/v1/ready", origin)).then((response) => response.json()),
    capabilities: () => request("/api/agent/v1/capabilities"),
    request,
  }
}
