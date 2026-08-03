import { fromLocalDate, toLocalDate } from "../../core/dates";
import type { DiaryEntry, Note } from "../../core/types";

export type WritingMode = "notes" | "diary";
export type WritingSearchResult =
  | { kind: "note"; item: Note; score: number }
  | { kind: "diary"; item: DiaryEntry; score: number };

export function normalizeWritingQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return Number(right.isPinned) - Number(left.isPinned);
    return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
  });
}

export function getDiaryDates(entries: readonly DiaryEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.date))].sort((left, right) => right.localeCompare(left));
}

export function sortDiaryEntries(entries: readonly DiaryEntry[], date?: string): DiaryEntry[] {
  return [...entries]
    .filter((entry) => !date || entry.date === date)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}

export function searchWriting(
  mode: WritingMode,
  query: string,
  notes: readonly Note[],
  diaryEntries: readonly DiaryEntry[],
): WritingSearchResult[] {
  const normalizedQuery = normalizeWritingQuery(query);
  const source = mode === "notes"
    ? notes.map((item) => ({ kind: "note" as const, item }))
    : diaryEntries.map((item) => ({ kind: "diary" as const, item }));

  if (!normalizedQuery) {
    const ordered = mode === "notes"
      ? sortNotes(notes).map((item) => ({ kind: "note" as const, item }))
      : sortDiaryEntries(diaryEntries).map((item) => ({ kind: "diary" as const, item }));
    return ordered.map(({ kind, item }) => ({ kind, item, score: 0 }));
  }

  return source
    .map(({ kind, item }) => {
      const searchable = kind === "note"
        ? `${item.title} ${item.content} ${item.tags.join(" ")}`
        : `${item.title} ${item.content} ${item.tags.join(" ")} ${item.date} ${item.mood ?? ""}`;
      const normalized = normalizeWritingQuery(searchable);
      const title = normalizeWritingQuery(item.title);
      const score = title === normalizedQuery
        ? 1000
        : title.startsWith(normalizedQuery)
          ? 800
          : normalized.includes(normalizedQuery)
            ? 400
            : Number.NEGATIVE_INFINITY;
      return { kind, item, score };
    })
    .filter((result) => result.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt));
}

export function countWords(value: string): number {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export function formatDiaryDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "Choose a date";
  return new Intl.DateTimeFormat(undefined, options ?? {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(fromLocalDate(value));
}

export function todayLocalDate(): string {
  return toLocalDate(new Date());
}

export function relativeDiaryDate(value: string, today = todayLocalDate()): string {
  if (value === today) return "Today";
  const date = fromLocalDate(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
