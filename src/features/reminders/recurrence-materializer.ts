import { nextOccurrence, parseRecurrence } from "../../core/dates";

export interface RecurringDue {
  date: string;
  recurrence: string | null;
  time: string | null;
  timezone: string | null;
}

export interface RecurringTaskSource {
  due: RecurringDue | null;
  id: string;
}

export interface MaterializedOccurrence {
  due: RecurringDue;
  id: string;
  sourceTaskId: string;
}

type ZonedParts = {
  date: string;
  time: string;
};

const MINUTE_MS = 60_000;
const SEARCH_RADIUS_MS = 16 * 60 * 60 * 1_000;

export function occurrenceId(taskId: string, date: string): string {
  return `${taskId}:occurrence:${date}`;
}

export function materializeNextOccurrence(
  task: RecurringTaskSource,
  completedOn: string,
): MaterializedOccurrence | null {
  if (!task.due?.recurrence) return null;
  const rule = parseRecurrence(task.due.recurrence);
  if (!rule) return null;

  const date = nextOccurrence(task.due.date, rule, completedOn);
  if (!date) return null;
  return {
    due: { ...task.due, date },
    id: occurrenceId(task.id, date),
    sourceTaskId: task.id,
  };
}

export function dueInstantForTask(
  due: Pick<RecurringDue, "date" | "time" | "timezone">,
): Date | null {
  if (!due.time) return null;
  return zonedDateTimeToInstant(due.date, due.time, due.timezone ?? undefined);
}

/**
 * Resolves a wall-clock due time by searching actual instants. During a DST
 * fold it chooses the earlier matching instant; during a gap it rolls forward
 * to the first valid local minute.
 */
export function zonedDateTimeToInstant(
  date: string,
  time: string,
  timezone?: string,
): Date | null {
  if (!isDate(date) || !isTime(time)) return null;
  if (!timezone) {
    const local = new Date(`${date}T${time}:00`);
    return Number.isNaN(local.getTime()) ? null : local;
  }

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
  } catch {
    return null;
  }

  const target = { date, time };
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let nextValid: Date | null = null;

  for (let timestamp = guess - SEARCH_RADIUS_MS; timestamp <= guess + SEARCH_RADIUS_MS; timestamp += MINUTE_MS) {
    const candidate = new Date(timestamp);
    const observed = partsInTimeZone(candidate, timezone);
    if (observed.date === target.date && observed.time === target.time) return candidate;
    if (!nextValid && compareParts(observed, target) > 0) nextValid = candidate;
  }

  return nextValid;
}

function partsInTimeZone(value: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    hour12: false,
    hourCycle: "h23",
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function compareParts(left: ZonedParts, right: ZonedParts): number {
  return `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function isTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}
