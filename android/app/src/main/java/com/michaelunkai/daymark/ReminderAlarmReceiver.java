package com.michaelunkai.daymark;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public final class ReminderAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String scheduleId = ReminderScheduler.id(intent);
        String fingerprint = ReminderScheduler.fingerprint(intent);
        if (!ReminderScheduler.isScheduled(context, scheduleId, fingerprint)) return;
        if (ReminderScheduler.isDelivered(context, scheduleId, fingerprint)) return;
        if (isAlreadyPosted(context, scheduleId)) {
            if (ReminderScheduler.markDelivered(context, scheduleId, fingerprint)) {
                ReminderScheduler.emitAcceptance(context, scheduleId, fingerprint);
            }
            return;
        }
        String sound = ReminderScheduler.sound(intent);
        if (!ReminderScheduler.notificationReady(context, sound)) {
            if (!ReminderScheduler.defer(context, intent)) {
                Log.w("DaymarkReminders", "Notification unavailable and retry budget exhausted for " + scheduleId);
            }
            return;
        }
        ReminderScheduler.ensureChannel(context, sound);
        String title = ReminderScheduler.title(intent);
        int minutes = ReminderScheduler.minutes(intent);
        boolean before = "before".equals(ReminderScheduler.direction(intent));
        String timing = before ? "starts in " + minutes + " minutes" : "started " + minutes + " minutes ago";
        String content = (title == null || title.isEmpty() ? "Reminder" : title) + " " + timing + ". Alert "
                + ReminderScheduler.ordinal(intent) + " of " + ReminderScheduler.total(intent) + ".";
        if (!post(context, sound, content, ReminderScheduler.details(intent), scheduleId)) {
            ReminderScheduler.defer(context, intent);
            return;
        }
        if (ReminderScheduler.markDelivered(context, scheduleId, fingerprint)) {
            ReminderScheduler.emitAcceptance(context, scheduleId, fingerprint);
        } else {
            // The notification may already be visible, but without a durable ledger
            // entry a later restart must retry rather than silently lose the alert.
            ReminderScheduler.defer(context, intent);
        }
    }

    static void postTest(Context context, String sound) {
        ReminderScheduler.ensureChannel(context, sound);
        post(
                context,
                sound,
                "This is the Daymark " + ReminderScheduler.channelLabel(sound) + " test.",
                "You will hear this tone when a reminder is due.",
                "daymark-reminder-test-" + sound);
    }

    private static boolean post(Context context, String sound, String content, String details, String scheduleId) {
        Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, ReminderScheduler.channelId(sound))
                : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("Daymark reminder")
                .setContentText(content)
                .setStyle(new Notification.BigTextStyle().bigText(content + (details == null || details.isEmpty() ? "" : "\n" + details)))
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setPriority(Notification.PRIORITY_HIGH)
                .setCategory("alarm".equals(sound) ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setSound(ReminderScheduler.soundUri(context, sound))
                    .setVibrate(new long[]{0L, 180L, 120L, 180L});
        }
        int notificationId = ReminderScheduler.notificationId(context, scheduleId);
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationId < 0 || manager == null) return false;
        try {
            manager.notify(notificationId, builder.build());
            return true;
        } catch (RuntimeException error) {
            Log.e("DaymarkReminders", "Unable to post reminder notification.", error);
            return false;
        }
    }

    private static boolean isAlreadyPosted(Context context, String scheduleId) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        int notificationId = ReminderScheduler.notificationId(context, scheduleId);
        if (manager == null || notificationId < 0 || Build.VERSION.SDK_INT < 23) return false;
        try {
            for (StatusBarNotification notification : manager.getActiveNotifications()) {
                if (notification.getId() == notificationId) return true;
            }
        } catch (RuntimeException error) {
            Log.w("DaymarkReminders", "Unable to inspect active reminder notifications.", error);
        }
        return false;
    }
}
