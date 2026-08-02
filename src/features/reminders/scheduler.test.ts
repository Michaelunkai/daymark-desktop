import assert from "node:assert/strict";
import test from "node:test";

import {
  createReminderToast,
  createTaskReminder,
  getDueReminders,
  isReminderDue,
  millisecondsUntilReminder,
  parseReminderTime,
} from "./scheduler";

const now = new Date("2026-08-02T12:00:00.000Z");

const dueReminder = {
  id: "reminder-due",
  taskId: "task-1",
  taskTitle: "Review launch notes",
  remindAt: "2026-08-02T11:59:00.000Z",
} as const;

test("returns only pending reminders that are due", () => {
  const reminders = [
    dueReminder,
    {
      ...dueReminder,
      id: "reminder-future",
      remindAt: "2026-08-02T12:01:00.000Z",
    },
    {
      ...dueReminder,
      id: "reminder-dismissed",
      state: "dismissed" as const,
    },
  ];

  assert.equal(isReminderDue(dueReminder, now), true);
  assert.deepEqual(getDueReminders(reminders, now), [dueReminder]);
  assert.equal(millisecondsUntilReminder(reminders[1], now), 60_000);
});

test("rejects invalid reminder times and creates a local toast payload", () => {
  assert.equal(parseReminderTime("not-a-date"), null);
  assert.equal(
    isReminderDue({ ...dueReminder, remindAt: "not-a-date" }, now),
    false,
  );
  assert.deepEqual(createReminderToast(dueReminder), {
    id: "reminder:reminder-due",
    message: "Review launch notes is due now.",
    title: "Reminder",
  });
});

test("adapts the final core task content contract without importing core", () => {
  assert.deepEqual(
    createTaskReminder(
      { id: "task-1", content: "Review launch notes" },
      { id: "reminder-due", remindAt: "2026-08-02T11:59:00.000Z" },
    ),
    dueReminder,
  );
});
