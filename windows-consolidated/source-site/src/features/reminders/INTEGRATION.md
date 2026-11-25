# W01 Integration Contract

These components remain presentational. The W01 shell owns the persisted
`Task.reminderAt` and `Task.reminderState` fields, maps active tasks into
`TaskReminder` values, and handles the toast and dismissal callbacks. Reminder
times therefore travel with the normal workspace state when the workspace is
paired across devices; the reminder feature itself does not perform network or
storage I/O.

```tsx
import {
  ActivityTimeline,
  CommentsPanel,
} from "./features/activity";
import {
  createReminderToast,
  createTaskReminder,
  ToastViewport,
  useReminderScheduler,
} from "./features/reminders";

const reminder = createTaskReminder(task, {
  id: "reminder-1",
  remindAt: "2026-08-02T17:00:00.000Z",
});

useReminderScheduler(reminders, {
  onDue: (reminder) => {
    setToasts((current) => [
      ...current.filter((toast) => toast.id !== `reminder:${reminder.id}`),
      createReminderToast(reminder),
    ]);
  },
});

<ToastViewport
  onDismiss={(toastId) =>
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }
  toasts={toasts}
/>

<ActivityTimeline events={taskActivity} />
<CommentsPanel comments={taskComments} onAddComment={addComment} />
```

The core `Task` is accepted structurally through `createTaskReminder(task, input)`;
it maps `Task.id` and `Task.content` to `TaskReminder.taskId` and
`TaskReminder.taskTitle`. The shell supplies `ActivityItem[]`, `TaskComment[]`,
and `TaskReminder[]`, then owns callback updates. Do not connect these feature
components directly to the store, `localStorage`, browser notifications,
service workers, audio, or network requests. `useReminderScheduler` emits each
active reminder ID at most once until it is removed or dismissed from the input.
