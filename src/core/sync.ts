import type { AppState } from "./types";

const SYNC_KEY = "daymark.sync-key";
const SYNC_ADOPT_REMOTE_KEY = "daymark.sync-adopt-remote";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SYNC_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;
const SYNC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type SyncStatus = "starting" | "synced" | "syncing" | "offline" | "conflict";

type SyncMessage = {
  source: string;
  state: AppState;
};

export type DeferredRemoteState<T> = {
  state: T;
  revision: number;
};

export function createInteractionSyncGate<T>() {
  let interactionOpen = false;
  let deferred: DeferredRemoteState<T> | null = null;

  return {
    setInteractionOpen(isOpen: boolean): DeferredRemoteState<T> | null {
      interactionOpen = isOpen;
      if (isOpen || !deferred) return null;
      const next = deferred;
      deferred = null;
      return next;
    },
    defer(state: T, revision: number): boolean {
      if (!interactionOpen) return false;
      deferred = { state, revision };
      return true;
    },
  };
}

export function getSyncKey(storage?: Pick<Storage, "getItem" | "setItem"> | null): string {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const fromUrl = params.get("sync") ?? "";
  if (SYNC_PATTERN.test(fromUrl)) {
    persistSyncKey(fromUrl, storage);
    writeSyncCookie(fromUrl);
    return fromUrl;
  }

  const fromCookie = readSyncCookie();
  if (SYNC_PATTERN.test(fromCookie)) {
    persistSyncKey(fromCookie, storage);
    return fromCookie;
  }

  try {
    const stored = storage?.getItem(SYNC_KEY) ?? "";
    if (SYNC_PATTERN.test(stored)) return stored;
  } catch {
    // Fall through to a session-usable key.
  }

  const key = createSyncKey();
  persistSyncKey(key, storage, false);
  writeSyncCookie(key);
  return key;
}

export function pairSyncKey(
  value: string,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): string | null {
  const candidate = value.trim();
  const fromLink = (() => {
    try {
      return new URL(candidate).searchParams.get("sync") ?? "";
    } catch {
      return candidate;
    }
  })();
  if (!SYNC_PATTERN.test(fromLink)) return null;
  persistSyncKey(fromLink, storage);
  writeSyncCookie(fromLink);
  return fromLink;
}

function createSyncKey(): string {
  const values = new Uint8Array(22);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(values, (value) => SYNC_ALPHABET[value & 63]).join("");
}

function persistSyncKey(
  key: string,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
  adoptRemote = true,
): void {
  try {
    const previous = storage?.getItem(SYNC_KEY) ?? "";
    if (adoptRemote && previous !== key) storage?.setItem(SYNC_ADOPT_REMOTE_KEY, key);
    storage?.setItem(SYNC_KEY, key);
  } catch {
    // The URL or pairing cookie remains authoritative when storage is unavailable.
  }
}

function readSyncCookie(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${SYNC_KEY}=`;
  const entry = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return "";
  }
}

function writeSyncCookie(key: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SYNC_KEY}=${encodeURIComponent(key)}; Path=/; Max-Age=${SYNC_COOKIE_MAX_AGE}; Secure; SameSite=Strict`;
}

export function consumeRemoteAdoption(
  key: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): boolean {
  try {
    const pendingKey = storage?.getItem(SYNC_ADOPT_REMOTE_KEY) ?? "";
    if (pendingKey !== key) return false;
    storage?.removeItem(SYNC_ADOPT_REMOTE_KEY);
    return true;
  } catch {
    return false;
  }
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

export async function waitForSyncChange(
  key: string,
  afterRevision: number,
  signal?: AbortSignal,
): Promise<{ state: AppState | null; revision: number }> {
  const response = await fetch(
    `/api/sync/${encodeURIComponent(key)}/changes?after=${encodeURIComponent(afterRevision)}`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (response.status === 204) return { state: null, revision: afterRevision };
  if (!response.ok) throw new Error(`Sync change stream failed (${response.status}).`);
  const payload = await response.json();
  return { state: payload.state ?? null, revision: Number(payload.revision ?? 0) };
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

  const merged: AppState = {
    ...structuredClone(remote),
    revision: Math.max(local.revision, remote.revision),
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
    clientId: local.clientId,
    projects: newerRecord(local.projects, remote.projects),
    sections: newerRecord(local.sections, remote.sections),
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
    syncTombstones: mergeTombstones(local.syncTombstones, remote.syncTombstones),
  };
  applyTombstones(merged);
  return merged;
}

export function rebaseSyncConflict(
  local: AppState,
  remote: AppState,
  remoteRevision: number,
  now = new Date().toISOString(),
): AppState {
  const merged = mergeSyncStates(local, remote);
  return {
    ...merged,
    revision: Math.max(local.revision, remote.revision, remoteRevision) + 1,
    updatedAt: now,
  };
}

export function syncStatesMatch(left: AppState, right: AppState): boolean {
  return stableSerialize(syncComparableState(left)) === stableSerialize(syncComparableState(right));
}

function syncComparableState(state: AppState): Omit<AppState, "clientId" | "revision" | "updatedAt"> {
  const comparable = structuredClone(state) as AppState & {
    clientId?: string;
    revision?: number;
    updatedAt?: string;
  };
  delete comparable.clientId;
  delete comparable.revision;
  delete comparable.updatedAt;
  return comparable;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mergeTombstones(
  local: AppState["syncTombstones"],
  remote: AppState["syncTombstones"],
): AppState["syncTombstones"] {
  const merged = { ...(remote ?? {}) };
  Object.entries(local ?? {}).forEach(([key, tombstone]) => {
    const other = merged[key];
    if (!other || tombstone.deletedAt >= other.deletedAt) merged[key] = structuredClone(tombstone);
  });
  return merged;
}

function applyTombstones(state: AppState): void {
  const collections: Record<string, Record<string, { updatedAt: string }>> = {
    projects: state.projects,
    sections: state.sections,
    filters: state.filters,
    tasks: state.tasks,
    orderItems: state.orderItems,
    notes: state.notes,
    diaryEntries: state.diaryEntries,
  };
  Object.entries(state.syncTombstones ?? {}).forEach(([key, tombstone]) => {
    const separator = key.indexOf(":");
    if (separator < 1) return;
    const collection = key.slice(0, separator);
    const id = key.slice(separator + 1);
    const record = collections[collection]?.[id];
    if (record && tombstone.deletedAt >= record.updatedAt) delete collections[collection][id];
  });
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
