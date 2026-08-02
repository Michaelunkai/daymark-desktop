import { useEffect } from "react";

import type { ReminderToast } from "./types";
import "./reminders.css";

export interface ToastViewportProps {
  onDismiss: (toastId: string) => void;
  timeoutMs?: number;
  toasts: readonly ReminderToast[];
}

export function ToastViewport({
  onDismiss,
  timeoutMs = 8_000,
  toasts,
}: ToastViewportProps) {
  useEffect(() => {
    const timeoutIds = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), timeoutMs),
    );

    return () => timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, [onDismiss, timeoutMs, toasts]);

  return (
    <aside
      aria-atomic="true"
      aria-label="In-app notifications"
      aria-live="polite"
      className="toast-viewport"
    >
      {toasts.map((toast) => (
        <article className="toast" key={toast.id} role="status">
          <div className="toast__content">
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button
            aria-label={`Dismiss ${toast.title} notification`}
            className="toast__dismiss"
            onClick={() => onDismiss(toast.id)}
            type="button"
          >
            Dismiss
          </button>
        </article>
      ))}
    </aside>
  );
}
