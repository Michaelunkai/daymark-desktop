import { randomUUID } from "node:crypto";

export const DEFAULT_API_URL = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const API_PREFIX = "/api/agent/v1/";

export class DaymarkCliError extends Error {
  constructor(message, { status = null, code = null, idempotencyKey = null } = {}) {
    super(message);
    this.name = "DaymarkCliError";
    this.status = status;
    this.code = code;
    this.idempotencyKey = idempotencyKey;
  }
}

export function createDaymarkClient({
  apiUrl = process.env.DAYMARK_API_URL || DEFAULT_API_URL,
  token,
  fetchImpl = fetch,
  onMutationKey = () => {},
} = {}) {
  const origin = normalizeOrigin(apiUrl);

  async function request(method, path, { body, idempotencyKey } = {}) {
    const verb = String(method).toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(verb)) throw new DaymarkCliError("Unsupported HTTP method.");
    if (typeof path !== "string" || !path.startsWith(API_PREFIX) || path.startsWith("//")) {
      throw new DaymarkCliError("The path must start with /api/agent/v1/.");
    }
    const url = new URL(path, origin);
    if (url.origin !== origin.origin || !url.pathname.startsWith(API_PREFIX)) {
      throw new DaymarkCliError("The API path leaves the configured Daymark origin.");
    }
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const mutationKey = verb === "GET" ? null : (idempotencyKey || randomUUID());
    if (mutationKey) {
      headers["Idempotency-Key"] = mutationKey;
      onMutationKey(mutationKey);
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: verb,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      throw new DaymarkCliError(`Daymark request failed: ${cause.message}`, { code: "network_error", idempotencyKey: mutationKey });
    }
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new DaymarkCliError("Daymark returned invalid JSON.", { status: response.status, idempotencyKey: mutationKey }); }
    }
    if (!response.ok) {
      throw new DaymarkCliError(data.message || data.error || `Daymark returned HTTP ${response.status}.`, {
        status: response.status,
        code: data.error || null,
        idempotencyKey: mutationKey,
      });
    }
    return data;
  }

  async function listAllTasks({ projectId, status = "all" } = {}) {
    const tasks = [];
    let offset = 0;
    let revision = null;
    for (;;) {
      const query = new URLSearchParams({ status, limit: "250", offset: String(offset) });
      if (projectId) query.set("projectId", projectId);
      const page = await request("GET", `${API_PREFIX}tasks?${query}`);
      if (!Array.isArray(page.tasks)) throw new DaymarkCliError("Daymark returned an invalid task page.");
      if (revision !== null && revision !== page.revision) {
        throw new DaymarkCliError("The workspace changed during paging; run the read again.", { code: "revision_changed" });
      }
      revision = page.revision;
      tasks.push(...page.tasks);
      if (page.nextOffset === null || (page.nextOffset === undefined && page.tasks.length < 250)) {
        return { tasks, revision, total: page.total ?? tasks.length };
      }
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset !== tasks.length) {
        throw new DaymarkCliError("This Daymark server does not support complete task pagination yet.", { code: "pagination_unavailable" });
      }
      offset = page.nextOffset;
    }
  }

  return { origin: origin.origin, request, listAllTasks };
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new DaymarkCliError("DAYMARK_API_URL is not a valid URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new DaymarkCliError("Daymark API URL must use HTTPS, except for localhost development.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new DaymarkCliError("DAYMARK_API_URL must contain only the origin.");
  }
  return url;
}
