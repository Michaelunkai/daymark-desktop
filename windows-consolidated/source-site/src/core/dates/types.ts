export type LocalDate = string

export type WeekStart = 0 | 1

export type RecurrenceUnit = "day" | "week" | "month" | "year"

export type RecurrenceRule = {
  interval: number
  unit: RecurrenceUnit
  weekdays?: number[]
  mode: "scheduled" | "completed"
  until?: LocalDate
  text: string
}

export type ParsedDateExpression = {
  date: LocalDate
  text: string
  range: [start: number, end: number]
  time?: string
  recurrence?: RecurrenceRule
}

export type CalendarDay = {
  date: LocalDate
  day: number
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  isDisabled: boolean
}
