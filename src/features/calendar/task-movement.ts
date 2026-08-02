import { addDays, addMonths, addYears, fromLocalDate, type LocalDate } from "../../core/dates"
import type { Task, TaskDue } from "../../core/types"

export const TASK_MOVE_POINTER_MIME = "application/x-daymark-task-move"

export type TaskMovePointerPayload = {
  taskId: string
  sourceDate: LocalDate | null
}

export type TaskMoveCommand =
  | "previous-day"
  | "next-day"
  | "previous-week"
  | "next-week"
  | "previous-month"
  | "next-month"
  | "previous-year"
  | "next-year"

export type TaskMoveFailureReason =
  | "invalid-payload"
  | "missing-task"
  | "stale-payload"
  | "invalid-date"
  | "unsupported-command"

export type TaskMoveResult =
  | {
      ok: true
      task: Task
      previousDate: LocalDate | null
      date: LocalDate
    }
  | {
      ok: false
      reason: TaskMoveFailureReason
      task: Task | null
    }

type KeyboardMoveInput = Pick<KeyboardEvent, "key" | "shiftKey">

export function createTaskMovePointerPayload(task: Pick<Task, "id" | "due">): TaskMovePointerPayload {
  return { taskId: task.id, sourceDate: task.due?.date ?? null }
}

export function serializeTaskMovePointerPayload(payload: TaskMovePointerPayload): string {
  return JSON.stringify(payload)
}

export function parseTaskMovePointerPayload(value: unknown): TaskMovePointerPayload | null {
  if (typeof value === "string") {
    try {
      return parseTaskMovePointerPayload(JSON.parse(value))
    } catch {
      return null
    }
  }

  if (!isRecord(value) || typeof value.taskId !== "string" || !value.taskId.trim()) return null
  if (value.sourceDate !== null && !isLocalDate(value.sourceDate)) return null

  return { taskId: value.taskId, sourceDate: value.sourceDate }
}

export function taskMoveCommandForKey(input: KeyboardMoveInput): TaskMoveCommand | undefined {
  if (input.key === "ArrowLeft") return "previous-day"
  if (input.key === "ArrowRight") return "next-day"
  if (input.key === "ArrowUp") return "previous-week"
  if (input.key === "ArrowDown") return "next-week"
  if (input.key === "PageUp") return input.shiftKey ? "previous-year" : "previous-month"
  if (input.key === "PageDown") return input.shiftKey ? "next-year" : "next-month"
  return undefined
}

export function dateForTaskMoveCommand(command: TaskMoveCommand, date: LocalDate): LocalDate | undefined {
  if (!isLocalDate(date)) return undefined

  switch (command) {
    case "previous-day":
      return addDays(date, -1)
    case "next-day":
      return addDays(date, 1)
    case "previous-week":
      return addDays(date, -7)
    case "next-week":
      return addDays(date, 7)
    case "previous-month":
      return addMonths(date, -1)
    case "next-month":
      return addMonths(date, 1)
    case "previous-year":
      return addYears(date, -1)
    case "next-year":
      return addYears(date, 1)
  }
}

export function moveTaskToDate(task: Task | null | undefined, date: LocalDate): TaskMoveResult {
  if (!task) return { ok: false, reason: "missing-task", task: null }
  if (!isLocalDate(date)) return { ok: false, reason: "invalid-date", task }

  const previousDate = task.due?.date ?? null
  const due: TaskDue = {
    date,
    time: task.due?.time ?? null,
    timezone: task.due?.timezone ?? null,
    recurrence: task.due?.recurrence ?? null,
  }

  return { ok: true, task: { ...task, due }, previousDate, date }
}

export function moveTaskFromPointerDrop(
  task: Task | null | undefined,
  payload: unknown,
  targetDate: LocalDate,
): TaskMoveResult {
  const parsed = parseTaskMovePointerPayload(payload)
  if (!parsed) return { ok: false, reason: "invalid-payload", task: task ?? null }
  if (!task) return { ok: false, reason: "missing-task", task: null }
  if (parsed.taskId !== task.id || parsed.sourceDate !== (task.due?.date ?? null)) {
    return { ok: false, reason: "stale-payload", task }
  }
  return moveTaskToDate(task, targetDate)
}

export function moveTaskFromKeyboard(
  task: Task | null | undefined,
  command: TaskMoveCommand | undefined,
  fallbackDate?: LocalDate,
): TaskMoveResult {
  if (!task) return { ok: false, reason: "missing-task", task: null }
  if (!command) return { ok: false, reason: "unsupported-command", task }

  const currentDate = task.due?.date ?? fallbackDate
  if (!currentDate || !isLocalDate(currentDate)) return { ok: false, reason: "invalid-date", task }

  const targetDate = dateForTaskMoveCommand(command, currentDate)
  if (!targetDate) return { ok: false, reason: "unsupported-command", task }
  return moveTaskToDate(task, targetDate)
}

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false
  try {
    fromLocalDate(value)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
