import type { ActivityKind } from "./types";

export function parseActivityDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatActivityTime(
  value: string | Date,
  locale?: string,
): string {
  const date = parseActivityDate(value);

  if (!date) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

export function activityKindLabel(kind: ActivityKind): string {
  const labels: Record<ActivityKind, string> = {
    comment: "Comment",
    completed: "Completed",
    created: "Created",
    reminder: "Reminder",
    reopened: "Reopened",
    updated: "Updated",
  };

  return labels[kind];
}
