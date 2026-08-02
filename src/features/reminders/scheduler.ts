import type {
  ReminderTaskSource,
  ReminderToast,
  TaskReminder,
  TaskReminderInput,
} from "./types";
import { dueInstantForTask } from "./recurrence-materializer";

export type ReminderScheduleStatus =
  | "overdue"
  | "due"
  | "due-soon"
  | "scheduled"
  | "unscheduled";

export interface ReminderDueSource {
  due: {
    date: string;
    time: string | null;
    timezone: string | null;
  } | null;
  id: string;
}

export interface ReminderSchedule {
  id: string;
  remindAt: Date | null;
  status: ReminderScheduleStatus;
  taskId: string;
}

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

export function getReminderScheduleStatus(
  remindAt: string | Date | null | undefined,
  now: Date = new Date(),
  dueSoonMs = 30 * 60_000,
): ReminderScheduleStatus {
  if (!remindAt) return "unscheduled";
  const instant = parseReminderTime(remindAt);
  if (!instant) return "unscheduled";

  const difference = instant.getTime() - now.getTime();
  if (difference < 0) return "overdue";
  if (difference === 0) return "due";
  return difference <= dueSoonMs ? "due-soon" : "scheduled";
}

export function scheduleTaskReminder(
  task: ReminderDueSource,
  now: Date = new Date(),
  dueSoonMs = 30 * 60_000,
): ReminderSchedule {
  const remindAt = task.due ? dueInstantForTask(task.due) : null;
  return {
    id: `schedule:${task.id}`,
    remindAt,
    status: getReminderScheduleStatus(remindAt, now, dueSoonMs),
    taskId: task.id,
  };
}

export function scheduleTaskReminders(
  tasks: readonly ReminderDueSource[],
  now: Date = new Date(),
  dueSoonMs = 30 * 60_000,
): ReminderSchedule[] {
  return tasks
    .map((task) => scheduleTaskReminder(task, now, dueSoonMs))
    .sort((left, right) => {
      const leftTime = left.remindAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = right.remindAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.taskId.localeCompare(right.taskId);
    });
}
