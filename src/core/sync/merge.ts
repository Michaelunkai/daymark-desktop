import type { SyncRecord } from "./types";

export type MergeResult<T extends SyncRecord> =
  | { ok: true; record: T; localFields: string[]; remoteFields: string[] }
  | { ok: false; fields: string[] };

const IMMUTABLE_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

export function mergeCompetingEdits<T extends SyncRecord>(base: T | null, local: T | null, remote: T | null): MergeResult<T> {
  if (!base || !local || !remote || base.id !== local.id || base.id !== remote.id) {
    return { ok: false, fields: ["record"] };
  }

  const fields = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const merged = { ...remote } as T;
  const localFields: string[] = [];
  const remoteFields: string[] = [];
  const conflicts: string[] = [];

  for (const field of fields) {
    if (IMMUTABLE_FIELDS.has(field)) continue;
    const before = base[field];
    const localValue = local[field];
    const remoteValue = remote[field];
    const localChanged = !equal(localValue, before);
    const remoteChanged = !equal(remoteValue, before);

    if (localChanged) localFields.push(field);
    if (remoteChanged) remoteFields.push(field);
    if (localChanged && remoteChanged && !equal(localValue, remoteValue)) {
      conflicts.push(field);
      continue;
    }
    if (localChanged) merged[field] = structuredClone(localValue);
  }

  if (conflicts.length) return { ok: false, fields: conflicts };

  const localUpdatedAt = typeof local.updatedAt === "string" ? local.updatedAt : "";
  const remoteUpdatedAt = typeof remote.updatedAt === "string" ? remote.updatedAt : "";
  if ("updatedAt" in merged) merged.updatedAt = localUpdatedAt > remoteUpdatedAt ? localUpdatedAt : remoteUpdatedAt;
  return { ok: true, record: merged, localFields, remoteFields };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
