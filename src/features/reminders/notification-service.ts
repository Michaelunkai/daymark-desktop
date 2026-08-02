import type { TaskReminder } from "./types";

export type BrowserNotificationPermission = "default" | "denied" | "granted" | "unsupported";

export interface BrowserNotificationResult {
  permission: BrowserNotificationPermission;
  shown: boolean;
}

export interface EmailReminderRequest {
  id: string;
  kind: "task-reminder";
  locale: string;
  recipient: string;
  reminderId: string;
  scheduledFor: string;
  taskId: string;
  taskTitle: string;
  timezone: string | null;
}

type NotificationApi = {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): Notification;
};

export function getBrowserNotificationPermission(
  api: NotificationApi | undefined = getNotificationApi(),
): BrowserNotificationPermission {
  return api?.permission ?? "unsupported";
}

export async function requestBrowserNotificationPermission(
  api: NotificationApi | undefined = getNotificationApi(),
): Promise<BrowserNotificationPermission> {
  if (!api) return "unsupported";
  if (api.permission !== "default") return api.permission;
  return api.requestPermission();
}

export function showBrowserReminderNotification(
  reminder: TaskReminder,
  api: NotificationApi | undefined = getNotificationApi(),
): BrowserNotificationResult {
  const permission = getBrowserNotificationPermission(api);
  if (!api || permission !== "granted") return { permission, shown: false };

  new api(reminder.taskTitle, {
    body: "Task reminder",
    tag: `daymark-reminder:${reminder.id}`,
  });
  return { permission, shown: true };
}

export function createEmailReminderRequest(
  reminder: TaskReminder,
  recipient: string,
  options: {
    locale?: string;
    timezone?: string | null;
  } = {},
): EmailReminderRequest {
  const scheduled = new Date(reminder.remindAt);
  if (!recipient.trim()) throw new Error("An email recipient is required.");
  if (Number.isNaN(scheduled.getTime())) throw new Error("The reminder time is invalid.");

  return {
    id: `email-reminder:${reminder.id}`,
    kind: "task-reminder",
    locale: options.locale ?? "en",
    recipient: recipient.trim(),
    reminderId: reminder.id,
    scheduledFor: scheduled.toISOString(),
    taskId: reminder.taskId,
    taskTitle: reminder.taskTitle,
    timezone: options.timezone ?? null,
  };
}

function getNotificationApi(): NotificationApi | undefined {
  return typeof Notification === "undefined" ? undefined : Notification;
}
