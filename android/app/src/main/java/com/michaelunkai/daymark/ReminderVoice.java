package com.michaelunkai.daymark;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Speaks a reminder aloud so alerts are heard, not just seen. Uses the ALARM
 * audio usage so the voice is audible at reminder volume even in Doze, and a
 * partial wake lock so the device cannot sleep mid-sentence. Every failure
 * path releases the engine — a leak here would silently kill later reminders.
 */
public final class ReminderVoice {
    private static final String TAG = "DaymarkReminders";
    private static final String UTTERANCE_ID = "daymark-reminder-voice";
    private static final int MAX_SPOKEN_CHARS = 400;
    private static final long WAKE_LOCK_TIMEOUT_MS = 45_000L;
    private static final long FORCED_SHUTDOWN_MS = 35_000L;

    private ReminderVoice() {}

    static void speak(final Context context, final String text) {
        if (text == null || text.trim().isEmpty()) return;
        final Context app = context.getApplicationContext();
        final PowerManager.WakeLock wakeLock = acquireWakeLock(app);
        final AtomicBoolean done = new AtomicBoolean(false);
        final AtomicReference<TextToSpeech> engineRef = new AtomicReference<>();
        final Handler main = new Handler(Looper.getMainLooper());

        final Runnable shutdown = () -> {
            if (!done.compareAndSet(false, true)) return;
            try {
                TextToSpeech engine = engineRef.get();
                if (engine != null) engine.shutdown();
            } catch (RuntimeException ignored) {
                // Engine already gone — nothing to release.
            }
            release(wakeLock);
        };

        try {
            TextToSpeech engine = new TextToSpeech(app, status -> {
                // Post to the main looper so engineRef.set() has certainly run
                // even for engines that call onInit from inside the ctor.
                main.post(() -> {
                    TextToSpeech tts = engineRef.get();
                    if (status != TextToSpeech.SUCCESS || tts == null) {
                        Log.w(TAG, "Reminder voice unavailable (tts init " + status + ")");
                        shutdown.run();
                        return;
                    }
                    try {
                        tts.setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build());
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String utteranceId) {
                                Log.i(TAG, "Reminder voice speaking");
                            }

                            @Override public void onDone(String utteranceId) {
                                shutdown.run();
                            }

                            @Override public void onError(String utteranceId) {
                                Log.w(TAG, "Reminder voice playback error");
                                shutdown.run();
                            }
                        });
                        String spoken = text.length() > MAX_SPOKEN_CHARS
                                ? text.substring(0, MAX_SPOKEN_CHARS)
                                : text;
                        int queued = tts.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID);
                        if (queued != TextToSpeech.SUCCESS) {
                            Log.w(TAG, "Reminder voice enqueue failed (" + queued + ")");
                            shutdown.run();
                        }
                    } catch (RuntimeException error) {
                        Log.e(TAG, "Reminder voice speak failed", error);
                        shutdown.run();
                    }
                });
            });
            engineRef.set(engine);
            main.postDelayed(shutdown, FORCED_SHUTDOWN_MS);
        } catch (RuntimeException error) {
            Log.e(TAG, "Reminder voice init failed", error);
            shutdown.run();
        }
    }

    private static PowerManager.WakeLock acquireWakeLock(Context app) {
        try {
            PowerManager manager = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            if (manager == null) return null;
            PowerManager.WakeLock lock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "daymark:reminder-voice");
            lock.setReferenceCounted(false);
            lock.acquire(WAKE_LOCK_TIMEOUT_MS);
            return lock;
        } catch (RuntimeException error) {
            Log.w(TAG, "Reminder voice wake lock unavailable", error);
            return null;
        }
    }

    private static void release(PowerManager.WakeLock lock) {
        try {
            if (lock != null && lock.isHeld()) lock.release();
        } catch (RuntimeException ignored) {
            // Already released by timeout.
        }
    }
}
