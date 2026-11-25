import type {
  ReminderTaskSource,
  ReminderToast,
  TaskReminder,
  TaskReminderInput,
} from "./types";

export function parseReminderTime(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function isReminderDue(
  reminder: TaskReminder,
  now: Date = new Date(),
): boolean {
  const remindAt = parseReminderTime(reminder.remindAt);

  return Boolean(
    remindAt &&
      remindAt.getTime() <= now.getTime() &&
      reminder.state !== "dismissed",
  );
}

export function getDueReminders(
  reminders: readonly TaskReminder[],
  now: Date = new Date(),
): TaskReminder[] {
  return reminders.filter((reminder) => isReminderDue(reminder, now));
}

export function millisecondsUntilReminder(
  reminder: TaskReminder,
  now: Date = new Date(),
): number | null {
  const remindAt = parseReminderTime(reminder.remindAt);

  return remindAt ? Math.max(0, remindAt.getTime() - now.getTime()) : null;
}

export function getNextReminderDelay(
  reminders: readonly TaskReminder[],
  deliveredIds: ReadonlySet<string>,
  now: Date = new Date(),
  fallbackMs = 30_000,
): number {
  const fallback = Math.max(1, fallbackMs);
  return reminders
    .filter((reminder) => reminder.state !== "dismissed" && !deliveredIds.has(reminder.id))
    .map((reminder) => millisecondsUntilReminder(reminder, now))
    .filter((delay): delay is number => delay !== null && delay > 0)
    .reduce((next, delay) => Math.min(next, delay), fallback);
}

export function createReminderToast(reminder: TaskReminder): ReminderToast {
  return {
    id: `reminder:${reminder.id}`,
    message: `${reminder.taskTitle} is due now.`,
    title: "Reminder",
  };
}

export function createTaskReminder(
  task: ReminderTaskSource,
  reminder: TaskReminderInput,
): TaskReminder {
  return {
    ...reminder,
    taskId: task.id,
    taskTitle: task.content,
  };
}
