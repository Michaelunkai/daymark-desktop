import assert from "node:assert/strict"
import test from "node:test"

import type { Task } from "../../core/types"
import {
  createTaskMovePointerPayload,
  dateForTaskMoveCommand,
  moveTaskFromKeyboard,
  moveTaskFromPointerDrop,
  moveTaskToDate,
  parseTaskMovePointerPayload,
  serializeTaskMovePointerPayload,
  taskMoveCommandForKey,
} from "./task-movement"

const task: Task = {
  id: "task-report",
  content: "Finish report",
  description: "Preserve this description.",
  projectId: "project-work",
  sectionId: "section-focus",
  parentId: null,
  labelIds: ["label-focus"],
  priority: 2,
  due: {
    date: "2026-08-02",
    time: "10:30",
    timezone: "Asia/Jerusalem",
    recurrence: "every week",
  },
  completedAt: null,
  order: 3,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
}

test("serializes and validates pointer payloads", () => {
  const payload = createTaskMovePointerPayload(task)

  assert.deepEqual(parseTaskMovePointerPayload(serializeTaskMovePointerPayload(payload)), payload)
  assert.equal(parseTaskMovePointerPayload('{"taskId":"","sourceDate":"2026-08-02"}'), null)
  assert.equal(parseTaskMovePointerPayload('{"taskId":"task-report","sourceDate":"2026-02-30"}'), null)
  assert.equal(parseTaskMovePointerPayload("{not json}"), null)
})

test("reassigns a date without losing task or due metadata", () => {
  const result = moveTaskToDate(task, "2026-08-09")

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.previousDate, "2026-08-02")
  assert.equal(result.date, "2026-08-09")
  assert.deepEqual(result.task, {
    ...task,
    due: { ...task.due, date: "2026-08-09" },
  })
  assert.equal(task.due?.date, "2026-08-02")
})

test("handles unscheduled tasks by assigning complete default due metadata", () => {
  const unscheduled = { ...task, due: null }
  const result = moveTaskToDate(unscheduled, "2026-08-03")

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.task.due, {
    date: "2026-08-03",
    time: null,
    timezone: null,
    recurrence: null,
  })
})

test("rejects invalid and stale pointer drops without changing the task", () => {
  const payload = createTaskMovePointerPayload(task)
  const malformed = moveTaskFromPointerDrop(task, "{bad json}", "2026-08-03")
  const stale = moveTaskFromPointerDrop({ ...task, due: { ...task.due!, date: "2026-08-03" } }, payload, "2026-08-04")
  const invalidDate = moveTaskFromPointerDrop(task, payload, "2026-02-30")

  assert.deepEqual(malformed, { ok: false, reason: "invalid-payload", task })
  assert.equal(stale.ok, false)
  assert.equal(stale.ok ? undefined : stale.reason, "stale-payload")
  assert.equal(invalidDate.ok, false)
  assert.equal(invalidDate.ok ? undefined : invalidDate.reason, "invalid-date")
  assert.equal(task.due?.date, "2026-08-02")
})

test("maps keyboard moves across day, week, month, and year boundaries", () => {
  assert.equal(taskMoveCommandForKey({ key: "ArrowUp", shiftKey: false } as KeyboardEvent), "previous-week")
  assert.equal(taskMoveCommandForKey({ key: "PageDown", shiftKey: true } as KeyboardEvent), "next-year")
  assert.equal(dateForTaskMoveCommand("next-month", "2026-01-31"), "2026-02-28")
  assert.equal(dateForTaskMoveCommand("next-year", "2024-02-29"), "2025-02-28")

  const moved = moveTaskFromKeyboard(task, "previous-week")
  assert.equal(moved.ok, true)
  assert.equal(moved.ok ? moved.task.due?.date : undefined, "2026-07-26")
})

test("uses an explicit fallback date for keyboard moves of unscheduled tasks", () => {
  const moved = moveTaskFromKeyboard({ ...task, due: null }, "next-day", "2026-08-02")

  assert.equal(moved.ok, true)
  assert.equal(moved.ok ? moved.task.due?.date : undefined, "2026-08-03")
  assert.equal(moveTaskFromKeyboard({ ...task, due: null }, "next-day").ok, false)
})
