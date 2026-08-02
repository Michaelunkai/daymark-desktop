import assert from "node:assert/strict"
import test from "node:test"
import {
  createCalendarTaskDragPayload,
  dayDensity,
  parseCalendarTaskDragPayload,
} from "./calendar-task-adapters"

test("counts active and completed tasks for green day markers", () => {
  assert.deepEqual(dayDensity([{ completed: false }, { completed: true }, {}]), {
    active: 2,
    completed: 1,
    total: 3,
  })
})

test("accepts only a validated custom calendar drag payload", () => {
  const payload = createCalendarTaskDragPayload({ id: "task-1", dueDate: "2026-08-02" })
  assert.deepEqual(parseCalendarTaskDragPayload(payload), { taskId: "task-1", sourceDate: "2026-08-02" })
  assert.equal(parseCalendarTaskDragPayload('{"taskId":"","sourceDate":"2026-08-02"}'), null)
  assert.equal(parseCalendarTaskDragPayload('{"taskId":"task-1","sourceDate":"invalid"}'), null)
})
