export const MAX_TIMER_DELAY = 2_147_483_647;

const SOUNDS = new Set(["soft", "alert", "alarm"]);

export function normalizeReminderSchedules(value, now = Date.now()) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((schedule) => isValidSchedule(schedule) && schedule.alertAt > now)
    .map((schedule) => ({
      ...schedule,
      details: schedule.details ?? "",
      sound: SOUNDS.has(schedule.sound) ? schedule.sound : "soft",
    }))
    .sort((left, right) => left.alertAt - right.alertAt);
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
