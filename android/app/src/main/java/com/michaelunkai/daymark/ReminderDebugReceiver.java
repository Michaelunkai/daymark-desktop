package com.michaelunkai.daymark;

import android.content.pm.ApplicationInfo;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Debug-only test hook: arms a real reminder through ReminderScheduler.replace
 * (the app's own scheduling path) so the alarm/receiver/notification pipeline
 * can be verified from adb on debug builds. The activity is inert in release
 * builds: it refuses to run unless the application is debuggable.
 *
 * Usage:
 *   adb shell am start -n <pkg>/.ReminderDebugReceiver \
 *     --ei alertInSec 120 --es sound alarm --es title "Test"
 */
public final class ReminderDebugReceiver extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            Log.w("DaymarkReminders", "Debug reminder hook ignored on non-debug build.");
            finish();
            return;
        }
        Intent intent = getIntent();
        int alertInSec = Math.max(5, intent == null ? 120 : intent.getIntExtra("alertInSec", 120));
        String sound = intent.getStringExtra("sound");
        if (sound == null || sound.isEmpty()) sound = "alarm";
        String title = intent.getStringExtra("title");
        if (title == null || title.isEmpty()) title = "Debug reminder";
        long now = System.currentTimeMillis();
        long eventAt = now + alertInSec * 1000L;
        if (intent.hasExtra("alertOffsetMs")) {
            // Allows testing late-synced reminders: a negative offset puts
            // alertAt in the past so the catch-up path must arm it.
            eventAt = now + intent.getLongExtra("alertOffsetMs", 0L);
        }
        try {
            JSONObject schedule = new JSONObject()
                    .put("id", "debug-" + Long.toString(now, 36))
                    .put("reminderId", "debug-reminder")
                    .put("title", title)
                    .put("details", "Scheduled by ReminderDebugReceiver")
                    .put("eventAt", eventAt)
                    .put("alertAt", eventAt)
                    .put("minutes", 0)
                    .put("direction", "before")
                    .put("ordinal", 1)
                    .put("total", 1)
                    .put("sound", sound);
            String raw = new JSONArray().put(schedule).toString();
            String result = ReminderScheduler.replace(this, raw);
            Log.i("DaymarkReminders", "Debug reminder payload: " + raw);
            Log.i("DaymarkReminders", result);
            Toast.makeText(this, "Debug reminder armed: " + result, Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Log.e("DaymarkReminders", "Debug reminder scheduling failed.", error);
        }
        finish();
    }
}
