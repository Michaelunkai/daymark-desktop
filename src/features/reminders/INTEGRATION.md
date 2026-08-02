# W01 Integration Contract

These features are presentational and local only. W01 owns the shell state and
chooses whether a selected task renders the activity and comments surfaces.

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
and `TaskReminder[]`, then owns callback updates. Do not connect these components to the store,
`localStorage`, browser notifications, service workers, audio, or network
requests. `useReminderScheduler` emits each reminder ID at most once per
mounted hook instance.
