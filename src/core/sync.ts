import type { AppState } from "./types";

const SYNC_KEY = "daymark.sync-key";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type SyncStatus = "starting" | "synced" | "syncing" | "offline" | "conflict";

type SyncMessage = {
  source: string;
  state: AppState;
};

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

export function mergeSyncStates(local: AppState, remote: AppState): AppState {
  const newerRecord = <T extends { id: string; updatedAt: string }>(
    left: Record<string, T>,
    right: Record<string, T>,
  ): Record<string, T> => {
    const merged: Record<string, T> = { ...right };
    Object.entries(left).forEach(([id, value]) => {
      const other = right[id];
      if (!other || value.updatedAt >= other.updatedAt) merged[id] = structuredClone(value);
    });
    return merged;
  };

  return {
    ...structuredClone(remote),
    revision: Math.max(local.revision, remote.revision),
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
    clientId: local.clientId,
    projects: newerRecord(local.projects, remote.projects),
    sections: newerRecord(local.sections, remote.sections),
    labels: newerRecord(local.labels, remote.labels),
    filters: newerRecord(local.filters, remote.filters),
    tasks: newerRecord(local.tasks, remote.tasks),
    orderItems: newerRecord(local.orderItems, remote.orderItems),
    notes: newerRecord(local.notes, remote.notes),
    diaryEntries: Object.entries(local.diaryEntries).reduce(
      (merged, [date, entry]) => {
        const other = remote.diaryEntries[date];
        merged[date] = !other || entry.updatedAt >= other.updatedAt ? structuredClone(entry) : other;
        return merged;
      },
      { ...remote.diaryEntries },
    ),
    preferences: local.updatedAt >= remote.updatedAt ? structuredClone(local.preferences) : structuredClone(remote.preferences),
    undoStack: local.updatedAt >= remote.updatedAt ? structuredClone(local.undoStack) : structuredClone(remote.undoStack),
  };
}

export function createSyncChannel(
  key: string,
  source: string,
  onState: (state: AppState) => void,
): { publish: (state: AppState) => void; close: () => void } | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(`daymark-sync:${key}`);
  const handleMessage = (event: MessageEvent<SyncMessage>) => {
    if (event.data?.source === source || !event.data?.state) return;
    onState(event.data.state);
  };
  channel.addEventListener("message", handleMessage);
  return {
    publish: (state) => channel.postMessage({ source, state: structuredClone(state) } satisfies SyncMessage),
    close: () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    },
  };
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
