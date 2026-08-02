import {
  addDays,
  addMonths,
  addYears,
  fromLocalDate,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"

export type UpcomingCalendarView = "week" | "month" | "year"

export type UpcomingTask = {
  id: string
  due: {
    date: LocalDate
    time: string | null
    timezone: string | null
    recurrence: string | null
  } | null
  order?: number
}

export type UpcomingRange = {
  view: UpcomingCalendarView
  focus: LocalDate
  start: LocalDate
  end: LocalDate
}

export function buildUpcomingRange(
  view: UpcomingCalendarView,
  focus: LocalDate,
  weekStartsOn: WeekStart = 0,
): UpcomingRange {
  const selectedDate = selectUpcomingDate(focus)

  if (view === "week") {
    const start = startOfWeek(selectedDate, weekStartsOn)
    return { view, focus: selectedDate, start, end: addDays(start, 6) }
  }

  if (view === "month") {
    const start = startOfMonth(selectedDate)
    return { view, focus: selectedDate, start, end: addDays(addMonths(start, 1), -1) }
  }

  const year = fromLocalDate(selectedDate).getFullYear()
  return {
    view,
    focus: selectedDate,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  }
}

export function navigateUpcomingRange(
  view: UpcomingCalendarView,
  focus: LocalDate,
  amount: number,
): LocalDate {
  selectUpcomingDate(focus)

  if (view === "week") return addDays(focus, amount * 7)
  if (view === "month") return addMonths(focus, amount)
  return addYears(focus, amount)
}

export function bucketTasksByDate<Task extends UpcomingTask>(
  tasks: readonly Task[],
): Record<LocalDate, Task[]> {
  const buckets: Record<LocalDate, Task[]> = {}

  for (const task of tasks) {
    if (!task.due) continue
    ;(buckets[task.due.date] ??= []).push(task)
  }

  for (const bucket of Object.values(buckets)) {
    bucket.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))
  }

  return buckets
}

export function countTasksByDate(tasks: readonly UpcomingTask[]): Record<LocalDate, number> {
  return Object.fromEntries(
    Object.entries(bucketTasksByDate(tasks)).map(([date, scheduledTasks]) => [date, scheduledTasks.length]),
  )
}

export function selectUpcomingDate(date: LocalDate): LocalDate {
  return toLocalDate(fromLocalDate(date))
}

export function moveTaskToDate<Task extends UpcomingTask>(task: Task, date: LocalDate): Task {
  const selectedDate = selectUpcomingDate(date)
  return {
    ...task,
    due: {
      date: selectedDate,
      time: task.due?.time ?? null,
      timezone: task.due?.timezone ?? null,
      recurrence: task.due?.recurrence ?? null,
    },
  }
}
