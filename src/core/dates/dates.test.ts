import assert from "node:assert/strict"
import test from "node:test"
import {
  addMonths,
  dateStatus,
  nextOccurrence,
  parseDateExpression,
  type RecurrenceRule,
} from "./index"
import { buildMonthGrid } from "../../features/calendar/calendar-grid"
import { dateForCalendarKey } from "../../features/calendar/calendar-grid"

test("parses relative natural language and optional times", () => {
  const parsed = parseDateExpression("Ship invoice tomorrow at 4:30 pm", "2026-08-02")
  assert.deepEqual(parsed, {
    date: "2026-08-03",
    text: "tomorrow at 4:30 pm",
    range: [13, 32],
    time: "16:30",
  })
})

test("parses an explicit recurrence before resolving the date", () => {
  const parsed = parseDateExpression("every! 2 weeks", "2026-08-02")
  assert.equal(parsed?.date, "2026-08-02")
  assert.deepEqual(parsed?.recurrence, {
    interval: 2,
    unit: "week",
    mode: "completed",
    text: "every! 2 weeks",
  })
})

test("clamps monthly additions to the final valid day", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
})

test("advances overdue scheduled recurrences into the future", () => {
  const rule: RecurrenceRule = { interval: 1, unit: "week", mode: "scheduled", text: "every week" }
  assert.equal(nextOccurrence("2026-07-05", rule, "2026-08-02"), "2026-08-09")
})

test("advances completion-based recurrences from the completion date", () => {
  const rule: RecurrenceRule = { interval: 1, unit: "day", mode: "completed", text: "every! day" }
  assert.equal(nextOccurrence("2026-07-05", rule, "2026-08-02"), "2026-08-03")
})

test("creates a full six-week calendar grid with selection and date limits", () => {
  const grid = buildMonthGrid({
    month: "2026-08-01",
    today: "2026-08-02",
    selectedDate: "2026-08-15",
    minDate: "2026-08-02",
    weekStartsOn: 0,
  })
  assert.equal(grid.length, 42)
  assert.equal(grid[0].date, "2026-07-26")
  assert.equal(grid.find((day) => day.date === "2026-08-15")?.isSelected, true)
  assert.equal(grid.find((day) => day.date === "2026-08-01")?.isDisabled, true)
})

test("derives accessible grid-key navigation targets", () => {
  assert.equal(dateForCalendarKey("ArrowLeft", "2026-08-02", 0), "2026-08-01")
  assert.equal(dateForCalendarKey("ArrowDown", "2026-08-02", 0), "2026-08-09")
  assert.equal(dateForCalendarKey("Home", "2026-08-05", 1), "2026-08-03")
  assert.equal(dateForCalendarKey("End", "2026-08-05", 1), "2026-08-09")
})

test("categorizes date urgency without relying on time of day", () => {
  assert.equal(dateStatus("2026-08-01", "2026-08-02"), "overdue")
  assert.equal(dateStatus("2026-08-02", "2026-08-02"), "today")
  assert.equal(dateStatus("2026-08-03", "2026-08-02"), "upcoming")
})
