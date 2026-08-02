import assert from "node:assert/strict"
import { test } from "vitest"

import { addDays, nextOccurrence, type RecurrenceRule } from "../../src/core/dates"
import { buildMonthGrid, dateForCalendarKey } from "../../src/features/calendar/calendar-grid"
import { buildUpcomingRange, navigateUpcomingRange } from "../../src/features/calendar/upcoming-model"

test("keeps local calendar dates stable across leap-year and common-year navigation", () => {
  assert.equal(navigateUpcomingRange("year", "2024-02-29", 1), "2025-02-28")
  assert.deepEqual(buildUpcomingRange("month", "2024-02-29"), {
    view: "month",
    focus: "2024-02-29",
    start: "2024-02-01",
    end: "2024-02-29",
  })
  assert.deepEqual(buildUpcomingRange("month", "2025-02-28"), {
    view: "month",
    focus: "2025-02-28",
    start: "2025-02-01",
    end: "2025-02-28",
  })
})

test("uses date-only arithmetic across local DST boundaries", () => {
  assert.equal(addDays("2026-03-27", 1), "2026-03-28")
  assert.equal(addDays("2026-03-28", 1), "2026-03-29")
  assert.equal(addDays("2026-10-24", 1), "2026-10-25")
  assert.equal(addDays("2026-10-25", 1), "2026-10-26")
})

test("builds complete month geometry and keyboard traversal around month edges", () => {
  const grid = buildMonthGrid({ month: "2024-02-01", today: "2024-02-29", weekStartsOn: 1 })

  assert.equal(grid.length, 42)
  assert.equal(grid.filter((day) => day.isCurrentMonth).length, 29)
  assert.equal(grid.find((day) => day.date === "2024-02-29")?.isToday, true)
  assert.equal(dateForCalendarKey("ArrowRight", "2024-02-29", 1), "2024-03-01")
  assert.equal(dateForCalendarKey("Home", "2024-03-03", 1), "2024-02-26")
})

test("advances scheduled recurrences past completed dates without crossing an until boundary", () => {
  const weekly: RecurrenceRule = {
    interval: 1,
    unit: "week",
    mode: "scheduled",
    text: "every week",
  }
  const bounded: RecurrenceRule = { ...weekly, until: "2026-08-09" }

  assert.equal(nextOccurrence("2026-07-26", weekly, "2026-08-02"), "2026-08-09")
  assert.equal(nextOccurrence("2026-08-09", bounded, "2026-08-09"), undefined)
})
