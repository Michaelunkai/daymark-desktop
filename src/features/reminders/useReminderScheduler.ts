import { useEffect, useRef } from "react";

import { getDueReminders } from "./scheduler";
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

  useEffect(() => {
    const checkForDueReminders = () => {
      for (const reminder of getDueReminders(reminders, clock())) {
        if (!deliveredIds.current.has(reminder.id)) {
          deliveredIds.current.add(reminder.id);
          onDue(reminder);
        }
      }
    };

    checkForDueReminders();
    const timerId = window.setInterval(checkForDueReminders, intervalMs);

    return () => window.clearInterval(timerId);
  }, [clock, intervalMs, onDue, reminders]);
}
