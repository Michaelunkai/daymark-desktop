import assert from "node:assert/strict";
import test from "node:test";

import { formatReminderText, parseReminderText } from "./parser";

const now = new Date("2026-09-09T10:00:00.000Z");

test("parses relative, natural-language, and time-only reminders into exact instants", () => {
  assert.equal(parseReminderText("in 15 minutes", now), "2026-09-09T10:15:00.000Z");
  assert.equal(
    parseReminderText("tomorrow at 4pm", now),
    new Date(2026, 8, 10, 16, 0, 0, 0).toISOString(),
  );
  assert.equal(
    parseReminderText("at 9am", now),
    new Date(2026, 8, 10, 9, 0, 0, 0).toISOString(),
  );
  assert.equal(parseReminderText("not a reminder", now), null);
});

test("formats stored reminders back into an editor-friendly local expression", () => {
  assert.equal(
    formatReminderText("2026-09-10T16:05:00.000Z"),
    (() => {
      const date = new Date("2026-09-10T16:05:00.000Z");
      const hour = date.getHours();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} at ${hour % 12 || 12}:05 ${hour >= 12 ? "pm" : "am"}`;
    })(),
  );
  assert.equal(formatReminderText("not-a-date"), "");
});
