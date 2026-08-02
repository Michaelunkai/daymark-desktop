export type ActivityKind =
  | "comment"
  | "completed"
  | "created"
  | "reminder"
  | "reopened"
  | "updated";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  message: string;
  occurredAt: string | Date;
  actorName?: string;
}

export interface TaskComment {
  id: string;
  body: string;
  createdAt: string | Date;
  authorName?: string;
}
