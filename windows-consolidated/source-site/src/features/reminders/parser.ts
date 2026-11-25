import { fromLocalDate, parseDateExpression, toLocalDate } from "../../core/dates";

const TIME_ONLY_PATTERN = /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
const RELATIVE_PATTERN = /^in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?)$/i;

export function parseReminderText(input: string, now = new Date()): string | null {
  const value = input.trim();
  if (!value) return null;

  const relative = RELATIVE_PATTERN.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    if (!Number.isSafeInteger(amount) || amount < 1) return null;
    const unit = relative[2].toLowerCase();
    const milliseconds = unit.startsWith("minute") || unit.startsWith("min")
      ? amount * 60_000
      : unit.startsWith("hour") || unit.startsWith("hr")
        ? amount * 3_600_000
        : amount * 86_400_000;
    return new Date(now.getTime() + milliseconds).toISOString();
  }

  const timeOnly = TIME_ONLY_PATTERN.exec(value);
  if (timeOnly) {
    const time = parseClock(timeOnly[1], timeOnly[2], timeOnly[3]);
    if (!time) return null;
    const candidate = new Date(now);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }

  const parsed = parseDateExpression(value, toLocalDate(now));
  if (!parsed) return null;
  const candidate = fromLocalDate(parsed.date);
  const [hour, minute] = (parsed.time ?? "09:00").split(":").map(Number);
  candidate.setHours(hour, minute, 0, 0);
  return candidate.toISOString();
}

export function formatReminderText(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hour = date.getHours();
  const suffix = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 || 12;
  return `${toLocalDate(date)} at ${hour12}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
}

function parseClock(hourText: string, minuteText: string | undefined, suffix: string): { hour: number; minute: number } | null {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return {
    hour: (hour % 12) + (suffix.toLowerCase() === "pm" ? 12 : 0),
    minute,
  };
}
