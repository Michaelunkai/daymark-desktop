package com.michaelunkai.daymark;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;

final class ReminderScheduler {
    private static final String PREFS = "daymark.reminders";
    private static final String SCHEDULES = "schedules";
    private static final String DELIVERED_IDS = "delivered_ids";
    private static final String RETRY_COUNTS = "retry_counts";
    private static final String REQUEST_CODES = "request_codes";
    private static final String NEXT_REQUEST_CODE = "next_request_code";
    // Android permanently retains a channel's sound after it is first created.
    // A versioned ID gives existing installations a fresh, audible reminder channel.
    private static final String CHANNEL_VERSION = "v3";
    private static final String ACTION_REMINDER = "com.michaelunkai.daymark.REMINDER";
    static final String ACTION_RECONCILE =
            "com.michaelunkai.daymark.REMINDER_RECONCILE";
    private static final String ACTION_REMINDER_ACCEPTED =
            "com.michaelunkai.daymark.REMINDER_ACCEPTED";
    private static final String EXTRA_ID = "id";
    private static final String EXTRA_FINGERPRINT = "fingerprint";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_DETAILS = "details";
    private static final String EXTRA_EVENT_AT = "eventAt";
    private static final String EXTRA_MINUTES = "minutes";
    private static final String EXTRA_DIRECTION = "direction";
    private static final String EXTRA_ORDINAL = "ordinal";
    private static final String EXTRA_TOTAL = "total";
    private static final String EXTRA_SOUND = "sound";
    private static final String EXTRA_RETRY_COUNT = "retryCount";
    private static final long NOTIFICATION_RETRY_DELAY_MS = 60_000L;
    private static final long MAX_NOTIFICATION_RETRY_DELAY_MS = 15 * 60_000L;
    private static final long MISSED_ALERT_SPACING_MS = 13_000L;
    private static final long RECONCILE_DELAY_MS = 90_000L;
    private static final int MAX_OVERDUE_CATCH_UP = 3;
    private static final int MAX_NOTIFICATION_RETRIES = 5;
    private static final int REQUEST_CODE_START = 1000;
    private static final int REQUEST_CODE_MAX = 0x7ffffffe;
    private static final int RECONCILE_REQUEST_CODE = 999;
    private static final Object REQUEST_CODE_LOCK = new Object();

    private ReminderScheduler() {}

    static String replace(Context context, String rawSchedules) {
        JSONArray next = parse(rawSchedules);
        if (next == null || !validSchedules(next)) {
            return result(
                    context,
                    false,
                    false,
                    "invalid-schedules",
                    new JSONArray(),
                    new ReconcileSummary());
        }

        JSONArray previous;
        try {
            previous = read(context);
        } catch (IllegalStateException error) {
            Log.e("DaymarkReminders", "Stored reminder schedules are unreadable.", error);
            return result(
                    context,
                    false,
                    false,
                    "stored-schedules-unreadable",
                    next,
                    new ReconcileSummary());
        }
        // Persist the new source of truth before touching alarms. A crash after this
        // commit leaves boot/activity reconciliation able to discard stale alarms.
        if (!write(context, next)) {
            return result(
                    context,
                    false,
                    false,
                    "schedule-persistence-failed",
                    next,
                    new ReconcileSummary());
        }

        for (int index = 0; index < previous.length(); index += 1) {
            cancel(context, previous.optJSONObject(index));
        }
        boolean ledgerPersisted = pruneDeliveredLedger(context, next);
        boolean retriesPersisted = pruneRetryLedger(context, next);
        ReconcileSummary summary = reconcile(context, next);
        return result(
                context,
                ledgerPersisted && retriesPersisted && summary.failures == 0,
                true,
                !ledgerPersisted
                        ? "delivery-ledger-persistence-failed"
                        : !retriesPersisted ? "retry-ledger-persistence-failed" : null,
                next,
                summary);
    }

    static String reschedule(Context context) {
        try {
            JSONArray schedules = read(context);
            ReconcileSummary summary = reconcile(context, schedules);
            return result(context, summary.failures == 0, true, null, schedules, summary);
        } catch (IllegalStateException error) {
            Log.e("DaymarkReminders", "Stored reminder schedules are unreadable.", error);
            return result(
                    context,
                    false,
                    false,
                    "stored-schedules-unreadable",
                    new JSONArray(),
                    new ReconcileSummary());
        }
    }

