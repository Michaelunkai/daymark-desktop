import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLocalReminders,
  deleteLocalReminder,
  loadLocalReminders,
  saveLocalReminders,
  toNativeReminderSchedules,
  upsertLocalReminder,
} from "./local-reminders";

const input = {
  title: "Call the dentist",
  details: "Ask about the next cleaning.",
  eventAt: "2026-08-26T09:00:00.000Z",
  offsets: [
    { id: "before-30", minutes: 30, direction: "before" as const, sound: "soft" as const },
    { id: "after-10", minutes: 10, direction: "after" as const, sound: "alarm" as const },
  ],
  target: { kind: "diary" as const, projectId: null, sectionId: null, orderLane: null },
};

test("local reminders validate and preserve their device-only schedule", () => {
  const created = upsertLocalReminder([], input, "2026-08-19T08:00:00.000Z");
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.reminders.length, 1);
  assert.equal(created.reminders[0].createdAt, "2026-08-19T08:00:00.000Z");
  assert.equal(toNativeReminderSchedules(created.reminders, Date.parse("2026-08-19T08:00:00.000Z")).length, 2);
  assert.equal(deleteLocalReminder(created.reminders, created.reminders[0].id).length, 0);
});

test("local reminders fail closed for malformed persisted values", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  values.set("daymark.local-reminders.v1", "{broken");
  assert.deepEqual(loadLocalReminders(storage), []);
  saveLocalReminders([], storage);
  assert.deepEqual(loadLocalReminders(storage), []);
  assert.equal(upsertLocalReminder([], { ...input, title: " " }).ok, false);
});

test("clears the legacy device-only copy only after shared-state migration", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  saveLocalReminders([{
    ...input,
    id: "reminder-legacy",
    createdAt: "2026-08-19T08:00:00.000Z",
    updatedAt: "2026-08-19T08:00:00.000Z",
  }], storage);
  assert.equal(loadLocalReminders(storage).length, 1);
  clearLocalReminders(storage);
  assert.deepEqual(loadLocalReminders(storage), []);
});
