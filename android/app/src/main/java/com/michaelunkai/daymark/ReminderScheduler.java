package com.michaelunkai.daymark;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

final class ReminderScheduler {
    private static final String PREFS = "daymark.reminders";
    private static final String SCHEDULES = "schedules";
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
        for (int index = 0; index < next.length(); index += 1) schedule(context, next.optJSONObject(index));
    }

    static void reschedule(Context context) {
        JSONArray schedules = read(context);
        for (int index = 0; index < schedules.length(); index += 1) schedule(context, schedules.optJSONObject(index));
    }

    static String status(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return "notifications-required";
        if (Build.VERSION.SDK_INT >= 31
                && !((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms()) return "exact-alarm-required";
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
        return "daymark.reminder." + ("alarm".equals(sound) ? "alarm" : "alert".equals(sound) ? "alert" : "soft");
    }

    static void ensureChannel(Context context, String sound) {
        if (Build.VERSION.SDK_INT < 26) return;
        String channelId = channelId(sound);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(channelId) != null) return;
        String title = "Daymark " + ("alarm".equals(sound) ? "alarm" : "alert".equals(sound) ? "alerts" : "reminders");
        NotificationChannel channel = new NotificationChannel(channelId, title, NotificationManager.IMPORTANCE_HIGH);
        Uri tone = RingtoneManager.getDefaultUri(
                "alarm".equals(sound) ? RingtoneManager.TYPE_ALARM : "alert".equals(sound) ? RingtoneManager.TYPE_NOTIFICATION : RingtoneManager.TYPE_RINGTONE);
        channel.setSound(tone, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
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
    static String details(Intent intent) { return intent.getStringExtra(EXTRA_DETAILS); }
    static int minutes(Intent intent) { return intent.getIntExtra(EXTRA_MINUTES, 0); }
    static String direction(Intent intent) { return intent.getStringExtra(EXTRA_DIRECTION); }
    static int ordinal(Intent intent) { return intent.getIntExtra(EXTRA_ORDINAL, 1); }
    static int total(Intent intent) { return intent.getIntExtra(EXTRA_TOTAL, 1); }
    static String sound(Intent intent) { return intent.getStringExtra(EXTRA_SOUND); }
    static int requestCode(JSONObject schedule) { return schedule.optString("id").hashCode(); }
}
