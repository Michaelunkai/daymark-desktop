export type ReminderState = "dismissed" | "pending";

export interface TaskReminder {
  id: string;
  remindAt: string | Date;
  state?: ReminderState;
  taskId: string;
  taskTitle: string;
}

export interface ReminderTaskSource {
  content: string;
  id: string;
}

export type TaskReminderInput = Pick<TaskReminder, "id" | "remindAt" | "state">;

export interface ReminderToast {
  id: string;
  message: string;
  title: string;
}
