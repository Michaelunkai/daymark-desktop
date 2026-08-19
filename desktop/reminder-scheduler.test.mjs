import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TIMER_DELAY,
  notificationForSchedule,
  normalizeReminderSchedules,
  timerDelayForSchedule,
} from "./reminder-scheduler.mjs";

const now = Date.parse("2026-08-19T20:00:00.000Z");

const validSchedule = {
  id: "reminder-1:before-20:1",
  title: "Call the dentist",
  details: "Ask about the next cleaning.",
  eventAt: now + 30 * 60_000,
  alertAt: now + 10 * 60_000,
  minutes: 20,
  direction: "before",
  ordinal: 2,
  total: 3,
  sound: "alert",
};

test("keeps only future well-formed reminder schedules", () => {
  const schedules = normalizeReminderSchedules([
    validSchedule,
    { ...validSchedule, id: "past", alertAt: now - 1 },
    { ...validSchedule, id: "", title: "Missing id" },
    { ...validSchedule, id: "wrong-direction", direction: "soon" },
  ], now);

  assert.deepEqual(schedules, [validSchedule]);
});

test("sorts schedules by alert time and protects Node timer limits", () => {
  const schedules = normalizeReminderSchedules([
    { ...validSchedule, id: "later", alertAt: now + 40 * 60_000 },
    validSchedule,
  ], now);

  assert.deepEqual(schedules.map((schedule) => schedule.id), [
    validSchedule.id,
    "later",
  ]);
  assert.equal(timerDelayForSchedule(validSchedule, now), 10 * 60_000);
  assert.equal(
    timerDelayForSchedule({ ...validSchedule, alertAt: now + MAX_TIMER_DELAY + 1 }, now),
    MAX_TIMER_DELAY,
  );
});

test("builds an exact, useful native notification body", () => {
  assert.deepEqual(notificationForSchedule(validSchedule), {
    body: "Call the dentist starts in 20 minutes. Alert 2 of 3.",
    title: "Daymark reminder",
  });

  assert.equal(
    notificationForSchedule({
      ...validSchedule,
      direction: "after",
      minutes: 10,
      ordinal: 1,
      total: 1,
    }).body,
    "Call the dentist started 10 minutes ago. Alert 1 of 1.",
  );
});
