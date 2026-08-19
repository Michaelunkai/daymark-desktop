package com.michaelunkai.daymark;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class ReminderAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String sound = ReminderScheduler.sound(intent);
        ReminderScheduler.ensureChannel(context, sound);
        String title = ReminderScheduler.title(intent);
        int minutes = ReminderScheduler.minutes(intent);
        boolean before = "before".equals(ReminderScheduler.direction(intent));
        String timing = before ? "starts in " + minutes + " minutes" : "started " + minutes + " minutes ago";
        String content = (title == null || title.isEmpty() ? "Reminder" : title) + " " + timing + ". Alert "
                + ReminderScheduler.ordinal(intent) + " of " + ReminderScheduler.total(intent) + ".";
        post(context, sound, content, ReminderScheduler.details(intent), ReminderScheduler.id(intent));
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

    private static void post(Context context, String sound, String content, String details, String scheduleId) {
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
            builder.setSound(ReminderScheduler.soundUri(sound))
                    .setVibrate(new long[]{0L, 180L, 120L, 180L});
        }
        int notificationId = (scheduleId == null || scheduleId.isEmpty()
                ? content
                : scheduleId).hashCode();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
                .notify(notificationId, builder.build());
    }
}
