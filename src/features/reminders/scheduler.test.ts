import assert from "node:assert/strict";
import test from "node:test";

import {
  createReminderToast,
  createTaskReminder,
  getDueReminders,
  getReminderScheduleStatus,
  isReminderDue,
  millisecondsUntilReminder,
  parseReminderTime,
  scheduleTaskReminders,
} from "./scheduler";
import {
  createEmailReminderRequest,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showBrowserReminderNotification,
} from "./notification-service";
import {
  normalizeReminderPreferences,
  updateReminderPreferences,
} from "./preferences";

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

test("classifies due-soon and overdue schedules from timezone-safe due instants", () => {
  const schedules = scheduleTaskReminders(
    [
      { id: "overdue", due: { date: "2026-08-02", time: "13:55", timezone: "Asia/Jerusalem" } },
      { id: "soon", due: { date: "2026-08-02", time: "15:20", timezone: "Asia/Jerusalem" } },
      { id: "later", due: { date: "2026-08-02", time: "16:00", timezone: "Asia/Jerusalem" } },
      { id: "none", due: null },
    ],
    new Date("2026-08-02T12:00:00.000Z"),
    30 * 60_000,
  );

  assert.deepEqual(schedules.map((schedule) => [schedule.taskId, schedule.status]), [
    ["overdue", "overdue"],
    ["soon", "due-soon"],
    ["later", "scheduled"],
    ["none", "unscheduled"],
  ]);
  assert.equal(getReminderScheduleStatus("2026-08-02T12:00:00.000Z", now), "due");
});

test("normalizes preferences and models browser permission without a live browser", () => {
  assert.deepEqual(normalizeReminderPreferences({ dueSoonMinutes: 0 }), {
    browserNotifications: false,
    dueSoonMinutes: 1,
    emailReminders: false,
    inAppNotifications: true,
  });
  assert.equal(updateReminderPreferences(normalizeReminderPreferences(), { emailReminders: true }).emailReminders, true);
  assert.equal(getBrowserNotificationPermission(undefined), "unsupported");
  assert.deepEqual(showBrowserReminderNotification(dueReminder, undefined), { permission: "unsupported", shown: false });
});

test("preserves browser notification permission states without requiring global Notification", async () => {
  class GrantedNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = async (): Promise<NotificationPermission> => "granted";
    constructor(_title: string, _options?: NotificationOptions) {}
  }
  class DeniedNotification {
    static permission: NotificationPermission = "denied";
    static requestPermission = async (): Promise<NotificationPermission> => "denied";
    constructor(_title: string, _options?: NotificationOptions) {}
  }
  class DefaultNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = async (): Promise<NotificationPermission> => "granted";
    constructor(_title: string, _options?: NotificationOptions) {}
  }

  assert.equal(getBrowserNotificationPermission(GrantedNotification), "granted");
  assert.equal(getBrowserNotificationPermission(DeniedNotification), "denied");
  assert.equal(getBrowserNotificationPermission(DefaultNotification), "default");
  assert.equal(await requestBrowserNotificationPermission(DefaultNotification), "granted");
  assert.deepEqual(showBrowserReminderNotification(dueReminder, GrantedNotification), { permission: "granted", shown: true });
});

test("creates a provider-neutral email handoff payload", () => {
  assert.deepEqual(
    createEmailReminderRequest(dueReminder, "person@example.com", { timezone: "Asia/Jerusalem" }),
    {
      id: "email-reminder:reminder-due",
      kind: "task-reminder",
      locale: "en",
      recipient: "person@example.com",
      reminderId: "reminder-due",
      scheduledFor: "2026-08-02T11:59:00.000Z",
      taskId: "task-1",
      taskTitle: "Review launch notes",
      timezone: "Asia/Jerusalem",
    },
  );
});
