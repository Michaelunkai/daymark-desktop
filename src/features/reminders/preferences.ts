import { useCallback, useEffect, useState } from "react";

export interface ReminderPreferences {
  browserNotifications: boolean;
  dueSoonMinutes: number;
  emailReminders: boolean;
  inAppNotifications: boolean;
}

export type ReminderPreferencesPatch = Partial<ReminderPreferences>;

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  browserNotifications: false,
  dueSoonMinutes: 30,
  emailReminders: false,
  inAppNotifications: true,
};

export function normalizeReminderPreferences(
  value: ReminderPreferencesPatch | null | undefined,
): ReminderPreferences {
  const dueSoonMinutes = Number(value?.dueSoonMinutes);
  return {
    browserNotifications: value?.browserNotifications ?? DEFAULT_REMINDER_PREFERENCES.browserNotifications,
    dueSoonMinutes: Number.isFinite(dueSoonMinutes)
      ? Math.min(Math.max(Math.round(dueSoonMinutes), 1), 24 * 60)
      : DEFAULT_REMINDER_PREFERENCES.dueSoonMinutes,
    emailReminders: value?.emailReminders ?? DEFAULT_REMINDER_PREFERENCES.emailReminders,
    inAppNotifications: value?.inAppNotifications ?? DEFAULT_REMINDER_PREFERENCES.inAppNotifications,
  };
}

export function updateReminderPreferences(
  current: ReminderPreferences,
  patch: ReminderPreferencesPatch,
): ReminderPreferences {
  return normalizeReminderPreferences({ ...current, ...patch });
}

export function useReminderPreferences(
  storageKey = "daymark.reminder-preferences",
): [ReminderPreferences, (patch: ReminderPreferencesPatch) => void] {
  const [preferences, setPreferences] = useState<ReminderPreferences>(() => {
    if (typeof window === "undefined") return DEFAULT_REMINDER_PREFERENCES;
    try {
      return normalizeReminderPreferences(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"));
    } catch {
      return DEFAULT_REMINDER_PREFERENCES;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences, storageKey]);

  const update = useCallback((patch: ReminderPreferencesPatch) => {
    setPreferences((current) => updateReminderPreferences(current, patch));
  }, []);

  return [preferences, update];
}
