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
