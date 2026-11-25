import type { Reminder, ReminderInput, SyncTombstone } from "./types";

type ReminderIdentityInput = Partial<ReminderInput> & {
  id?: string | null;
};

type ReminderTombstone = SyncTombstone & {
  canonicalId?: string;
  semanticId?: string;
  aliases?: string[];
};

export function canonicalReminderId(value: string | ReminderIdentityInput): string {
  if (typeof value === "string") return value.trim();
  const explicit = typeof value.id === "string" ? value.id.trim() : "";
  return explicit || `reminder-${hash(reminderSemanticKey(value))}`;
}

export const createCanonicalReminderId = canonicalReminderId;

export function semanticReminderId(value: ReminderIdentityInput): string {
  return `reminder-${hash(reminderSemanticKey(value))}`;
}

export function reminderSemanticKey(value: ReminderIdentityInput): string {
  return stableSerialize({
    title: typeof value.title === "string" ? value.title.trim() : "",
    details: typeof value.details === "string" ? value.details.trim() : "",
    eventAt: normalizeDate(value.eventAt),
    target: normalizeTarget(value.target),
    offsets: normalizeOffsets(value.offsets),
  });
}

export function nextStrictTimestamp(
  requestedAt = new Date().toISOString(),
  ...previousTimestamps: Array<string | null | undefined>
): string {
  const requestedMs = parseTimestamp(requestedAt) ?? Date.now();
  const previousMs = previousTimestamps.reduce(
    (latest, timestamp) => Math.max(latest, parseTimestamp(timestamp) ?? Number.MIN_SAFE_INTEGER),
    Number.MIN_SAFE_INTEGER,
  );
  const nextMs = previousMs >= requestedMs ? previousMs + 1 : requestedMs;
  return new Date(nextMs).toISOString();
}

export const nextMutationTimestamp = nextStrictTimestamp;

export function compareBinaryStrings(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function compareMutationTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftMs = parseTimestamp(left);
  const rightMs = parseTimestamp(right);
  if (leftMs !== null && rightMs !== null && leftMs !== rightMs) return leftMs - rightMs;
  if (leftMs !== null && rightMs === null) return 1;
  if (leftMs === null && rightMs !== null) return -1;
  return compareBinaryStrings(String(left ?? ""), String(right ?? ""));
}

export function compareRecordAuthority<T extends { updatedAt?: string | null }>(
  left: T,
  right: T,
): number {
  const timestampOrder = compareMutationTimestamp(left.updatedAt, right.updatedAt);
  if (timestampOrder !== 0) return timestampOrder;
  return compareBinaryStrings(stableSerialize(left), stableSerialize(right));
}

export function compareTombstoneAuthority(left: SyncTombstone, right: SyncTombstone): number {
  const timestampOrder = compareMutationTimestamp(left.deletedAt, right.deletedAt);
  if (timestampOrder !== 0) return timestampOrder;
  return compareBinaryStrings(stableSerialize(left), stableSerialize(right));
}

export function canonicalizeReminders(
  reminders: Record<string, Reminder> | null | undefined,
): Record<string, Reminder> {
  const canonical: Record<string, Reminder> = {};
  const semanticIds = new Map<string, string>();
  Object.entries(reminders ?? {}).forEach(([key, reminder]) => {
    if (!reminder || typeof reminder !== "object") return;
    const candidate = structuredClone(reminder);
    candidate.id = canonicalReminderId({ ...candidate, id: candidate.id || key });
    const semanticId = semanticReminderId(candidate);
    const existing = canonical[candidate.id] ?? canonical[semanticIds.get(semanticId) ?? ""];
    if (!existing || compareRecordAuthority(candidate, existing) > 0) {
      if (existing && existing.id !== candidate.id) delete canonical[existing.id];
      canonical[candidate.id] = candidate;
      semanticIds.set(semanticId, candidate.id);
    }
  });
  return canonical;
}

export function canonicalizeReminderTombstones(
  tombstones: Record<string, SyncTombstone> | null | undefined,
  reminders?: Record<string, Reminder> | null,
): Record<string, SyncTombstone> {
  const reminderAliases = new Map<string, string>();
  Object.entries(reminders ?? {}).forEach(([key, reminder]) => {
    if (!reminder || typeof reminder !== "object") return;
    const canonicalId = canonicalReminderId(reminder);
    addAlias(reminderAliases, key, canonicalId);
    addAlias(reminderAliases, reminder.id, canonicalId);
    addAlias(reminderAliases, canonicalId, canonicalId);
    addAlias(reminderAliases, semanticReminderId(reminder), canonicalId);
  });

  const canonical: Record<string, SyncTombstone> = {};
  Object.entries(tombstones ?? {}).forEach(([rawKey, tombstone]) => {
    if (!tombstone || typeof tombstone.deletedAt !== "string") return;
    const separator = rawKey.indexOf(":");
    if (separator < 1) return;
    const collection = rawKey.slice(0, separator);
    const rawId = rawKey.slice(separator + 1).trim();
    if (!rawId) return;

    const metadata = tombstone as ReminderTombstone;
    const aliases = Array.isArray(metadata.aliases)
      ? metadata.aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
    const metadataId = typeof metadata.canonicalId === "string"
      ? metadata.canonicalId.trim()
      : "";
    const metadataSemanticId = typeof metadata.semanticId === "string"
      ? metadata.semanticId.trim()
      : "";
    const id = collection === "reminders"
      ? aliases
          .map((alias) => reminderAliases.get(alias) ?? "")
          .find(Boolean) ||
        reminderAliases.get(rawId) ||
        (metadataSemanticId ? reminderAliases.get(metadataSemanticId) ?? metadataSemanticId : "") ||
        (metadataId ? reminderAliases.get(metadataId) ?? metadataId : rawId)
      : rawId;
    const key = `${collection}:${id}`;
    const existing = canonical[key];
    if (!existing || compareTombstoneAuthority(tombstone, existing) > 0) {
      const normalized = structuredClone(tombstone) as ReminderTombstone;
      if (collection === "reminders") {
        normalized.canonicalId = id;
        normalized.aliases = uniqueStrings([rawId, ...aliases, metadataId, metadataSemanticId, id]);
        normalized.semanticId = metadataSemanticId || id;
      }
      canonical[key] = normalized;
    }
  });
  return canonical;
}

function addAlias(aliases: Map<string, string>, value: unknown, canonicalId: string): void {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (normalized) aliases.set(normalized, canonicalId);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeTarget(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  return {
    kind: target.kind ?? null,
    projectId: target.projectId ?? null,
    sectionId: target.sectionId ?? null,
    orderLane: target.orderLane ?? null,
  };
}

function normalizeOffsets(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((offset) => {
      if (!offset || typeof offset !== "object" || Array.isArray(offset)) {
        return { minutes: null, direction: null, sound: null };
      }
      const entry = offset as Record<string, unknown>;
      return {
        minutes: entry.minutes ?? null,
        direction: entry.direction ?? null,
        sound: entry.sound ?? null,
      };
    })
    .sort((left, right) => compareBinaryStrings(stableSerialize(left), stableSerialize(right)));
}

function normalizeDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.trim();
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareBinaryStrings(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
