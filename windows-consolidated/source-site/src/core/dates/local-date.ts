import type { LocalDate, WeekStart } from "./types"

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function toLocalDate(value: Date): LocalDate {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-")
}

export function fromLocalDate(value: LocalDate): Date {
  const match = DATE_PATTERN.exec(value)
  if (!match) {
    throw new Error(`Invalid local date: ${value}`)
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (toLocalDate(date) !== value) {
    throw new Error(`Invalid calendar date: ${value}`)
  }
  return date
}

export function addDays(value: LocalDate, amount: number): LocalDate {
  const date = fromLocalDate(value)
  date.setDate(date.getDate() + amount)
  return toLocalDate(date)
}

export function addMonths(value: LocalDate, amount: number): LocalDate {
  const date = fromLocalDate(value)
  const originalDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + amount)
  date.setDate(Math.min(originalDay, daysInMonth(date.getFullYear(), date.getMonth())))
  return toLocalDate(date)
}

export function addYears(value: LocalDate, amount: number): LocalDate {
  return addMonths(value, amount * 12)
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left.localeCompare(right)
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function startOfMonth(value: LocalDate): LocalDate {
  const date = fromLocalDate(value)
  date.setDate(1)
  return toLocalDate(date)
}

export function startOfWeek(value: LocalDate, weekStartsOn: WeekStart = 0): LocalDate {
  const date = fromLocalDate(value)
  const offset = (date.getDay() - weekStartsOn + 7) % 7
  return addDays(value, -offset)
}

export function isSameMonth(left: LocalDate, right: LocalDate): boolean {
  return left.slice(0, 7) === right.slice(0, 7)
}

export function isOverdue(date: LocalDate, today: LocalDate): boolean {
  return compareLocalDates(date, today) < 0
}
