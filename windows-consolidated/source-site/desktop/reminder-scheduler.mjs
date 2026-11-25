export const MAX_TIMER_DELAY = 2_147_483_647;
export const MISSED_ALERT_SPACING_MS = 13_000;
export const OVERDUE_CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

const SOUNDS = new Set(["soft", "alert", "alarm"]);

export function normalizeReminderSchedules(value, now = Date.now(), options = {}) {
  if (!Array.isArray(value)) throw new TypeError("Reminder schedules must be an array.");
  const ids = new Set();
  const includePast = options.includePast === true;
  const earliestCatchUp = now - OVERDUE_CATCH_UP_WINDOW_MS;

  return value
    .filter((schedule) => isValidSchedule(schedule) && (
      schedule.alertAt > now
      || (includePast && schedule.alertAt >= earliestCatchUp)
    ))
    .map((schedule) => ({
      ...schedule,
      details: schedule.details ?? "",
      sound: SOUNDS.has(schedule.sound) ? schedule.sound : "soft",
    }))
    .map((schedule) => {
      if (ids.has(schedule.id)) throw new TypeError(`Duplicate reminder schedule id: ${schedule.id}`);
      ids.add(schedule.id);
      return schedule;
    })
    .sort((left, right) => left.alertAt - right.alertAt);
}

export function normalizeDeliveredReminderIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && id))];
}

export function timerDelayForSchedule(schedule, now = Date.now()) {
  return Math.min(Math.max(0, schedule.alertAt - now), MAX_TIMER_DELAY);
}

export function notificationForSchedule(schedule) {
  const timing = schedule.direction === "before"
    ? `starts in ${schedule.minutes} minutes`
    : `started ${schedule.minutes} minutes ago`;

  return {
    title: "Daymark reminder",
    body: `${schedule.title} ${timing}. Alert ${schedule.ordinal} of ${schedule.total}.`,
  };
}

function isValidSchedule(value) {
  return Boolean(
    value
      && typeof value === "object"
      && typeof value.id === "string"
      && value.id
      && typeof value.title === "string"
      && value.title.trim()
      && Number.isFinite(value.eventAt)
      && Number.isFinite(value.alertAt)
      && Number.isInteger(value.minutes)
      && value.minutes >= 0
      && (value.direction === "before" || value.direction === "after")
      && Number.isInteger(value.ordinal)
      && value.ordinal > 0
      && Number.isInteger(value.total)
      && value.total > 0,
  );
}
