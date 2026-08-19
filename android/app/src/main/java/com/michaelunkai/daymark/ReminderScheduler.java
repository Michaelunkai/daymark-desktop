package com.michaelunkai.daymark;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

final class ReminderScheduler {
    private static final String PREFS = "daymark.reminders";
    private static final String SCHEDULES = "schedules";
    // Android permanently retains a channel's sound after it is first created.
    // A versioned ID gives existing installations a fresh, audible reminder channel.
    private static final String CHANNEL_VERSION = "v3";
    private static final String ACTION_REMINDER = "com.michaelunkai.daymark.REMINDER";
    private static final String EXTRA_ID = "id";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_DETAILS = "details";
    private static final String EXTRA_EVENT_AT = "eventAt";
    private static final String EXTRA_MINUTES = "minutes";
    private static final String EXTRA_DIRECTION = "direction";
    private static final String EXTRA_ORDINAL = "ordinal";
    private static final String EXTRA_TOTAL = "total";
    private static final String EXTRA_SOUND = "sound";

    private ReminderScheduler() {}

    static void replace(Context context, String rawSchedules) {
        JSONArray previous = read(context);
        for (int index = 0; index < previous.length(); index += 1) cancel(context, previous.optJSONObject(index));
        JSONArray next = parse(rawSchedules);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SCHEDULES, next.toString()).apply();
        ensureChannels(context);
        for (int index = 0; index < next.length(); index += 1) schedule(context, next.optJSONObject(index));
    }

    static void reschedule(Context context) {
        JSONArray schedules = read(context);
        ensureChannels(context);
        for (int index = 0; index < schedules.length(); index += 1) schedule(context, schedules.optJSONObject(index));
    }

    static String status(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return "notifications-required";
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return "notifications-disabled";
        if (Build.VERSION.SDK_INT >= 31
                && !((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms()) return "exact-alarm-required";
        ensureChannels(context);
        if (Build.VERSION.SDK_INT >= 26 && !hasAudibleChannels(manager)) return "sound-required";
        return "ready";
    }

    static void schedule(Context context, JSONObject schedule) {
        if (schedule == null) return;
        long alertAt = schedule.optLong("alertAt", 0L);
        if (alertAt <= System.currentTimeMillis()) return;
        Intent intent = reminderIntent(context, schedule);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = PendingIntent.getBroadcast(context, requestCode(schedule), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= 23 && (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms())) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alertAt, pending);
        } else if (Build.VERSION.SDK_INT >= 23) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alertAt, pending);
        } else {
            alarms.set(AlarmManager.RTC_WAKEUP, alertAt, pending);
        }
    }

    static void cancel(Context context, JSONObject schedule) {
        if (schedule == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = PendingIntent.getBroadcast(
                context, requestCode(schedule), reminderIntent(context, schedule), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) alarms.cancel(pending);
    }

    static String channelId(String sound) {
        return "daymark.reminder." + CHANNEL_VERSION + "." + normalizeSound(sound);
    }

    static void ensureChannel(Context context, String sound) {
        if (Build.VERSION.SDK_INT < 26) return;
        String normalizedSound = normalizeSound(sound);
        String channelId = channelId(normalizedSound);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(channelId) != null) return;
        String title = "Daymark " + channelLabel(normalizedSound);
        NotificationChannel channel = new NotificationChannel(channelId, title, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Audible Daymark reminder alerts");
        channel.setSound(soundUri(context, normalizedSound), audioAttributes(normalizedSound));
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0L, 180L, 120L, 180L});
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    static void ensureChannels(Context context) {
        ensureChannel(context, "soft");
        ensureChannel(context, "alert");
        ensureChannel(context, "alarm");
    }

    static Uri soundUri(Context context, String sound) {
        return Uri.parse(
                "android.resource://"
                        + context.getPackageName()
                        + "/raw/"
                        + soundResourceName(sound));
    }

    static AudioAttributes audioAttributes(String sound) {
        int usage = "alarm".equals(normalizeSound(sound))
                ? AudioAttributes.USAGE_ALARM
                : AudioAttributes.USAGE_NOTIFICATION;
        return new AudioAttributes.Builder().setUsage(usage).build();
    }

    private static boolean hasAudibleChannels(NotificationManager manager) {
        for (String sound : new String[]{"soft", "alert", "alarm"}) {
            NotificationChannel channel = manager.getNotificationChannel(channelId(sound));
            if (channel == null
                    || channel.getImportance() == NotificationManager.IMPORTANCE_NONE
                    || channel.getSound() == null) return false;
        }
        return true;
    }

    private static String normalizeSound(String sound) {
        return "alarm".equals(sound) ? "alarm" : "alert".equals(sound) ? "alert" : "soft";
    }

    static String channelLabel(String sound) {
        return "alarm".equals(sound)
                ? "alarm reminders"
                : "alert".equals(sound)
                        ? "ringtone reminders"
                        : "notification reminders";
    }

    private static String soundResourceName(String sound) {
        return "alarm".equals(normalizeSound(sound))
                ? "daymark_reminder_alarm"
                : "alert".equals(normalizeSound(sound))
                        ? "daymark_reminder_alert"
                        : "daymark_reminder_soft";
    }

    private static JSONArray read(Context context) {
        return parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SCHEDULES, "[]"));
    }

    private static JSONArray parse(String rawSchedules) {
        try {
            return new JSONArray(rawSchedules == null ? "[]" : rawSchedules);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static Intent reminderIntent(Context context, JSONObject schedule) {
        return new Intent(context, ReminderAlarmReceiver.class)
                .setAction(ACTION_REMINDER)
                .putExtra(EXTRA_ID, schedule.optString("id"))
                .putExtra(EXTRA_TITLE, schedule.optString("title"))
                .putExtra(EXTRA_DETAILS, schedule.optString("details"))
                .putExtra(EXTRA_EVENT_AT, schedule.optLong("eventAt"))
                .putExtra(EXTRA_MINUTES, schedule.optInt("minutes"))
                .putExtra(EXTRA_DIRECTION, schedule.optString("direction"))
                .putExtra(EXTRA_ORDINAL, schedule.optInt("ordinal"))
                .putExtra(EXTRA_TOTAL, schedule.optInt("total"))
                .putExtra(EXTRA_SOUND, schedule.optString("sound", "soft"));
    }

    static String title(Intent intent) { return intent.getStringExtra(EXTRA_TITLE); }
    static String id(Intent intent) { return intent.getStringExtra(EXTRA_ID); }
    static String details(Intent intent) { return intent.getStringExtra(EXTRA_DETAILS); }
    static int minutes(Intent intent) { return intent.getIntExtra(EXTRA_MINUTES, 0); }
    static String direction(Intent intent) { return intent.getStringExtra(EXTRA_DIRECTION); }
    static int ordinal(Intent intent) { return intent.getIntExtra(EXTRA_ORDINAL, 1); }
    static int total(Intent intent) { return intent.getIntExtra(EXTRA_TOTAL, 1); }
    static String sound(Intent intent) { return intent.getStringExtra(EXTRA_SOUND); }
    static int requestCode(JSONObject schedule) { return schedule.optString("id").hashCode(); }
}
