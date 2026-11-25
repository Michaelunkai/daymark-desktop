import { useEffect, useRef } from "react";

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
  const onDismissRef = useRef(onDismiss);
  const timeoutIdsRef = useRef(new Map<string, number>());
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    for (const [toastId, timeoutId] of timeoutIdsRef.current) {
      if (!activeIds.has(toastId)) {
        window.clearTimeout(timeoutId);
        timeoutIdsRef.current.delete(toastId);
      }
    }
    for (const toast of toasts) {
      if (timeoutIdsRef.current.has(toast.id)) continue;
      const timeoutId = window.setTimeout(() => {
        timeoutIdsRef.current.delete(toast.id);
        onDismissRef.current(toast.id);
      }, timeoutMs);
      timeoutIdsRef.current.set(toast.id, timeoutId);
    }
  }, [timeoutMs, toasts]);

  useEffect(() => () => {
    for (const timeoutId of timeoutIdsRef.current.values()) window.clearTimeout(timeoutId);
    timeoutIdsRef.current.clear();
  }, []);

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
