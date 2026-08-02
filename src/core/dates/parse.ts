import { addDays, fromLocalDate, toLocalDate } from "./local-date"
import type { LocalDate, ParsedDateExpression, RecurrenceRule } from "./types"

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const RECURRENCE_PATTERN = /\bevery(!?)\s+(?:(\d+)\s+)?(day|week|month|year)s?\b/i

export function parseDateExpression(input: string, today: LocalDate): ParsedDateExpression | undefined {
  const recurrence = parseRecurrence(input)
  const phrase = recurrence
    ? { text: recurrence.text, start: 0, end: recurrence.text.length }
    : findDatePhrase(input)
  if (!phrase) {
    return undefined
  }

  const date = recurrence ? today : resolveDatePhrase(phrase.text, today)
  if (!date) {
    return undefined
  }

  const time = parseTime(input.slice(phrase.end))
  const end = time ? phrase.end + time.end : phrase.end
  return {
    date,
    text: input.slice(phrase.start, end),
    range: [phrase.start, end],
    ...(time ? { time: time.value } : {}),
    ...(recurrence ? { recurrence } : {}),
  }
}

export function parseRecurrence(input: string): RecurrenceRule | undefined {
  const match = RECURRENCE_PATTERN.exec(input.trim())
  if (!match || match.index !== 0) {
    return undefined
  }

  const interval = Number(match[2] ?? "1")
  if (!Number.isSafeInteger(interval) || interval < 1) {
    return undefined
  }

  return {
    interval,
    unit: match[3].toLowerCase() as RecurrenceRule["unit"],
    mode: match[1] === "!" ? "completed" : "scheduled",
    text: match[0],
  }
}

function findDatePhrase(input: string): { text: string; start: number; end: number } | undefined {
  const patterns = [
    /\bday after tomorrow\b/i,
    /\btomorrow\b/i,
    /\btoday\b/i,
    /\bin\s+\d+\s+days?\b/i,
    /\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    /\b\d{4}-\d{2}-\d{2}\b/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(input)
    if (match) {
      return { text: match[0], start: match.index, end: match.index + match[0].length }
    }
  }
  return undefined
}

function resolveDatePhrase(value: string, today: LocalDate): LocalDate | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === "today") return today
  if (normalized === "tomorrow") return addDays(today, 1)
  if (normalized === "day after tomorrow") return addDays(today, 2)

  const offset = /^in\s+(\d+)\s+days?$/.exec(normalized)
  if (offset) return addDays(today, Number(offset[1]))

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    try {
      return toLocalDate(fromLocalDate(normalized))
    } catch {
      return undefined
    }
  }

  const weekdayMatch = /^(next\s+)?(.+)$/.exec(normalized)
  if (!weekdayMatch || WEEKDAYS[weekdayMatch[2]] === undefined) {
    return undefined
  }

  const targetDay = WEEKDAYS[weekdayMatch[2]]
  const currentDay = fromLocalDate(today).getDay()
  let offsetToWeekday = (targetDay - currentDay + 7) % 7
  if (weekdayMatch[1]) {
    offsetToWeekday = offsetToWeekday || 7
  }
  return addDays(today, offsetToWeekday)
}

function parseTime(value: string): { value: string; end: number } | undefined {
  const match = /^\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(value)
  if (!match) {
    return undefined
  }

  const hour = Number(match[1])
  const minute = Number(match[2] ?? "0")
  if (hour < 1 || hour > 12 || minute > 59) {
    return undefined
  }

  const hour24 = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0)
  return { value: `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, end: match[0].length }
}
