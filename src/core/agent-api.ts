export const DAYMARK_AI_SCOPES = [
  "projects:read", "projects:write",
  "sections:read", "sections:write",
  "labels:read", "labels:write",
  "filters:read", "filters:write",
  "tasks:read", "tasks:write",
  "calendar:read",
  "notes:read", "notes:write",
  "diary:read", "diary:write",
  "order:read", "order:write",
  "preferences:read", "preferences:write",
  "search:read",
  "undo:write",
] as const;

// Preserved for callers compiled against the initial task-only integration.
export const TASK_ASSISTANT_SCOPES = DAYMARK_AI_SCOPES;

export type AgentKey = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProvisionOptions = {
  syncKey: string;
  name?: string;
  fetchImpl?: FetchLike;
  randomBytes?: () => Uint8Array;
};

export async function provisionTaskAssistant({
  syncKey,
  name = "Codex Daymark AI",
  fetchImpl = fetch,
  randomBytes = secureRandomBytes,
}: ProvisionOptions): Promise<{ key: AgentKey; token: string }> {
  const token = `dmk_live_${base64Url(randomBytes())}`;
  const response = await fetchImpl("/api/agent/v1/keys", {
    method: "POST",
    headers: workspaceHeaders(syncKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      tokenHash: await sha256Hex(token),
      scopes: DAYMARK_AI_SCOPES,
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new AgentApiError(payload.message ?? "Daymark could not create that API key.", response.status);
  return { key: payload.key as AgentKey, token };
}

export async function listAgentKeys(syncKey: string, fetchImpl: FetchLike = fetch): Promise<AgentKey[]> {
  const response = await fetchImpl("/api/agent/v1/keys", {
    headers: workspaceHeaders(syncKey),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new AgentApiError(payload.message ?? "Daymark could not load API keys.", response.status);
  return Array.isArray(payload.keys) ? payload.keys as AgentKey[] : [];
}

export async function revokeAgentKey(syncKey: string, keyId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(`/api/agent/v1/keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
    headers: workspaceHeaders(syncKey),
  });
  if (response.status === 204) return;
  const payload = await readPayload(response);
  throw new AgentApiError(payload.message ?? "Daymark could not revoke that API key.", response.status);
}

export class AgentApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
  }
}

function workspaceHeaders(syncKey: string, additional: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${syncKey}`,
    Accept: "application/json",
    ...additional,
  };
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
