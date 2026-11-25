import { useEffect, useRef } from "react";

import { getDueReminders, getNextReminderDelay } from "./scheduler";
import type { TaskReminder } from "./types";

export interface ReminderSchedulerOptions {
  clock?: () => Date;
  intervalMs?: number;
  onDue: (reminder: TaskReminder) => void;
}

export function useReminderScheduler(
  reminders: readonly TaskReminder[],
  {
    clock = () => new Date(),
    intervalMs = 30_000,
    onDue,
  }: ReminderSchedulerOptions,
) {
  const deliveredIds = useRef(new Set<string>());
  const remindersRef = useRef(reminders);
  const clockRef = useRef(clock);
  const onDueRef = useRef(onDue);
  const reminderScheduleKey = reminders
    .map((reminder) => `${reminder.id}:${String(reminder.remindAt)}:${reminder.state ?? "pending"}`)
    .join("|");
  remindersRef.current = reminders;
  clockRef.current = clock;
  onDueRef.current = onDue;

  useEffect(() => {
    let timerId: number | undefined;

    const scheduleNextCheck = () => {
      timerId = window.setTimeout(
        checkForDueReminders,
        getNextReminderDelay(
          remindersRef.current,
          deliveredIds.current,
          clockRef.current(),
          intervalMs,
        ),
      );
    };

    const checkForDueReminders = () => {
      const currentReminders = remindersRef.current;
      const currentIds = new Set(currentReminders.map((reminder) => reminder.id));
      for (const deliveredId of deliveredIds.current) {
        const reminder = currentReminders.find((candidate) => candidate.id === deliveredId);
        if (!currentIds.has(deliveredId) || reminder?.state === "dismissed") {
          deliveredIds.current.delete(deliveredId);
        }
      }

      for (const reminder of getDueReminders(currentReminders, clockRef.current())) {
        if (!deliveredIds.current.has(reminder.id)) {
          deliveredIds.current.add(reminder.id);
          onDueRef.current(reminder);
        }
      }
      scheduleNextCheck();
    };

    checkForDueReminders();

    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [intervalMs, reminderScheduleKey]);
}
