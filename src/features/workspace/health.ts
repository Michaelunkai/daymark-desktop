export interface UpdateAge {
  label: string;
  state: "fresh" | "due" | "late" | "none";
  ageMin: number;
}

const FRESH_MAX_MIN = 5;
const DUE_MAX_MIN = 10;
const MINUTES_PER_DAY = 24 * 60;

// Journal lines look like: — update 09:32 — / — heartbeat 14:07 — / — REOPENED 08:01 —
const JOURNAL_MARKERS = ["— update", "— heartbeat", "— REOPENED", "— PAUSED", "— RESUMED"] as const;

function parseJournalTime(line: string): number | null {
  const marker = JOURNAL_MARKERS.find((m) => line.startsWith(m));
  if (!marker) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(line.slice(marker.length).trimStart());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function updateAgeState(newestJournalLine: string | null | undefined, nowMs: number): UpdateAge {
  if (newestJournalLine == null) {
    return { label: "no updates yet", state: "none", ageMin: -1 };
  }
  const journalMin = parseJournalTime(newestJournalLine);
  if (journalMin == null) {
    return { label: "no updates yet", state: "none", ageMin: -1 };
  }
  const now = new Date(nowMs);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let ageMin = nowMin - journalMin;
  if (ageMin < 0) {
    // -1..0 is routine HH:MM truncation skew (journal 09:30:59 vs clock 09:30:01);
    // anything further past means the journal line is from yesterday.
    ageMin = ageMin <= -2 ? ageMin + MINUTES_PER_DAY : 0;
  }
  if (ageMin < FRESH_MAX_MIN) {
    return { label: `updated ${ageMin}m ago`, state: "fresh", ageMin };
  }
  if (ageMin < DUE_MAX_MIN) {
    return { label: "update due", state: "due", ageMin };
  }
  return { label: `overdue ${ageMin}m`, state: "late", ageMin };
}

export interface BoardHealth {
  onTime: number;
  watched: number;
  oldestMin: number;
}

export function boardHealth(descriptions: ReadonlyArray<string>, nowMs: number): BoardHealth {
  let onTime = 0;
  let watched = 0;
  let oldestMin = -1;
  for (const description of descriptions) {
    const firstLine = description.split(/\r?\n/, 1)[0] ?? "";
    const { state, ageMin } = updateAgeState(firstLine, nowMs);
    if (state === "none") continue;
    watched += 1;
    if (state === "fresh") onTime += 1;
    if (ageMin > oldestMin) oldestMin = ageMin;
  }
  return { onTime, watched, oldestMin };
}

// SLICE-DONE: observability-engineer
