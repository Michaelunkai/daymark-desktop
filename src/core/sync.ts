import type { AppState } from "./types";

const SYNC_KEY = "daymark.sync-key";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type SyncStatus = "starting" | "synced" | "syncing" | "offline" | "conflict";

export function getSyncKey(storage?: Pick<Storage, "getItem" | "setItem"> | null): string {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const fromUrl = params.get("sync") ?? "";
  if (SYNC_PATTERN.test(fromUrl)) {
    try {
      storage?.setItem(SYNC_KEY, fromUrl);
    } catch {
      // The URL remains a valid source when local storage is unavailable.
    }
    return fromUrl;
  }

  try {
    const stored = storage?.getItem(SYNC_KEY) ?? "";
    if (SYNC_PATTERN.test(stored)) return stored;
  } catch {
    // Fall through to a session-usable key.
  }

  const key = randomKey();
  try {
    storage?.setItem(SYNC_KEY, key);
  } catch {
    // Sync can still work for the current session.
  }
  return key;
}

export function getSyncLink(key: string): string {
  const origin = typeof window === "undefined" ? "https://daymark-desktop.michaelovsky55555.chatgpt.site" : window.location.origin;
  return `${origin}/?sync=${encodeURIComponent(key)}`;
}

export function getAndroidSyncLink(key: string): string {
  return `daymark://sync/${encodeURIComponent(key)}`;
}

export async function pullSyncState(key: string): Promise<{ state: AppState | null; revision: number }> {
  const response = await fetch(`/api/sync/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return { state: null, revision: 0 };
  if (!response.ok) throw new Error(`Sync read failed (${response.status}).`);
  const payload = await response.json();
  return { state: payload.state ?? null, revision: Number(payload.revision ?? payload.state?.revision ?? 0) };
}

export async function pushSyncState(
  key: string,
  state: AppState,
  expectedRevision: number,
): Promise<{ state: AppState; revision: number }> {
  const response = await fetch(`/api/sync/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, state }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409) {
    const error = new Error("Sync conflict.");
    Object.assign(error, { code: "conflict", state: payload.state ?? null, revision: payload.revision ?? 0 });
    throw error;
  }
  if (!response.ok) throw new Error(`Sync write failed (${response.status}).`);
  return { state: payload.state, revision: Number(payload.revision ?? state.revision) };
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 22);
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 22);
}
