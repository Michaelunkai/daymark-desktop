package com.michaelunkai.daymark;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ReminderScheduler.reschedule(context);
    }
}
