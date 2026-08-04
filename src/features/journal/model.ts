import type { DiaryEntry, Note } from "../../core/types";

export const LEGACY_JOURNAL_STORAGE_KEY = "daymark.journal.v1";

export type LegacyJournalSnapshot = {
  version: 1;
  notes: Note[];
  diary: Record<string, DiaryEntry>;
};

export function readLegacyJournal(
  storage: Pick<Storage, "getItem"> | null | undefined,
): LegacyJournalSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_JOURNAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(isNote)
      : [];
    const diary = isRecord(parsed.diary)
      ? Object.fromEntries(Object.entries(parsed.diary).filter(([, value]) => isDiaryEntry(value)))
      : {};
    return { version: 1, notes, diary };
  } catch {
    return null;
  }
}

export function clearLegacyJournal(
  storage: Pick<Storage, "removeItem"> | null | undefined,
): void {
  try {
    storage?.removeItem(LEGACY_JOURNAL_STORAGE_KEY);
  } catch {
    // Legacy cleanup is best effort; current state is already durable.
  }
}

function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isDiaryEntry(value: unknown): value is DiaryEntry {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.body === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
