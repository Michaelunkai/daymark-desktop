import {
  addDays,
  addMonths,
  addYears,
  startOfMonth,
  startOfWeek,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"

export type CalendarTaskLike = {
  id: string
  dueDate: LocalDate
  completed?: boolean
}

export type CalendarDayDensity = {
  active: number
  completed: number
  total: number
}

export type CalendarMode = "week" | "month" | "year"

type CalendarTaskDragPayload = {
  taskId: string
  sourceDate: LocalDate
}

export function dayDensity(tasks: readonly Pick<CalendarTaskLike, "completed">[]): CalendarDayDensity {
  const completed = tasks.filter((task) => Boolean(task.completed)).length
  return { active: tasks.length - completed, completed, total: tasks.length }
}

export function createCalendarTaskDragPayload(task: CalendarTaskLike): string {
  return JSON.stringify({ taskId: task.id, sourceDate: task.dueDate })
}

export function parseCalendarTaskDragPayload(value: string): CalendarTaskDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.taskId !== "string" || !parsed.taskId.trim() || !isLocalDate(parsed.sourceDate)) {
      return null
    }
    return { taskId: parsed.taskId, sourceDate: parsed.sourceDate }
  } catch {
    return null
  }
}

export function calendarRange(mode: CalendarMode, cursor: LocalDate, weekStartsOn: WeekStart): LocalDate[] {
  if (mode === "year") return []
  if (mode === "week") {
    const start = startOfWeek(cursor, weekStartsOn)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }
  const start = startOfWeek(startOfMonth(cursor), weekStartsOn)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

export function navigateDate(mode: CalendarMode, date: LocalDate, amount: number): LocalDate {
  if (mode === "week") return addDays(date, amount * 7)
  if (mode === "month") return addMonths(date, amount)
  return addYears(date, amount)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