    static String status(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return "notifications-required";
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return "notifications-unavailable";
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) {
            return "notifications-disabled";
        }
        if ("required".equals(exactAlarmStatus(context))) return "exact-alarm-required";
        ensureChannels(context);
        if (Build.VERSION.SDK_INT >= 26 && !hasAudibleChannels(manager)) {
            return "sound-required";
        }
        return "ready";
    }

    static void schedule(Context context, JSONObject schedule) {
        if (schedule == null) return;
        long alertAt = schedule.optLong("alertAt", 0L);
        if (alertAt <= System.currentTimeMillis() || isDelivered(context, schedule)) return;
        scheduleAt(context, schedule, alertAt);
    }

    private static ScheduleOutcome scheduleAt(Context context, JSONObject schedule, long alertAt) {
        if (schedule == null || alertAt <= 0L) return ScheduleOutcome.failure();
        int requestCode = requestCode(context, schedule.optString("id"));
        if (requestCode < 0) return ScheduleOutcome.failure();
        int retryCount = persistedRetryCount(
                context,
                schedule.optString("id"),
                fingerprint(schedule));
        return scheduleIntentAt(
                context,
                reminderIntent(context, schedule).putExtra(EXTRA_RETRY_COUNT, retryCount),
                requestCode,
                alertAt);
    }

    private static ScheduleOutcome scheduleIntentAt(
            Context context,
            Intent intent,
            int requestCode,
            long alertAt) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null || requestCode < 0 || alertAt <= 0L) {
            return ScheduleOutcome.failure();
        }

        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        try {
            // Reusing the same PendingIntent identity replaces the prior alarm. Cancel
            // first so a permission transition cannot leave exact and fallback alarms.
            alarms.cancel(pending);
            if (canScheduleExactAlarms(context)) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alertAt, pending);
                    return ScheduleOutcome.exact();
                } catch (SecurityException error) {
                    Log.w("DaymarkReminders", "Exact alarm permission changed while scheduling.", error);
                }
            }
            if (Build.VERSION.SDK_INT >= 23) {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alertAt, pending);
            } else {
                alarms.set(AlarmManager.RTC_WAKEUP, alertAt, pending);
            }
            return ScheduleOutcome.inexact();
        } catch (RuntimeException error) {
            Log.e("DaymarkReminders", "Unable to schedule reminder alarm.", error);
            return ScheduleOutcome.failure();
        }
    }

    static void cancel(Context context, JSONObject schedule) {
        if (schedule == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;

        int requestCode = requestCode(context, schedule.optString("id"));
        if (requestCode >= 0) {
            cancelPendingIntent(
                    alarms,
                    PendingIntent.getBroadcast(
                            context,
                            requestCode,
                            reminderIntent(context, schedule),
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE));
        }

        // Remove alarms created by versions that used the raw Java string hash and
        // omitted data from the PendingIntent identity.
        cancelPendingIntent(
                alarms,
                PendingIntent.getBroadcast(
                        context,
                        legacyRequestCode(schedule.optString("id")),
                        legacyReminderIntent(context, schedule),
                        PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE));
    }

    static String channelId(String sound) {
        return "daymark.reminder." + CHANNEL_VERSION + "." + normalizeSound(sound);
    }

    static void ensureChannel(Context context, String sound) {
        if (Build.VERSION.SDK_INT < 26) return;
        String normalizedSound = normalizeSound(sound);
        String channelId = channelId(normalizedSound);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(channelId) != null) return;
        String title = "Daymark " + channelLabel(normalizedSound);
        NotificationChannel channel = new NotificationChannel(
                channelId,
                title,
                NotificationManager.IMPORTANCE_HIGH);
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
        if (manager == null) return false;
        for (String sound : new String[]{"soft", "alert", "alarm"}) {
            NotificationChannel channel = manager.getNotificationChannel(channelId(sound));
            if (channel == null
                    || channel.getImportance() == NotificationManager.IMPORTANCE_NONE
                    || channel.getSound() == null) {
                return false;
            }
        }
        return true;
    }

    private static String normalizeSound(String sound) {
        return "alarm".equals(sound) ? "alarm" : "alert".equals(sound) ? "alert" : "soft";
    }

    static String channelLabel(String sound) {
        return "alarm".equals(normalizeSound(sound))
                ? "alarm reminders"
                : "alert".equals(normalizeSound(sound))
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
        JSONArray schedules = parse(preferences(context).getString(SCHEDULES, "[]"));
        if (schedules == null || !validSchedules(schedules)) {
            throw new IllegalStateException("Stored reminder schedule JSON is invalid.");
        }
        return schedules;
    }

    private static boolean write(Context context, JSONArray schedules) {
        return preferences(context).edit().putString(SCHEDULES, schedules.toString()).commit();
    }

    private static SharedPreferences preferences(Context context) {
        if (Build.VERSION.SDK_INT < 24) {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        }
        Context deviceContext = context.createDeviceProtectedStorageContext();
        SharedPreferences devicePreferences =
                deviceContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!context.isDeviceProtectedStorage() && !devicePreferences.contains(SCHEDULES)) {
            SharedPreferences legacy = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (legacy.contains(SCHEDULES)) {
                boolean migrated = devicePreferences.edit()
                        .putString(SCHEDULES, legacy.getString(SCHEDULES, "[]"))
                        .putString(DELIVERED_IDS, legacy.getString(DELIVERED_IDS, "{}"))
                        .putString(RETRY_COUNTS, legacy.getString(RETRY_COUNTS, "{}"))
                        .putString(REQUEST_CODES, legacy.getString(REQUEST_CODES, "{}"))
                        .putInt(NEXT_REQUEST_CODE, legacy.getInt(NEXT_REQUEST_CODE, REQUEST_CODE_START))
                        .commit();
                if (!migrated) {
                    throw new IllegalStateException(
                            "Unable to migrate reminder state into device-protected storage.");
                }
            }
        }
        return devicePreferences;
    }

    static boolean isScheduled(Context context, String scheduleId) {
        return isScheduled(context, scheduleId, null);
    }

    static boolean isScheduled(Context context, String scheduleId, String expectedFingerprint) {
        if (scheduleId == null || scheduleId.isEmpty()) return false;
        JSONArray schedules;
        try {
            schedules = read(context);
        } catch (IllegalStateException error) {
            Log.e("DaymarkReminders", "Cannot verify reminder against stored schedules.", error);
            return false;
        }
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule != null && scheduleId.equals(schedule.optString("id"))) {
                return expectedFingerprint == null
                        || expectedFingerprint.equals(fingerprint(schedule));
            }
        }
        return false;
    }

    static boolean isDelivered(Context context, JSONObject schedule) {
        return schedule != null
                && isDelivered(context, schedule.optString("id"), fingerprint(schedule));
    }

    static boolean isDelivered(Context context, String scheduleId, String expectedFingerprint) {
        if (scheduleId == null || scheduleId.isEmpty() || expectedFingerprint == null) return false;
        JSONObject ledger = deliveredLedger(context);
        return expectedFingerprint.equals(ledger.optString(scheduleId, null));
    }

    static boolean markDelivered(Context context, String scheduleId, String expectedFingerprint) {
        if (scheduleId == null || scheduleId.isEmpty() || expectedFingerprint == null) return false;
        JSONObject ledger = deliveredLedger(context);
        try {
            ledger.put(scheduleId, expectedFingerprint);
        } catch (Exception ignored) {
            return false;
        }
        boolean committed = preferences(context).edit()
                .putString(DELIVERED_IDS, ledger.toString())
                .commit();
        if (committed) clearRetryCount(context, scheduleId);
        return committed;
    }

    static boolean notificationReady(Context context, String sound) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        ensureChannel(context, sound);
        NotificationChannel channel = manager.getNotificationChannel(channelId(sound));
        return channel != null
                && channel.getImportance() != NotificationManager.IMPORTANCE_NONE
                && channel.getSound() != null;
    }

    static boolean defer(Context context, Intent intent) {
        String scheduleId = id(intent);
        if (scheduleId == null || scheduleId.isEmpty()) return false;

        String expectedFingerprint = fingerprint(intent);
        int retryCount = Math.max(
                retryCount(intent),
                persistedRetryCount(context, scheduleId, expectedFingerprint));
        if (retryCount >= MAX_NOTIFICATION_RETRIES) {
            Log.w("DaymarkReminders", "Notification retry limit reached for " + scheduleId);
            return false;
        }

        int nextRetryCount = retryCount + 1;
        if (!persistRetryCount(context, scheduleId, expectedFingerprint, nextRetryCount)) {
            Log.e("DaymarkReminders", "Unable to persist notification retry state for " + scheduleId);
            return false;
        }
        long delay = Math.min(
                MAX_NOTIFICATION_RETRY_DELAY_MS,
                NOTIFICATION_RETRY_DELAY_MS * (1L << Math.min(retryCount, 4)));
        Intent retryIntent = new Intent(intent).putExtra(EXTRA_RETRY_COUNT, nextRetryCount);
        int requestCode = requestCode(context, scheduleId);
        if (requestCode < 0) return false;
        return scheduleIntentAt(
                context,
                retryIntent,
                requestCode,
                System.currentTimeMillis() + delay).scheduled;
    }

    static void emitAcceptance(Context context, String scheduleId, String expectedFingerprint) {
        if (scheduleId == null || scheduleId.isEmpty() || expectedFingerprint == null) return;
        context.sendBroadcast(
                new Intent(ACTION_REMINDER_ACCEPTED)
                        .setPackage(context.getPackageName())
                        .putExtra(EXTRA_ID, scheduleId)
                        .putExtra(EXTRA_FINGERPRINT, expectedFingerprint));
    }

    static int retryCount(Intent intent) {
        return intent == null ? 0 : Math.max(0, intent.getIntExtra(EXTRA_RETRY_COUNT, 0));
    }

    static int notificationId(Context context, String scheduleId) {
        return requestCode(context, scheduleId);
    }

    private static JSONArray parse(String rawSchedules) {
        try {
            return new JSONArray(rawSchedules == null ? "[]" : rawSchedules);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean validSchedules(JSONArray schedules) {
        HashSet<String> ids = new HashSet<>();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule == null
                    || schedule.optString("id").isEmpty()
                    || !ids.add(schedule.optString("id"))
                    || schedule.optString("title").trim().isEmpty()
                    || schedule.optLong("eventAt", 0L) <= 0L
                    || schedule.optLong("alertAt", 0L) <= 0L
                    || schedule.optInt("minutes", -1) < 0
                    || schedule.optInt("ordinal", 0) <= 0
                    || schedule.optInt("total", 0) <= 0
                    || !("before".equals(schedule.optString("direction"))
                    || "after".equals(schedule.optString("direction")))
                    || !("soft".equals(schedule.optString("sound"))
                    || "alert".equals(schedule.optString("sound"))
                    || "alarm".equals(schedule.optString("sound")))) {
                return false;
            }
        }
        return true;
    }

    private static Intent reminderIntent(Context context, JSONObject schedule) {
        return new Intent(context, ReminderAlarmReceiver.class)
                .setAction(ACTION_REMINDER)
                .setData(reminderUri(schedule.optString("id")))
                .putExtra(EXTRA_ID, schedule.optString("id"))
                .putExtra(EXTRA_FINGERPRINT, fingerprint(schedule))
                .putExtra(EXTRA_TITLE, schedule.optString("title"))
                .putExtra(EXTRA_DETAILS, schedule.optString("details"))
                .putExtra(EXTRA_EVENT_AT, schedule.optLong("eventAt"))
                .putExtra(EXTRA_MINUTES, schedule.optInt("minutes"))
                .putExtra(EXTRA_DIRECTION, schedule.optString("direction"))
                .putExtra(EXTRA_ORDINAL, schedule.optInt("ordinal"))
                .putExtra(EXTRA_TOTAL, schedule.optInt("total"))
                .putExtra(EXTRA_SOUND, schedule.optString("sound", "soft"));
    }

    private static Intent legacyReminderIntent(Context context, JSONObject schedule) {
        return reminderIntent(context, schedule).setData(null);
    }

    private static Uri reminderUri(String scheduleId) {
        return Uri.parse("daymark-reminder://" + Uri.encode(scheduleId == null ? "" : scheduleId));
    }

    static String title(Intent intent) { return intent.getStringExtra(EXTRA_TITLE); }
    static String id(Intent intent) { return intent.getStringExtra(EXTRA_ID); }
    static String fingerprint(Intent intent) { return intent.getStringExtra(EXTRA_FINGERPRINT); }
    static String details(Intent intent) { return intent.getStringExtra(EXTRA_DETAILS); }
    static int minutes(Intent intent) { return intent.getIntExtra(EXTRA_MINUTES, 0); }
    static String direction(Intent intent) { return intent.getStringExtra(EXTRA_DIRECTION); }
    static int ordinal(Intent intent) { return intent.getIntExtra(EXTRA_ORDINAL, 1); }
    static int total(Intent intent) { return intent.getIntExtra(EXTRA_TOTAL, 1); }
    static String sound(Intent intent) { return intent.getStringExtra(EXTRA_SOUND); }

    static String fingerprint(JSONObject schedule) {
        String identity = schedule.optString("id")
                + "|" + schedule.optString("reminderId")
                + "|" + schedule.optString("title")
                + "|" + schedule.optString("details")
                + "|" + schedule.optLong("eventAt", 0L)
                + "|" + schedule.optLong("alertAt", 0L)
                + "|" + schedule.optInt("minutes", 0)
                + "|" + schedule.optString("direction")
                + "|" + schedule.optInt("ordinal", 0)
                + "|" + schedule.optInt("total", 0)
                + "|" + normalizeSound(schedule.optString("sound"));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(identity.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte value : digest) result.append(String.format("%02x", value & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException ignored) {
            return Integer.toHexString(identity.length());
        }
    }

    private static JSONObject deliveredLedger(Context context) {
        try {
            return new JSONObject(preferences(context).getString(DELIVERED_IDS, "{}"));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static boolean pruneDeliveredLedger(Context context, JSONArray schedules) {
        JSONObject previous = deliveredLedger(context);
        JSONObject next = new JSONObject();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule == null) continue;
            String scheduleId = schedule.optString("id");
            String expectedFingerprint = fingerprint(schedule);
            if (expectedFingerprint.equals(previous.optString(scheduleId, null))) {
                try {
                    next.put(scheduleId, expectedFingerprint);
                } catch (Exception ignored) {
                    return false;
                }
            }
        }
        return preferences(context).edit().putString(DELIVERED_IDS, next.toString()).commit();
    }

    private static JSONObject retryLedger(Context context) {
        try {
            return new JSONObject(preferences(context).getString(RETRY_COUNTS, "{}"));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static int persistedRetryCount(
            Context context,
            String scheduleId,
            String expectedFingerprint) {
        if (scheduleId == null || scheduleId.isEmpty() || expectedFingerprint == null) return 0;
        JSONObject entry = retryLedger(context).optJSONObject(scheduleId);
        if (entry == null || !expectedFingerprint.equals(entry.optString("fingerprint"))) return 0;
        return Math.max(0, entry.optInt("count", 0));
    }

    private static boolean persistRetryCount(
            Context context,
            String scheduleId,
            String expectedFingerprint,
            int count) {
        if (scheduleId == null || scheduleId.isEmpty() || expectedFingerprint == null) return false;
        JSONObject ledger = retryLedger(context);
        try {
            ledger.put(
                    scheduleId,
                    new JSONObject()
                            .put("fingerprint", expectedFingerprint)
                            .put("count", Math.max(0, count)));
        } catch (Exception error) {
            return false;
        }
        return preferences(context).edit().putString(RETRY_COUNTS, ledger.toString()).commit();
    }

    private static void clearRetryCount(Context context, String scheduleId) {
        if (scheduleId == null || scheduleId.isEmpty()) return;
        JSONObject ledger = retryLedger(context);
        ledger.remove(scheduleId);
        preferences(context).edit().putString(RETRY_COUNTS, ledger.toString()).commit();
    }

    private static boolean pruneRetryLedger(Context context, JSONArray schedules) {
        JSONObject previous = retryLedger(context);
        JSONObject next = new JSONObject();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule == null) continue;
            String scheduleId = schedule.optString("id");
            JSONObject retry = previous.optJSONObject(scheduleId);
            if (retry == null
                    || !fingerprint(schedule).equals(retry.optString("fingerprint"))) {
                continue;
            }
            try {
                next.put(scheduleId, retry);
            } catch (Exception error) {
                return false;
            }
        }
        return preferences(context).edit().putString(RETRY_COUNTS, next.toString()).commit();
    }

    private static ReconcileSummary reconcile(Context context, JSONArray schedules) {
        ReconcileSummary summary = new ReconcileSummary();
        ensureChannels(context);
        cancelStaleAllocatedAlarms(context, schedules);

        List<JSONObject> ordered = new ArrayList<>();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule != null) ordered.add(schedule);
        }
        Collections.sort(
                ordered,
                Comparator
                        .comparingInt((JSONObject schedule) -> persistedRetryCount(
                                context,
                                schedule.optString("id"),
                                fingerprint(schedule)))
                        .thenComparingLong(schedule ->
                                schedule.optLong("alertAt", Long.MAX_VALUE)));

        long now = System.currentTimeMillis();
        int overdueScheduled = 0;
        int overduePending = 0;
        for (JSONObject schedule : ordered) {
            if (isDelivered(context, schedule)) {
                cancel(context, schedule);
                continue;
            }

            long alertAt = schedule.optLong("alertAt", 0L);
            if (alertAt <= now) {
                summary.overdueCount += 1;
                int retryCount = persistedRetryCount(
                        context,
                        schedule.optString("id"),
                        fingerprint(schedule));
                if (notificationReady(context, schedule.optString("sound")) && retryCount > 0) {
                    clearRetryCount(context, schedule.optString("id"));
                    retryCount = 0;
                }
                if (retryCount >= MAX_NOTIFICATION_RETRIES) {
                    summary.exhaustedCount += 1;
                    continue;
                }
                if (overdueScheduled >= MAX_OVERDUE_CATCH_UP) {
                    overduePending += 1;
                    continue;
                }
                overdueScheduled += 1;
                alertAt = now + 500L + (overdueScheduled - 1L) * MISSED_ALERT_SPACING_MS;
            }

            ScheduleOutcome outcome = scheduleAt(context, schedule, alertAt);
            if (!outcome.scheduled) {
                summary.failures += 1;
                continue;
            }
            summary.scheduledCount += 1;
            if (outcome.exact) summary.exactCount += 1;
        }

        if (overduePending > 0) {
            summary.catchUpPending = scheduleReconcile(context, now + RECONCILE_DELAY_MS);
        } else {
            cancelReconcile(context);
        }
        return summary;
    }

    private static void cancelStaleAllocatedAlarms(Context context, JSONArray schedules) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        SharedPreferences prefs = preferences(context);
        JSONObject allocations = requestCodeLedger(prefs);
        HashSet<String> currentIds = new HashSet<>();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule != null) currentIds.add(schedule.optString("id"));
        }

        JSONObject retained = new JSONObject();
        Iterator<String> keys = allocations.keys();
        while (keys.hasNext()) {
            String scheduleId = keys.next();
            int requestCode = allocations.optInt(scheduleId, -1);
            if (currentIds.contains(scheduleId)) {
                try {
                    retained.put(scheduleId, requestCode);
                } catch (Exception ignored) {
                    return;
                }
                continue;
            }
            Intent currentIntent = new Intent(context, ReminderAlarmReceiver.class)
                    .setAction(ACTION_REMINDER)
                    .setData(reminderUri(scheduleId));
            cancelPendingIntent(
                    alarms,
                    PendingIntent.getBroadcast(
                            context,
                            requestCode,
                            currentIntent,
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE));
            cancelPendingIntent(
                    alarms,
                    PendingIntent.getBroadcast(
                            context,
                            legacyRequestCode(scheduleId),
                            new Intent(context, ReminderAlarmReceiver.class).setAction(ACTION_REMINDER),
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE));
        }
        prefs.edit().putString(REQUEST_CODES, retained.toString()).commit();
    }

    private static boolean scheduleReconcile(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return false;
        PendingIntent pending = reconciliationPendingIntent(context);
        try {
            alarms.cancel(pending);
            if (Build.VERSION.SDK_INT >= 23) {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                alarms.set(AlarmManager.RTC_WAKEUP, at, pending);
            }
            return true;
        } catch (RuntimeException error) {
            Log.e("DaymarkReminders", "Unable to schedule overdue reminder reconciliation.", error);
            return false;
        }
    }

    private static void cancelReconcile(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                RECONCILE_REQUEST_CODE,
                reconciliationIntent(context),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        cancelPendingIntent(alarms, pending);
    }

    private static PendingIntent reconciliationPendingIntent(Context context) {
        return PendingIntent.getBroadcast(
                context,
                RECONCILE_REQUEST_CODE,
                reconciliationIntent(context),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Intent reconciliationIntent(Context context) {
        return new Intent(context, ReminderBootReceiver.class)
                .setAction(ACTION_RECONCILE)
                .setData(Uri.parse("daymark-reminder://reconcile"));
    }

    private static void cancelPendingIntent(AlarmManager alarms, PendingIntent pending) {
        if (pending != null) alarms.cancel(pending);
    }

    private static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    static String exactAlarmStatus(Context context) {
        return Build.VERSION.SDK_INT < 31
                ? "not-required"
                : canScheduleExactAlarms(context) ? "granted" : "required";
    }

    private static int requestCode(Context context, String scheduleId) {
        if (scheduleId == null || scheduleId.isEmpty()) return -1;
        synchronized (REQUEST_CODE_LOCK) {
            SharedPreferences prefs = preferences(context);
            JSONObject allocations = requestCodeLedger(prefs);
            int assigned = allocations.optInt(scheduleId, -1);
            if (assigned >= REQUEST_CODE_START && assigned <= REQUEST_CODE_MAX) return assigned;

            HashSet<Integer> used = new HashSet<>();
            Iterator<String> keys = allocations.keys();
            while (keys.hasNext()) {
                int value = allocations.optInt(keys.next(), -1);
                if (value >= REQUEST_CODE_START && value <= REQUEST_CODE_MAX) used.add(value);
            }

            int candidate = prefs.getInt(NEXT_REQUEST_CODE, REQUEST_CODE_START);
            if (candidate < REQUEST_CODE_START || candidate > REQUEST_CODE_MAX) {
                candidate = REQUEST_CODE_START;
            }
            int attempts = 0;
            while (used.contains(candidate) && attempts <= REQUEST_CODE_MAX - REQUEST_CODE_START) {
                candidate = candidate == REQUEST_CODE_MAX ? REQUEST_CODE_START : candidate + 1;
                attempts += 1;
            }
            if (used.contains(candidate)) return -1;

            try {
                allocations.put(scheduleId, candidate);
            } catch (Exception error) {
                return -1;
            }
            int nextCandidate = candidate == REQUEST_CODE_MAX
                    ? REQUEST_CODE_START
                    : candidate + 1;
            boolean committed = prefs.edit()
                    .putString(REQUEST_CODES, allocations.toString())
                    .putInt(NEXT_REQUEST_CODE, nextCandidate)
                    .commit();
            return committed ? candidate : -1;
        }
    }

    private static JSONObject requestCodeLedger(SharedPreferences prefs) {
        try {
            return new JSONObject(prefs.getString(REQUEST_CODES, "{}"));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static int legacyRequestCode(String scheduleId) {
        if (scheduleId == null) return 0;
        int result = 0;
        for (int index = 0; index < scheduleId.length(); index += 1) {
            result = 31 * result + scheduleId.charAt(index);
        }
        return result;
    }

    private static String result(
            Context context,
            boolean ok,
            boolean persisted,
            String error,
            JSONArray schedules,
            ReconcileSummary summary) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("persisted", persisted);
            result.put("scheduleCount", schedules.length());
            result.put("scheduledCount", summary.scheduledCount);
            result.put("overdueCount", summary.overdueCount);
            result.put("catchUpPending", summary.catchUpPending);
            result.put("retryExhaustedCount", summary.exhaustedCount);
            result.put("exactScheduledCount", summary.exactCount);
            result.put("exactAlarm", exactAlarmStatus(context));
            result.put("notificationStatus", status(context));
            if (error != null) result.put("error", error);
        } catch (Exception ignored) {
            return "{\"ok\":false,\"persisted\":false,\"error\":\"result-serialization-failed\"}";
        }
        return result.toString();
    }

    private static final class ReconcileSummary {
        int scheduledCount;
        int overdueCount;
        int exactCount;
        int failures;
        int exhaustedCount;
        boolean catchUpPending;
    }

    private static final class ScheduleOutcome {
        final boolean scheduled;
        final boolean exact;

        private ScheduleOutcome(boolean scheduled, boolean exact) {
            this.scheduled = scheduled;
            this.exact = exact;
        }

        static ScheduleOutcome exact() {
            return new ScheduleOutcome(true, true);
        }

        static ScheduleOutcome inexact() {
            return new ScheduleOutcome(true, false);
        }

        static ScheduleOutcome failure() {
            return new ScheduleOutcome(false, false);
        }
    }
}
