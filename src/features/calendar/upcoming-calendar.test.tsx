import assert from "node:assert/strict"
import test from "node:test"
import { calendarRange, navigateDate } from "./calendar-task-adapters"

test("keeps a 42-cell month grid and supports all navigation modes", () => {
  assert.equal(calendarRange("month", "2026-08-02", 1).length, 42)
  assert.deepEqual(calendarRange("week", "2026-08-02", 1), [
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02",
  ])
  assert.deepEqual(calendarRange("year", "2026-08-02", 1), [])
  assert.equal(navigateDate("week", "2026-08-02", 1), "2026-08-09")
  assert.equal(navigateDate("month", "2026-01-31", 1), "2026-02-28")
  assert.equal(navigateDate("year", "2024-02-29", 1), "2025-02-28")
})
