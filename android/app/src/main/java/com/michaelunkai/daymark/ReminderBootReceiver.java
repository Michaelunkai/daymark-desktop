package com.michaelunkai.daymark;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class ReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.i("DaymarkReminders", ReminderScheduler.reschedule(context));
        // USER LAW (2026-10-27): the phone must alert on reminders created on
        // any device, so the sync service comes back with the phone — not
        // only when the user opens the app.
        if (intent != null) {
            String action = intent.getAction();
            if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
                ReminderSyncService.ensureRunning(context);
            }
        }
    }
}
