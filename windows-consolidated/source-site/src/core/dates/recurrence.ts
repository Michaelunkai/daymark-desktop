import { addDays, addMonths, addYears, compareLocalDates, fromLocalDate } from "./local-date"
import type { LocalDate, RecurrenceRule } from "./types"

export function nextOccurrence(
  dueDate: LocalDate,
  rule: RecurrenceRule,
  completedOn: LocalDate,
): LocalDate | undefined {
  const reference = rule.mode === "completed" ? completedOn : dueDate
  let next = advanceOnce(reference, rule)

  if (rule.mode === "scheduled") {
    while (compareLocalDates(next, completedOn) <= 0) {
      next = advanceOnce(next, rule)
    }
  }

  return rule.until && compareLocalDates(next, rule.until) > 0 ? undefined : next
}

function advanceOnce(date: LocalDate, rule: RecurrenceRule): LocalDate {
  if (rule.weekdays?.length) {
    return nextWeekday(date, rule.weekdays)
  }

  switch (rule.unit) {
    case "day":
      return addDays(date, rule.interval)
    case "week":
      return addDays(date, rule.interval * 7)
    case "month":
      return addMonths(date, rule.interval)
    case "year":
      return addYears(date, rule.interval)
  }
}

function nextWeekday(date: LocalDate, weekdays: number[]): LocalDate {
  const current = fromLocalDate(date).getDay()
  const sorted = [...new Set(weekdays)].sort((left, right) => left - right)
  if (!sorted.length) {
    return addDays(date, 7)
  }

  const next = sorted.find((weekday) => weekday > current)
  return addDays(date, next === undefined ? sorted[0] + 7 - current : next - current)
}
