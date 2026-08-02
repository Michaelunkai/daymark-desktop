import { compareLocalDates, fromLocalDate } from "./local-date"
import type { LocalDate } from "./types"

export function formatDate(date: LocalDate, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...options,
  }).format(fromLocalDate(date))
}

export function formatDateLabel(date: LocalDate, today: LocalDate): string {
  const difference = daysBetween(today, date)
  if (difference === 0) return "Today"
  if (difference === 1) return "Tomorrow"
  if (difference === -1) return "Yesterday"
  return formatDate(date, { weekday: "short", month: "short", day: "numeric" })
}

export function dateStatus(date: LocalDate, today: LocalDate): "overdue" | "today" | "upcoming" {
  const comparison = compareLocalDates(date, today)
  return comparison < 0 ? "overdue" : comparison === 0 ? "today" : "upcoming"
}

function daysBetween(start: LocalDate, end: LocalDate): number {
  const startDate = fromLocalDate(start)
  const endDate = fromLocalDate(end)
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)
}
