import assert from "node:assert/strict"
import test from "node:test"

import {
  bucketTasksByDate,
  buildUpcomingRange,
  countTasksByDate,
  groupUpcomingTasks,
  moveTaskToDate,
  navigateUpcomingRange,
  selectUpcomingDate,
} from "./upcoming-model"

const task = (id: string, date: string | null, order = 0) => ({
  id,
  content: id,
  order,
  due: date
    ? { date, time: "09:30", timezone: "Asia/Jerusalem", recurrence: null }
    : null,
})

test("builds bounded week, month, and year date ranges", () => {
  assert.deepEqual(buildUpcomingRange("week", "2026-08-05", 1), {
    view: "week",
    focus: "2026-08-05",
    start: "2026-08-03",
    end: "2026-08-09",
  })
  assert.deepEqual(buildUpcomingRange("month", "2026-02-18"), {
    view: "month",
    focus: "2026-02-18",
    start: "2026-02-01",
    end: "2026-02-28",
  })
  assert.deepEqual(buildUpcomingRange("year", "2024-02-29"), {
    view: "year",
    focus: "2024-02-29",
    start: "2024-01-01",
    end: "2024-12-31",
  })
})

test("navigates by the active calendar range without changing the day unexpectedly", () => {
  assert.equal(navigateUpcomingRange("week", "2026-08-05", 1), "2026-08-12")
  assert.equal(navigateUpcomingRange("month", "2026-01-31", 1), "2026-02-28")
  assert.equal(navigateUpcomingRange("year", "2024-02-29", 1), "2025-02-28")
  assert.equal(navigateUpcomingRange("month", "2026-01-31", -1), "2025-12-31")
})

test("buckets only scheduled tasks and sorts stable task order within a day", () => {
  const tasks = [
    task("late", "2026-08-08", 2),
    task("unscheduled", null),
    task("early", "2026-08-08", 1),
    task("other-day", "2026-08-09", 0),
  ]

  const buckets = bucketTasksByDate(tasks)
  assert.deepEqual(buckets["2026-08-08"].map((item) => item.id), ["early", "late"])
  assert.deepEqual(buckets["2026-08-09"].map((item) => item.id), ["other-day"])
  assert.equal(buckets["2026-08-10"], undefined)
})

test("returns marker counts for days containing scheduled tasks", () => {
  assert.deepEqual(
    countTasksByDate([
      task("one", "2026-08-08"),
      task("two", "2026-08-08"),
      task("three", "2026-08-09"),
      task("none", null),
    ]),
    { "2026-08-08": 2, "2026-08-09": 1 },
  )
})

test("selects valid dates and moves tasks immutably while preserving due metadata", () => {
  assert.equal(selectUpcomingDate("2026-08-12"), "2026-08-12")
  assert.throws(() => selectUpcomingDate("2026-02-30"), /Invalid calendar date/)

  const original = task("move-me", "2026-08-08")
  const moved = moveTaskToDate(original, "2026-08-12")

  assert.equal(original.due?.date, "2026-08-08")
  assert.deepEqual(moved.due, {
    date: "2026-08-12",
    time: "09:30",
    timezone: "Asia/Jerusalem",
    recurrence: null,
  })
  assert.deepEqual(moveTaskToDate(task("new-date", null), "2026-08-12").due, {
    date: "2026-08-12",
    time: null,
    timezone: null,
    recurrence: null,
  })
})

test("groups future tasks for a scan-friendly agenda and keeps completed tasks last", () => {
  const groups = groupUpcomingTasks([
    { id: "done", title: "Already done", dueDate: "2026-08-05", completed: true },
    { id: "active", title: "Plan release", dueDate: "2026-08-05", completed: false },
    { id: "past", title: "Past task", dueDate: "2026-08-03" },
    { id: "tomorrow", title: "Tomorrow task", dueDate: "2026-08-06" },
  ], "2026-08-05")

  assert.deepEqual(groups.map((group) => group.label), ["Today", "Tomorrow"])
  assert.deepEqual(groups[0].tasks.map((task) => task.id), ["active", "done"])
})
