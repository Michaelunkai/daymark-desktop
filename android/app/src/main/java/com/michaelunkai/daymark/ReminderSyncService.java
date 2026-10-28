package com.michaelunkai.daymark;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * USER LAW (2026-10-27): a reminder created on ANY device must alert BOTH
 * devices, always. The Daymark app is a WebView app with no background
 * execution, so reminders created on the PC could not reach this phone until
 * the app was next opened. This foreground service closes that gap: it
 * long-polls the PC server's compact reminder feed (a few hundred bytes, not
 * the full sync document) and feeds any change straight into the existing
 * native ReminderScheduler — the same exact-alarm + sound + voice machinery
 * the in-app sync uses. One silent low-priority notification keeps it alive;
 * no wake locks, so idle cost is the long-poll socket only.
 */
public final class ReminderSyncService extends Service {
    private static final String TAG = "DaymarkReminders";
    private static final String CHANNEL_ID = "daymark.reminder.sync";
    private static final int NOTIFICATION_ID = 9101;
    private static final String PREFS = "daymark";
    private static final String SYNC_KEY_PREF = "sync_key";
    private static final String FEED_HOST = "http://100.76.198.53:18780";
    private static final long POLL_TIMEOUT_MS = 25_000L;
    private static final long MAX_BACKOFF_MS = 60_000L;

    private Thread worker;
    private volatile boolean stopping;
    private long lastRevision = -1L;
    private int lastDigest = 0;

    static void ensureRunning(Context context) {
        try {
            context.startForegroundService(new Intent(context, ReminderSyncService.class));
        } catch (RuntimeException error) {
            // Started from a context that cannot launch foreground services
            // (e.g. background restrictions) — the boot receiver retries at
            // the next boot and MainActivity retries on every open.
            Log.w(TAG, "Reminder sync service start refused: " + error.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (worker == null || !worker.isAlive()) {
            stopping = false;
            worker = new Thread(this::pollLoop, "daymark-reminder-sync");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollLoop() {
        long backoffMs = 1_000L;
        while (!stopping) {
            try {
                final int result = pollOnce();
                if (result > 0) {
                    backoffMs = 1_000L;
                } else {
                    sleepQuiet(Math.min(backoffMs, MAX_BACKOFF_MS));
                    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
                }
            } catch (InterruptedException stopped) {
                return;
            } catch (RuntimeException error) {
                Log.w(TAG, "Reminder feed poll failed: " + error.getMessage());
                backoffMs = Math.min(Math.max(backoffMs, 1_000L) * 2, MAX_BACKOFF_MS);
                sleepQuiet(backoffMs);
            }
        }
    }

    /** @return 1 when new schedules were armed, 0 when nothing changed, -1 on error. */
    private int pollOnce() throws InterruptedException {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = preferences.getString(SYNC_KEY_PREF, null);
        if (key == null || key.trim().isEmpty()) {
            // Not paired yet — retry after the app has stored a key.
            throw new IllegalStateException("no sync key stored yet");
        }
        HttpURLConnection connection = null;
        try {
            String spec = FEED_HOST + "/api/sync/" + key.trim() + "/reminder-feed?rev=" + lastRevision + "&wait=1";
            connection = (HttpURLConnection) new URL(spec).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout((int) POLL_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 204) return 0; // still current
            if (status != 200) {
                Log.w(TAG, "Reminder feed HTTP " + status);
                return -1;
            }
            String body = readBody(connection.getInputStream());
            JSONObject payload = new JSONObject(body);
            long revision = payload.optLong("revision", -1L);
            JSONArray schedules = payload.optJSONArray("schedules");
            if (schedules == null) return -1;
            int digest = schedulesDigest(schedules);
            if (revision == lastRevision && digest == lastDigest) return 0;
            String replaceStatus = ReminderScheduler.replace(this, schedules.toString());
            Log.i(TAG, "Reminder feed armed rev=" + revision + " count=" + schedules.length()
                    + " status=" + replaceStatus);
            lastRevision = revision;
            lastDigest = digest;
            return 1;
        } catch (InterruptedException stopped) {
            throw stopped;
        } catch (Exception error) {
            Log.w(TAG, "Reminder feed error: " + error.getMessage());
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static int schedulesDigest(JSONArray schedules) {
        // Only the identity fields matter: a changed title with the same id
        // and version is impossible (version is the reminder's updatedAt).
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < schedules.length(); index += 1) {
            JSONObject schedule = schedules.optJSONObject(index);
            if (schedule == null) continue;
            builder.append(schedule.optString("id")).append('|')
                    .append(schedule.optString("version")).append('|')
                    .append(schedule.optLong("alertAt")).append('|')
                    .append(schedule.optString("sound")).append('\n');
        }
        return builder.toString().hashCode();
    }

    private static String readBody(InputStream stream) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int read;
        while ((read = stream.read(chunk)) >= 0) buffer.write(chunk, 0, read);
        return buffer.toString("UTF-8");
    }

    private static void sleepQuiet(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException stopped) {
            Thread.currentThread().interrupt();
        }
    }

    private Notification buildNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager != null
                && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Reminder sync",
                    NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Keeps reminders created on your PC alerting this phone.");
            channel.setSound(null, null);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("Daymark reminders active")
                .setContentText("Alerts from any device reach this phone.")
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_MIN)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_SECRET)
                .build();
    }
}
