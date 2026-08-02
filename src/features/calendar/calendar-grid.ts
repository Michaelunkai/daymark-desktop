import {
  addDays,
  compareLocalDates,
  fromLocalDate,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  type CalendarDay,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"

export function buildMonthGrid(options: {
  month: LocalDate
  today: LocalDate
  selectedDate?: LocalDate
  minDate?: LocalDate
  maxDate?: LocalDate
  weekStartsOn?: WeekStart
}): CalendarDay[] {
  const firstDay = startOfMonth(options.month)
  const start = startOfWeek(firstDay, options.weekStartsOn)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    return {
      date,
      day: fromLocalDate(date).getDate(),
      isCurrentMonth: isSameMonth(date, options.month),
      isToday: date === options.today,
      isSelected: date === options.selectedDate,
      isDisabled:
        (options.minDate !== undefined && compareLocalDates(date, options.minDate) < 0) ||
        (options.maxDate !== undefined && compareLocalDates(date, options.maxDate) > 0),
    }
  })
}

export function shiftMonth(month: LocalDate, amount: number): LocalDate {
  const date = fromLocalDate(month)
  date.setDate(1)
  date.setMonth(date.getMonth() + amount)
  return toLocalDate(date)
}

export function weekdayLabels(weekStartsOn: WeekStart = 0): string[] {
  const anchor = new Date(2023, 0, 1)
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
      new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + weekStartsOn + index),
    ),
  )
}

export function dateForCalendarKey(key: string, date: LocalDate, weekStartsOn: WeekStart): LocalDate | undefined {
  if (key === "ArrowLeft") return addDays(date, -1)
  if (key === "ArrowRight") return addDays(date, 1)
  if (key === "ArrowUp") return addDays(date, -7)
  if (key === "ArrowDown") return addDays(date, 7)
  if (key === "Home") return startOfWeek(date, weekStartsOn)
  if (key === "End") return addDays(startOfWeek(date, weekStartsOn), 6)
  return undefined
}
