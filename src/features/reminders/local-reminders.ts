export type LocalReminderSound = "soft" | "alert" | "alarm";
export type LocalReminderDirection = "before" | "after";
export type LocalReminderTargetKind = "diary" | "project" | "order";

export type LocalReminderOffset = {
  id: string;
  minutes: number;
  direction: LocalReminderDirection;
  sound: LocalReminderSound;
};

export type LocalReminderTarget = {
  kind: LocalReminderTargetKind;
  projectId: string | null;
  sectionId: string | null;
  orderLane: "now" | "later" | "after" | null;
};

export type LocalReminder = {
  id: string;
  title: string;
  details: string;
  eventAt: string;
  offsets: LocalReminderOffset[];
  target: LocalReminderTarget;
  createdAt: string;
  updatedAt: string;
};

export const LOCAL_REMINDERS_KEY = "daymark.local-reminders.v1";

export function loadLocalReminders(storage = getStorage()): LocalReminder[] {
  try {
    const parsed = JSON.parse(storage?.getItem(LOCAL_REMINDERS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.flatMap((value) => {
        const reminder = normalizeReminder(value);
        return reminder ? [reminder] : [];
      })
      : [];
  } catch {
    return [];
  }
}

export function saveLocalReminders(reminders: readonly LocalReminder[], storage = getStorage()): void {
  try {
    storage?.setItem(LOCAL_REMINDERS_KEY, JSON.stringify(reminders));
  } catch {
    // Reminders stay usable for this session if storage is unavailable.
  }
}

export function clearLocalReminders(storage = getStorage()): void {
  try {
    storage?.removeItem(LOCAL_REMINDERS_KEY);
  } catch {
    // Keep the legacy copy until a later launch can safely complete the migration.
  }
}

export function upsertLocalReminder(
  reminders: readonly LocalReminder[],
  input: Omit<LocalReminder, "id" | "createdAt" | "updatedAt"> & { id?: string },
  now = new Date().toISOString(),
): { ok: true; reminders: LocalReminder[] } | { ok: false; message: string } {
  const normalized = normalizeReminder({ ...input, id: input.id ?? createReminderId(), createdAt: now, updatedAt: now });
  if (!normalized) return { ok: false, message: "Add a title, valid date and time, and at least one alert." };
  const existing = reminders.find((reminder) => reminder.id === normalized.id);
  const next = {
    ...normalized,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ok: true,
    reminders: existing
      ? reminders.map((reminder) => reminder.id === next.id ? next : reminder)
      : [...reminders, next],
  };
}

export function deleteLocalReminder(reminders: readonly LocalReminder[], reminderId: string): LocalReminder[] {
  return reminders.filter((reminder) => reminder.id !== reminderId);
}

export function toNativeReminderSchedules(reminders: readonly LocalReminder[], now = Date.now()) {
  return reminders.flatMap((reminder) => {
    const eventAt = Date.parse(reminder.eventAt);
    if (!Number.isFinite(eventAt)) return [];
    return reminder.offsets.flatMap((offset, index) => {
      const alertAt = eventAt + (offset.direction === "before" ? -1 : 1) * offset.minutes * 60_000;
      if (alertAt <= now) return [];
      return [{
        id: `${reminder.id}:${offset.id}:${eventAt}`,
        reminderId: reminder.id,
        title: reminder.title,
        details: reminder.details,
        eventAt,
        alertAt,
        minutes: offset.minutes,
        direction: offset.direction,
        ordinal: index + 1,
        total: reminder.offsets.length,
        sound: offset.sound,
      }];
    });
  });
}

function normalizeReminder(value: unknown): LocalReminder | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const eventAt = typeof value.eventAt === "string" ? value.eventAt : "";
  const parsedEventAt = Date.parse(eventAt);
  const offsets = Array.isArray(value.offsets)
    ? value.offsets.flatMap((offset, index) => normalizeOffset(offset, index))
    : [];
  const target = normalizeTarget(value.target);
  if (!title || !Number.isFinite(parsedEventAt) || !offsets.length || !target) return null;
  if (target.kind === "project" && !target.projectId) return null;
  if (target.kind === "order" && !target.orderLane) return null;
  const now = new Date().toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : createReminderId(),
    title,
    details: typeof value.details === "string" ? value.details.trim() : "",
    eventAt: new Date(parsedEventAt).toISOString(),
    offsets,
    target,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
}

function normalizeOffset(value: unknown, index: number): LocalReminderOffset[] {
  if (!isRecord(value)) return [];
  const minutes = Number(value.minutes);
  const direction = value.direction === "after" ? "after" : value.direction === "before" ? "before" : null;
  const sound = ["soft", "alert", "alarm"].includes(String(value.sound)) ? value.sound as LocalReminderSound : null;
  if (!Number.isInteger(minutes) || minutes < 0 || !direction || !sound) return [];
  return [{
    id: typeof value.id === "string" && value.id ? value.id : `offset-${index}`,
    minutes,
    direction,
    sound,
  }];
}

function normalizeTarget(value: unknown): LocalReminderTarget | null {
  if (!isRecord(value) || !["diary", "project", "order"].includes(String(value.kind))) return null;
  const kind = value.kind as LocalReminderTargetKind;
  return {
    kind,
    projectId: typeof value.projectId === "string" && value.projectId ? value.projectId : null,
    sectionId: typeof value.sectionId === "string" && value.sectionId ? value.sectionId : null,
    orderLane: ["now", "later", "after"].includes(String(value.orderLane))
      ? value.orderLane as LocalReminderTarget["orderLane"]
      : null,
  };
}

function createReminderId(): string {
  return `reminder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
