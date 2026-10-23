package com.michaelunkai.daymark;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.SystemClock;
import android.os.Looper;
import android.database.Cursor;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.LruCache;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.HorizontalScrollView;
import android.widget.ScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native multi-session control panel for the AIControlPanel workspace.
 * Shows every workspace task as a live session card (latest agent update first),
 * long-polls the Daymark sync API for seconds-level freshness, and covers the
 * full task lifecycle: create, log update, edit, move, complete, reopen.
 */
public final class AiWorkspaceActivity extends Activity {

    // ---- vanta-black control-room palette ----
    private static final int COLOR_BACKGROUND = 0xFF050507;
    private static final int COLOR_CARD = 0xFF0B0D10;
    private static final int COLOR_SURFACE = 0xFF11141A;
    /** Hairline stroke: rgba(255,255,255,0.07). */
    private static final int COLOR_STROKE = 0x12FFFFFF;
    private static final int COLOR_TEXT = 0xFFE8ECEF;
    private static final int COLOR_TEXT_DIM = 0xFF98A2AD;
    private static final int COLOR_ACCENT = 0xFF2DE2C5;
    private static final int COLOR_ACCENT_DIM = 0x1F2DE2C5;
    private static final int COLOR_GREEN = 0xFF4ADE80;
    private static final int COLOR_GREEN_DIM = 0x1F4ADE80;
    private static final int COLOR_AMBER = 0xFFFBBF24;
    private static final int COLOR_AMBER_DIM = 0x1FFBBF24;
    private static final int COLOR_RED = 0xFFF87171;
    private static final int COLOR_RED_DIM = 0x1FF87171;
    private static final int COLOR_GRAY = COLOR_TEXT_DIM;
    private static final int COLOR_GRAY_DIM = 0x1F98A2AD;
    /** Legacy call-site names kept: live/primary is now the single teal accent. */
    private static final int COLOR_BLUE = COLOR_ACCENT;
    private static final int COLOR_BLUE_DIM = COLOR_ACCENT_DIM;
    private static final int COLOR_CARD_STROKE = COLOR_STROKE;
    /** Purple marker tint ("- ack" journal lines). */
    private static final int COLOR_PURPLE = 0xFFC4A2FF;
    private static final int COLOR_PURPLE_DIM = 0x1FC4A2FF;
    /** Deep end of the primary-action gradient (accent fades toward it). */
    private static final int COLOR_ACCENT_DEEP = 0xFF14B8A6;
    private static final int SPACE_XS = 4;
    private static final int SPACE_S = 8;
    private static final int SPACE_M = 12;
    private static final int SPACE_L = 16;
    private static final int SPACE_XL = 24;
    private static final float TYPE_DISPLAY = 20f;
    private static final float TYPE_TITLE = 16f;
    private static final float TYPE_BODY = 14f;
    private static final float TYPE_CAPTION = 12f;
    private static final float TYPE_MICRO = 11f;
    private static final float RADIUS_CARD = 16f;
    private static final float RADIUS_INNER = 12f;
    private static final float RADIUS_FLOAT = 20f;
    private static final float RADIUS_PILL = 999f;
    private static final int TOUCH_MIN_DP = 48;
    private static final int ELEVATION_CARD_DP = 3;

    private static final long OFFLINE_RETRY_MS = 5_000L;
    private static final long UI_TICK_MS = 15_000L;
    private static final long ACTIVE_WINDOW_MS = 60L * 60_000L;

    // ===== Never-Stop Session Watchdog (all models, all providers) =====
    // Bounded response deadline: 300s (configurable 60-7200s), submission deadline 30s
    // Poll session messages every 1s (not 200ms to avoid listener leaks)
    // On deadline/cancel, session is aborted cleanly and restarted with same provider/model
    // unless manually stopped. Only manual complete stops a session.
    private static final long WATCHDOG_RESPONSE_DEADLINE_MS = 300_000L; // 5 min
    private static final long WATCHDOG_SUBMISSION_DEADLINE_MS = 30_000L; // 30s
    private static final long WATCHDOG_POLL_INTERVAL_MS = 5_000L; // 5s (monitor only, progressTick is 60s)
    private static final int WATCHDOG_MAX_RETRIES = 4; // session creation retries
    private static final long WATCHDOG_RETRY_BASE_MS = 250L; // exponential backoff base
    private static final int WATCHDOG_READBACK_ATTEMPTS = 4;
    private static final long WATCHDOG_READBACK_DELAY_MS = 50L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newFixedThreadPool(2);
    // Dedicated thread for the long-poll sync loop: a hung connection (VPN/Wi-Fi
    // hiccup) must NEVER occupy a shared networkExecutor thread — that starved
    // user actions and made the whole app look frozen + offline (observed live).
    private Thread syncThread;
    // ---- Attachments: bulk multi-pick queue (image/*, pdf, text/*, office).
    // Per-file status waiting/uploading/done/failed with retry; after a batch
    // finishes ONE journal line lists every attachment id so a running session
    // fetches them all. 5 MB per-file cap is unchanged. ----
    private static final int ATTACH_WAITING = 0;
    private static final int ATTACH_UPLOADING = 1;
    private static final int ATTACH_DONE = 2;
    private static final int ATTACH_FAILED = 3;

    private static final class AttachJob {
        final Uri uri;
        final String name;
        final String mime;
        String taskId;
        int status = ATTACH_WAITING;
        String attachmentId;
        String error;
        AttachJob(Uri uri, String name, String mime) {
            this.uri = uri; this.name = name; this.mime = mime;
        }
    }

    /** Mime types offered to the system picker for bulk attach. */
    private static final String[] ATTACH_MIME_TYPES = {
        "image/*", "application/pdf", "text/*",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/rtf"
    };

    private final java.util.List<AttachJob> pendingAttaches = new java.util.ArrayList<>();
    private TextView pendingAttachButton;
    private LinearLayout attachQueueView;
    private static final int REQUEST_PICK_ATTACHMENT = 4101;
    private static final int REQUEST_PICK_TASK_IMAGES = 4102;
    private DaymarkWorkspaceClient.TaskInfo pendingImageTask;

    private View attachButton(LinearLayout form) {
        pendingAttachButton = (TextView) pillButton("Attach files", COLOR_TEXT, COLOR_SURFACE);
        pendingAttachButton.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            // EXTRA_MIME_TYPES requires API 24; minSdk is 23. EXTRA_ALLOW_MULTIPLE works across all versions.
            try {
                startActivityForResult(Intent.createChooser(intent,
                        "Pick files (multi-select supported)"), REQUEST_PICK_ATTACHMENT);
            } catch (Exception error) {
                Toast.makeText(this, "No file picker available.", Toast.LENGTH_SHORT).show();
            }
        });
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(8);
        form.addView(pendingAttachButton, buttonParams);
        // Compact inline queue under the button: one status row per picked file.
        attachQueueView = new LinearLayout(this);
        attachQueueView.setOrientation(LinearLayout.VERTICAL);
        attachQueueView.setVisibility(View.GONE);
        LinearLayout.LayoutParams queueParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        queueParams.topMargin = dp(4);
        form.addView(attachQueueView, queueParams);
        renderAttachQueue();
        return pendingAttachButton;
    }

    /** Per-task action: pick any number of images, upload straight to the task. */
    private void pickImagesForTask(final DaymarkWorkspaceClient.TaskInfo task) {
        pendingImageTask = task;
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(Intent.createChooser(intent, "Pick images (as many as you want)"),
                    REQUEST_PICK_TASK_IMAGES);
        } catch (Exception error) {
            Toast.makeText(this, "No image picker available.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;
        java.util.List<AttachJob> picked = new java.util.ArrayList<>();
        if (data.getClipData() != null) {
            android.content.ClipData clip = data.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) picked.add(new AttachJob(uri,
                        queryAttachName(uri), getContentResolver().getType(uri)));
            }
        } else if (data.getData() != null) {
            Uri uri = data.getData();
            picked.add(new AttachJob(uri, queryAttachName(uri), getContentResolver().getType(uri)));
        }
        if (picked.isEmpty()) return;
        if (requestCode == REQUEST_PICK_ATTACHMENT) {
            pendingAttaches.addAll(picked);
            updateAttachButtonText();
            renderAttachQueue();
            Toast.makeText(this, picked.size() + " file(s) queued ("
                    + pendingAttaches.size() + " total).", Toast.LENGTH_SHORT).show();
        } else if (requestCode == REQUEST_PICK_TASK_IMAGES) {
            DaymarkWorkspaceClient.TaskInfo task = pendingImageTask;
            pendingImageTask = null;
            if (task != null) uploadAttachesToTask(task.id, picked);
        }
    }

    private String queryAttachName(Uri uri) {
        String name = "attachment";
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int col = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (col >= 0) name = cursor.getString(col);
            }
        } catch (Exception ignored) {
        }
        return name == null ? "attachment" : name;
    }

    private byte[] readAttachBytes(Uri uri) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Cannot open the picked file.");
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /** Reads the picked file; images over the 5 MB server cap are downscaled
     *  (JPEG, halving samples) until they fit, so any camera photo uploads. */
    private byte[] preparedUploadBytes(AttachJob attach) throws IOException {
        byte[] bytes = readAttachBytes(attach.uri);
        String mime = attach.mime == null ? "" : attach.mime;
        while (bytes.length > 4 * 1024 * 1024 && mime.startsWith("image/")) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0) break;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 2;
            Bitmap scaled = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (scaled == null) break;
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 88, out);
            scaled.recycle();
            bytes = out.toByteArray();
            mime = "image/jpeg";
        }
        if (bytes.length > 5 * 1024 * 1024) {
            throw new IOException("file too large (max 5 MB)");
        }
        return bytes;
    }

    /** Compact per-file queue: name + waiting / uploading / done / failed;
     *  failed rows are tappable to retry. Safe to call any time. */
    private void renderAttachQueue() {
        LinearLayout queue = attachQueueView;
        if (queue == null) return;
        queue.removeAllViews();
        if (pendingAttaches.isEmpty() || queue.getParent() == null) {
            queue.setVisibility(View.GONE);
            return;
        }
        queue.setVisibility(View.VISIBLE);
        for (int i = 0; i < pendingAttaches.size(); i++) {
            final AttachJob job = pendingAttaches.get(i);
            String state;
            switch (job.status) {
                case ATTACH_UPLOADING: state = "uploading\u2026"; break;
                case ATTACH_DONE: state = "done"; break;
                case ATTACH_FAILED:
                    state = "failed" + (job.error == null ? "" : " \u00b7 " + job.error)
                            + " \u00b7 tap to retry";
                    break;
                default: state = "waiting";
            }
            TextView row = new TextView(this);
            row.setText(job.name + "  \u00b7  " + state);
            row.setTextSize(13.0f);
            row.setPadding(dp(8), dp(4), dp(8), dp(4));
            if (job.status == ATTACH_FAILED) {
                row.setTextColor(0xFFB45309);
                row.setOnClickListener(v -> retryAttachJob(job));
            } else if (job.status == ATTACH_DONE) {
                row.setTextColor(0xFF15803D);
            }
            queue.addView(row);
        }
    }

    /** Updates status on the worker thread and repaints the queue on the UI. */
    private void setJobStatus(final AttachJob job, final int status, final String error) {
        job.status = status;
        if (error != null) job.error = error;
        mainHandler.post(this::renderAttachQueue);
    }

    private void updateAttachButtonText() {
        if (pendingAttachButton == null) return;
        pendingAttachButton.setText(pendingAttaches.isEmpty()
                ? "Attach files"
                : "| " + pendingAttaches.size() + " file(s) queued");
    }

    /** Uploads one job synchronously (worker thread). Returns the
     *  "[attachment id=... name=...]" marker, or "" on failure. */
    private String uploadAttachJob(final AttachJob job, final String taskId) {
        setJobStatus(job, ATTACH_UPLOADING, null);
        try {
            byte[] bytes = preparedUploadBytes(job);
            String name = job.name == null || job.name.trim().isEmpty()
                    ? "attachment" : job.name;
            String mime = job.mime == null || job.mime.isEmpty()
                    ? "application/octet-stream" : job.mime;
            String id = DaymarkWorkspaceClient.uploadAttachment(syncKey, taskId, name, mime, bytes);
            if (id == null || id.isEmpty()) {
                throw new IOException("server returned no attachment id");
            }
            job.attachmentId = id;
            job.error = null;
            setJobStatus(job, ATTACH_DONE, null);
            return " [attachment id=" + id + " name=" + name + "]";
        } catch (Exception error) {
            setJobStatus(job, ATTACH_FAILED,
                    error.getMessage() == null ? "upload failed" : error.getMessage());
            return "";
        }
    }

    /**
     * Uploads every queued job for taskId (worker thread), then prepends ONE
     * journal line listing every attachment id, e.g.
     * "\u2014 update 14:32 \u2014 attachments: [attachment id=att1 name=a.pdf] [...]".
     * Done jobs leave the queue; failed ones stay for per-file retry.
     * Returns the marker string ("" when nothing uploaded or the journal line
     * landed) so the caller can fall back to in-text markers on journal failure.
     */
    private String uploadQueueAndJournal(final String taskId) {
        StringBuilder markers = new StringBuilder();
        for (int i = 0; i < pendingAttaches.size(); i++) {
            AttachJob job = pendingAttaches.get(i);
            if (job.status == ATTACH_DONE) continue;
            job.taskId = taskId;
            markers.append(uploadAttachJob(job, taskId));
        }
        if (markers.length() > 0) {
            try {
                DaymarkWorkspaceClient.prependJournalLine(syncKey, taskId,
                        "\u2014 update " + DaymarkWorkspaceClient.nowHHMM()
                                + " \u2014 attachments:" + markers);
                mainHandler.post(() -> {
                    for (java.util.Iterator<AttachJob> it = pendingAttaches.iterator(); it.hasNext();) {
                        AttachJob job = it.next();
                        if (job.status == ATTACH_DONE) it.remove();
                    }
                    updateAttachButtonText();
                    renderAttachQueue();
                });
                return "";
            } catch (Exception error) {
                Log.w("DaymarkAi", "attachment journal line failed: " + error.getMessage());
                return markers.toString();
            }
        }
        return "";
    }

    /** Per-file retry: re-uploads a failed job and journals its id alone. */
    private void retryAttachJob(final AttachJob job) {
        if (job.status == ATTACH_UPLOADING) return;
        final String taskId = job.taskId;
        if (taskId == null) {
            setJobStatus(job, ATTACH_WAITING, null);
            return;
        }
        networkExecutor.execute(() -> {
            String marker = uploadAttachJob(job, taskId);
            if (!marker.isEmpty()) {
                try {
                    DaymarkWorkspaceClient.prependJournalLine(syncKey, taskId,
                            "\u2014 update " + DaymarkWorkspaceClient.nowHHMM()
                                    + " \u2014 attachments:" + marker);
                } catch (Exception error) {
                    Log.w("DaymarkAi", "retry journal failed: " + error.getMessage());
                }
            }
            if (job.status == ATTACH_DONE) {
                mainHandler.post(() -> {
                    pendingAttaches.remove(job);
                    updateAttachButtonText();
                    renderAttachQueue();
                });
            }
        });
    }

    /**
     * Uploads every queued attachment (bulk queue), prepends one journal line
     * listing every attachment id so the running session fetches them all, then
     * hands the prompt text to {@code send}. Failed files stay queued with a
     * visible retry; only a real server response with an id marks a file done.
     */
    private void sendWithAttachment(final String taskId, final String text,
            final java.util.function.Consumer<String> send) {
        if (pendingAttaches.isEmpty()) { send.accept(text); return; }
        Toast.makeText(this, "Uploading " + pendingAttaches.size() + " file(s)\u2026",
                Toast.LENGTH_SHORT).show();
        networkExecutor.execute(() -> {
            String fallback = uploadQueueAndJournal(taskId);
            final String finalText = fallback.isEmpty() ? text : text + fallback;
            mainHandler.post(() -> {
                updateAttachButtonText();
                send.accept(finalText);
            });
        });
    }

    /** Direct task upload for the per-task "Image" action (no text involved). */
    private void uploadAttachesToTask(final String taskId,
            final java.util.List<AttachJob> attaches) {
        Toast.makeText(this, "Uploading " + attaches.size() + " image(s)\u2026",
                Toast.LENGTH_SHORT).show();
        networkExecutor.execute(() -> {
            int ok = 0;
            for (AttachJob attach : attaches) {
                if (!uploadAttachJob(attach, taskId).isEmpty()) ok++;
            }
            final int uploaded = ok;
            mainHandler.post(() -> {
                Toast.makeText(this, uploaded + "/" + attaches.size()
                        + " image(s) added to the task.", Toast.LENGTH_LONG).show();
                refreshNow();
            });
        });
    }
    // ---- AUTO runner heartbeat: fires every 5s so a finished task advances
    // within seconds even when no refresh lands (user demand: instant chain) ----
    private final Runnable autoTick = new Runnable() {
        @Override public void run() {
            try { if (autoRunEnabled) maybeAutoAssign(); } catch (Exception ignored) { }
            mainHandler.postDelayed(this, 5_000L);
        }
    };

    private GridView grid;
    private FlowLayout chipsBar;
    private TextView titleView;
    private TextView statusView;
    private TextView refreshView;
    private TextView emptyView;
    private TextView emptyIcon;
    private LinearLayout emptyWrap;
    private LinearLayout emptyActions;
    private TextView refreshButton;
    private SessionAdapter adapter;
    private final List<DaymarkWorkspaceClient.TaskInfo> visibleTasks = new ArrayList<>();

    private volatile String syncKey;
    private volatile boolean running;
    private volatile boolean destroyed;
    private volatile long publishedRevision = -1L;
    private volatile long lastRefreshAt;
    private volatile boolean inFlight;
    private volatile JSONObject lastState;
    private DaymarkWorkspaceClient.WorkspaceSnapshot snapshot;
    private final Set<String> expandedTaskIds = new HashSet<>();
    private String selectedChip;
    // PAUSED LAW: on the pause transition the view auto-switches to the Paused
    // tab; when the last pause clears it returns to the exact tab shown before.
    private boolean lastHadPaused;
    private String chipBeforePause;
    private final List<String> progressSectionIds = new ArrayList<>();
    private final Object stateLock = new Object();
    private final List<PendingOp> pendingOps = new ArrayList<>();
    private final Map<String, JSONObject> optimisticTasks = new LinkedHashMap<>();
    private final Map<String, JSONObject> deletedBackup = new LinkedHashMap<>();
    private final Set<String> savingIds = new HashSet<>();
    /** Downloaded image thumbnails keyed by attachment id. */
    private final LruCache<String, Bitmap> thumbnailCache = new LruCache<>(24);
    private final Set<String> thumbnailInFlight = new HashSet<>();
    private boolean draining;
    private LinearLayout undoBar;
    private TextView undoMessage;
    private String undoTaskId;
    private final List<String> todoSectionIds = new ArrayList<>();
    private final List<String> finishedSectionIds = new ArrayList<>();
    private String chipSignature = "";
    /** Newest-line pause marker, e.g. "\u2014 PAUSED 14:32 \u2014" (session is paused). */
    private static final java.util.regex.Pattern PAUSED_MARKER =
            java.util.regex.Pattern.compile("\u2014\\s*PAUSED\\s+(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*\u2014");
    /** Stamp extractor for built order lines: "14:32" out of "\u2014 ORDER 14:32 \u2014 \u2026". */
    private static final java.util.regex.Pattern ORDER_STAMP =
            java.util.regex.Pattern.compile("\u2014 ORDER\\s+([01]?\\d|2[0-3]):[0-5]\\d\\s*\u2014");
    /** Any journal marker line, e.g. "\u2014 update 14:32 \u2014 \u2026" (newest-first order). */
    private static final java.util.regex.Pattern JOURNAL_MARKER_LINE =
            java.util.regex.Pattern.compile("^\\s*[-\u2014\u2013]{1,2}\\s*\\w+\\s+([01]?\\d|2[0-3]):[0-5]\\d\\s*[-\u2014\u2013]");
    /** One HH:MM wall-clock stamp anywhere in a journal line. */
    private static final java.util.regex.Pattern TIME_STAMP =
            java.util.regex.Pattern.compile("(?:[01]?\\d|2[0-3]):[0-5]\\d");
    private LinearLayout finishedHeader;
    private TextView finishedLabel;
    private TextView deleteAllButton;
    private boolean deleteAllBusy;
    private LinearLayout progressHeader;
    private TextView progressLabel;
    private TextView pauseAllButton;
    private TextView resumeAllButton;
    private boolean pauseAllBusy;
    /** Move-all (demand 4.1): bulk-moves every visible card to a picked section. */
    private TextView moveAllButton;
    private boolean moveAllBusy;
    private LinearLayout toDoHeader;
    private TextView toDoLabel;
    private TextView autoRunButton;
    /** AUTO runner: keeps up to autoSessions To do tasks assigned at all times;
     * the millisecond one finishes, the next To do task starts. */
    private boolean autoRunEnabled;
    /** taskId -> epoch ms it was auto-assigned (one entry per running session). */
    private final Map<String, Long> autoAssignedIds = new LinkedHashMap<>();
    private boolean autoAssignInFlight;
    private static final String AUTO_PREF = "auto_run";
    // ---- Parallel sessions: how many AUTO sessions run at the same time
    // (default 1 = the original strict one-after-the-other behavior). ----
    private TextView autoSessionsButton;
    private int autoSessions = 1;
    private static final String AUTO_SESSIONS_PREF = "auto_sessions";
    // ---- Per-task AUTO exclusion: excluded To do tasks are never picked by
    // the AUTO runner (manual Assign still works). ----
    private Set<String> autoExcluded = new HashSet<>();
    private static final String AUTO_EXCLUDED_PREF = "auto_excluded";
    // ---- Auto interval override (mirrors the PC board): when > 0, AUTO
    // force-starts the next To do task every N minutes even while the previous
    // session still runs; 0 = default strict sequential. The AUTO pill shows
    // yellow while the override is active. ----
    private TextView autoIntervalButton;
    private int autoIntervalMin;
    private static final String AUTO_INTERVAL_PREF = "auto_interval_min";
    private static final int COLOR_AUTO_YELLOW = 0xFFE0A92B;

    // ---- Model picker: chip in the header, choice published to a workspace
    // "model" card so PC sessions pick it up. ----
    private TextView modelChip;
    private TextView opencodeWarningBanner;
    private static final String MODEL_PREF = "workspace_model";
    private static final String MODEL_CARD_TITLE = "model";
    private static final String DEFAULT_MODEL = "GLM-5.3-Flash";
    private static final String[] MODEL_CHOICES = {
            "GLM-5.3-Flash",
            "glm-5.3-flash-free",
            "qwen3-coder-free",
            "kimi-k2-free",
            "deepseek-v3.2-free",
            "minimax-m2-free"
    };
    /** Top usage strip ("⚡ 5h: 72% left · 7d: 43% left"); hidden until usage exists. */
    private LinearLayout usageStrip;
    /** While set (epoch ms), newly built cards play the batch enter animation. */
    private volatile long cardAnimWindow;
    private JSONObject lastUsage;
    private static final long USAGE_STALE_MS = 30L * 60_000L;
    /** taskId -> sent user message awaiting the agent's reply (90s auto-nudge). */
    private final Map<String, PendingMessage> pendingMessages = new LinkedHashMap<>();
    private static final long NUDGE_AFTER_MS = 90_000L;
    private static final int MAX_NUDGES = 2;

    // ---- Provider management ----
    private static final String PROVIDER_PREF = "workspace_provider";
    private static final String DEFAULT_PROVIDER = "zai-headless";
    private static final String TASK_MODEL_PREF_PREFIX = "task_model_";
    private static final String[] PROVIDER_CHOICES = {
            "zai-headless", "zai-metered-api", "nvidia-nim", "github-models", "mistral-ai", "siliconflow", "sambanova", "cerebras", "openrouter", "groq", "xai", "opencode"
    };
    private static final Map<String, String> PROVIDER_LABELS = new LinkedHashMap<String, String>() {{
        put("zai-headless", "Z.ai Coding Plan (subscription)");
        put("zai-metered-api", "Z.ai Metered API (PAYG)");
        put("nvidia-nim", "NVIDIA NIM");
        put("github-models", "GitHub Models (free)");
        put("mistral-ai", "Mistral AI (free)");
        put("siliconflow", "SiliconFlow (free)");
        put("sambanova", "SambaNova Cloud (free)");
        put("cerebras", "Cerebras (free)");
        put("openrouter", "OpenRouter");
        put("groq", "Groq (free)");
        put("xai", "xAI");
        put("opencode", "OpenCode");
    }};
    private static final Map<String, String> PROVIDER_MODEL_PREFIX = new LinkedHashMap<String, String>() {{
        put("zai-headless", "zai-headless/");
        put("zai-metered-api", "zai-metered-api/");
        put("nvidia-nim", "nvidia-nim/");
        put("github-models", "github-models/");
        put("mistral-ai", "mistral-ai/");
        put("siliconflow", "siliconflow/");
        put("sambanova", "sambanova/");
        put("cerebras", "cerebras/");
        put("openrouter", "openrouter/");
        put("groq", "groq/");
        put("xai", "xai/");
        put("opencode", "opencode/");
    }};
    private TextView providerChip;
    private static final String PROVIDER_CARD_TITLE = "provider";
    private final Map<String, Long> providerLimitReached = new LinkedHashMap<>();
    private final Map<String, Long> providerLimitResetAt = new LinkedHashMap<>();
    private final Runnable providerLimitTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            checkProviderLimits();
            mainHandler.postDelayed(this, 30_000L);
        }
    };

    /** Checks all configured providers for rate limits and manages auto-failover. */
    private void checkProviderLimits() {
        if (destroyed || syncKey == null) return;
        long now = System.currentTimeMillis();
        // Clean up expired limits
        List<String> toRemove = new ArrayList<>();
        for (Map.Entry<String, Long> entry : providerLimitReached.entrySet()) {
            Long resetAt = providerLimitResetAt.get(entry.getKey());
            if (resetAt != null && now >= resetAt) {
                toRemove.add(entry.getKey());
            }
        }
        for (String key : toRemove) {
            providerLimitReached.remove(key);
            providerLimitResetAt.remove(key);
        }
        // Log current limit status
        if (!providerLimitReached.isEmpty()) {
            Log.i("DaymarkAi", "Provider limits active: " + providerLimitReached.keySet());
        }
    }

    // ===== Keystore encryption for API keys (AES-256-GCM, AndroidKeyStore) =====
    // Keys are NEVER stored in SharedPreferences or plaintext.
    private static final String KEYSTORE_ALIAS = "daymark_api_keys_v1";
    private static final String KEYSTORE_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_LENGTH = 12;

    /** Generates or retrieves the encryption key from Android Keystore. */
    private SecretKey getOrCreateKeystoreKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(false)
                    .build());
            generator.generateKey();
        }
        return (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
    }

    /** Encrypts an API key string with AES-256-GCM. Returns Base64-encoded: [12-byte IV][ciphertext]. */
    public String encryptApiKey(String plaintext) throws Exception {
        SecretKey key = getOrCreateKeystoreKey();
        Cipher cipher = Cipher.getInstance(KEYSTORE_TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] result = new byte[GCM_IV_LENGTH + ciphertext.length];
        System.arraycopy(iv, 0, result, 0, GCM_IV_LENGTH);
        System.arraycopy(ciphertext, 0, result, GCM_IV_LENGTH, ciphertext.length);
        return android.util.Base64.encodeToString(result, android.util.Base64.NO_WRAP);
    }

    /** Decrypts a Base64-encoded ciphertext back to the API key plaintext. */
    public String decryptApiKey(String base64Ciphertext) throws Exception {
        SecretKey key = getOrCreateKeystoreKey();
        Cipher cipher = Cipher.getInstance(KEYSTORE_TRANSFORMATION);
        byte[] data = android.util.Base64.decode(base64Ciphertext, android.util.Base64.DEFAULT);
        byte[] iv = new byte[GCM_IV_LENGTH];
        byte[] ciphertext = new byte[data.length - GCM_IV_LENGTH];
        System.arraycopy(data, 0, iv, 0, GCM_IV_LENGTH);
        System.arraycopy(data, GCM_IV_LENGTH, ciphertext, 0, ciphertext.length);
        GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_BITS, iv);
        cipher.init(Cipher.DECRYPT_MODE, key, spec);
        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, StandardCharsets.UTF_8);
    }

    /** Returns true when a keystore key exists (used to detect first-run setup). */
    public boolean hasKeystoreKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            return keyStore.containsAlias(KEYSTORE_ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    /** One sent "— message" awaiting an agent reply, with auto-nudge bookkeeping. */
    private static final class PendingMessage {
        final long sentAt;
        int nudges;

        PendingMessage(long sentAt) {
            this.sentAt = sentAt;
        }
    }

    private final Runnable pendingTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            checkPendingMessages();
            mainHandler.postDelayed(this, 5_000L);
        }
    };

    /** Progress broadcaster: emits a relevant, human-readable progress update
     *  for every in-progress task at least once per 60 seconds. */
    // Task ids the broadcaster has observed as In Progress (drives first-update-
    // at-start and the closing "finished" line when a task leaves In Progress).
    private final java.util.HashSet<String> broadcastSeenInProgress = new java.util.HashSet<>();
    // Last progress message sent per task id — never repeat two identical lines.
    private final java.util.Map<String, String> lastBroadcastMessageByTask = new java.util.HashMap<>();
    // Description length at the last broadcast, per task id (detects journal growth).
    private final java.util.Map<String, Integer> lastBroadcastDescLen = new java.util.HashMap<>();

    /** Progress broadcaster: emits a relevant, human-readable progress update
     *  for every in-progress task at least once per 60 seconds. */
    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            Log.i("DaymarkAi", "progressTick fired, syncKey=" + syncKey + ", snapshot=" + (snapshot != null) + ", lastState=" + (lastState != null));
            if (destroyed || syncKey == null) {
                mainHandler.postDelayed(this, 60_000L);
                return;
            }
            // If we have no data yet, force a refresh first so we have tasks to broadcast.
            if (snapshot == null && lastState == null) {
                Log.i("DaymarkAi", "progressTick: no data yet, forcing refresh");
                refreshNow();
                mainHandler.postDelayed(this, 10_000L); // retry soon after refresh
                return;
            }
            networkExecutor.execute(() -> {
                try {
                    int count = 0;
                    // Use snapshot if available, otherwise fall back to lastState
                    List<DaymarkWorkspaceClient.TaskInfo> tasksToCheck = new ArrayList<>();
                    if (snapshot != null) {
                        tasksToCheck.addAll(snapshot.tasks);
                    } else if (lastState != null) {
                        JSONObject tasksObj = lastState.optJSONObject("tasks");
                        if (tasksObj != null) {
                            java.util.Iterator<String> keys = tasksObj.keys();
                            while (keys.hasNext()) {
                                JSONObject taskJson = tasksObj.optJSONObject(keys.next());
                                if (taskJson != null) {
                                    try {
                                        tasksToCheck.add(new DaymarkWorkspaceClient.TaskInfo(taskJson));
                                    } catch (Exception ignored) {}
                                }
                            }
                        }
                    }
                    for (DaymarkWorkspaceClient.TaskInfo task : tasksToCheck) {
                        // Check if task is in an "In Progress" section (not completed, in progress section, not paused)
                        if (!task.completed && progressSectionIds.contains(task.sectionId) && !isTaskPaused(task)) {
                            count++;
                            sendProgressLine(task, buildProgressMessage(task));
                        }
                    }
                    Log.i("DaymarkAi", "progressTick processed " + count + " in-progress tasks");
                    // Update OpenCode warning banner
                    updateOpenCodeWarning();
                    // After writing progress, refresh UI so cards show newest journal line immediately.
                    if (count > 0) {
                        mainHandler.post(() -> {
                            if (adapter != null) adapter.notifyDataSetChanged();
                        });
                    }
                } catch (Exception e) {
                    Log.w("DaymarkAi", "progress broadcast failed: " + e.getMessage());
                }
            });
            mainHandler.postDelayed(this, 60_000L);
        }
    };

    /** Sends one progress journal line for a task with bounded retries, then
     *  records it so consecutive lines for the same task are never identical. */
    private void sendProgressLine(final DaymarkWorkspaceClient.TaskInfo task, String progressMsg) {
        if (progressMsg == null) return;
        // Never repeat the previous line for the same task verbatim.
        String last = lastBroadcastMessageByTask.get(task.id);
        if (progressMsg.equals(last)) {
            progressMsg = buildProgressMessage(task, 1); // next template variant
            if (progressMsg.equals(last)) progressMsg = progressMsg + " (still on it)";
        }
        boolean sent = false;
        for (int attempt = 0; attempt < 3 && !sent; attempt++) {
            try {
                Log.i("DaymarkAi", "progress broadcast for " + task.id + ": " + progressMsg);
                DaymarkWorkspaceClient.prependProgressLine(syncKey, task.id, progressMsg);
                sent = true;
            } catch (Exception e) {
                Log.w("DaymarkAi", "progress broadcast attempt " + (attempt + 1) + " failed for " + task.id + ": " + e.getMessage());
                if (attempt < 2) {
                    try { Thread.sleep(2000L * (attempt + 1)); } catch (InterruptedException ie) {}
                }
            }
        }
        if (sent) {
            lastBroadcastMessageByTask.put(task.id, progressMsg);
            lastBroadcastDescLen.put(task.id,
                    task.description == null ? 0 : task.description.length());
        } else {
            Log.e("DaymarkAi", "progress broadcast FAILED after 3 attempts for " + task.id);
        }
    }

    /** Snapshot transition hook (called on the main thread after every publish):
     *  first-update-at-start for newly seen In Progress tasks, and one closing
     *  "finished" line for tasks that leave In Progress. */
    private void onBroadcastTransitions(final java.util.List<DaymarkWorkspaceClient.TaskInfo> tasks) {
        if (destroyed || syncKey == null) return;
        final java.util.Map<String, DaymarkWorkspaceClient.TaskInfo> byId = new java.util.HashMap<>();
        final java.util.HashSet<String> nowInProgress = new java.util.HashSet<>();
        for (DaymarkWorkspaceClient.TaskInfo t : tasks) {
            byId.put(t.id, t);
            if (!t.completed && progressSectionIds.contains(t.sectionId) && !isTaskPaused(t)) {
                nowInProgress.add(t.id);
            }
        }
        // (1) FIRST UPDATE AT START — enqueue one immediate progress write for
        // each task we see enter In Progress, instead of waiting for the 60s tick.
        for (final String id : nowInProgress) {
            if (broadcastSeenInProgress.add(id)) {
                final DaymarkWorkspaceClient.TaskInfo t = byId.get(id);
                if (t == null) continue;
                networkExecutor.execute(() -> sendProgressLine(t, buildProgressMessage(t)));
            }
        }
        // (2) CLOSING UPDATE — a task we have been broadcasting left In Progress
        // (completed or moved out): write one final "finished" line naming the model.
        final java.util.List<String> departed = new ArrayList<>();
        for (final String id : broadcastSeenInProgress) {
            if (nowInProgress.contains(id)) continue;
            departed.add(id);
            final DaymarkWorkspaceClient.TaskInfo t = byId.get(id);
            if (t == null) continue; // deleted — nothing to close out
            String modelTmp = taskModelPref(id);
            if (modelTmp == null || modelTmp.isEmpty()) modelTmp = currentModelPref();
            final String model = modelTmp;
            networkExecutor.execute(() -> {
                try {
                    String line = "finished \u2014 session completed on " + model
                            + " (" + currentProviderPref() + ")";
                    Log.i("DaymarkAi", "progress closing line for " + id + ": " + line);
                    DaymarkWorkspaceClient.prependProgressLine(syncKey, id, line);
                } catch (Exception e) {
                    Log.w("DaymarkAi", "closing progress line failed for " + id + ": " + e.getMessage());
                }
            });
        }
        for (String id : departed) {
            broadcastSeenInProgress.remove(id);
            lastBroadcastMessageByTask.remove(id);
            lastBroadcastDescLen.remove(id);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        syncKey = DaymarkWorkspaceClient.readSyncKey(this);
        autoRunEnabled = getSharedPreferences("daymark", MODE_PRIVATE)
                .getBoolean(AUTO_PREF, false);
        autoIntervalMin = getSharedPreferences("daymark", MODE_PRIVATE)
                .getInt(AUTO_INTERVAL_PREF, 0);
        autoSessions = Math.max(1, getSharedPreferences("daymark", MODE_PRIVATE)
                .getInt(AUTO_SESSIONS_PREF, 1));
        autoExcluded = new HashSet<>(getSharedPreferences("daymark", MODE_PRIVATE)
                .getStringSet(AUTO_EXCLUDED_PREF, new HashSet<>()));
        buildUi();
        adapter = new SessionAdapter();
        grid.setAdapter(adapter);
    }

    @Override
    protected void onResume() {
        super.onResume();
        running = true;
        syncKey = DaymarkWorkspaceClient.readSyncKey(this);
        mainHandler.post(uiTick);
        mainHandler.post(usageTick);
        mainHandler.post(pendingTick);
        mainHandler.post(progressTick);
        mainHandler.post(providerLimitTick);
        mainHandler.post(tokenRefreshTick);
        mainHandler.post(watchdogTick);
        startSyncLoop();
        refreshNow(); // instant reconnect paint — never wait out a dead long-poll
        // Agent token: without it every agent write 401s (the sync key is NOT a
        // valid agent Bearer) and actions bounce back after the optimistic flash.
        final String mintKey = syncKey;
        networkExecutor.execute(() -> {
            try {
                DaymarkWorkspaceClient.ensureAgentToken(mintKey,
                        getSharedPreferences("daymark", MODE_PRIVATE));
            } catch (Exception te) {
                Log.w("DaymarkAi", "agent token ensure: " + te.getMessage());
            }
        });
    }

    /** Proactive agent token refresh every 5 minutes to prevent 401 errors. */
    private final Runnable tokenRefreshTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed || syncKey == null) {
                mainHandler.postDelayed(this, 5 * 60_000L);
                return;
            }
            networkExecutor.execute(() -> {
                try {
                    DaymarkWorkspaceClient.ensureAgentToken(syncKey,
                            getSharedPreferences("daymark", MODE_PRIVATE));
                    Log.d("DaymarkAi", "Agent token refreshed proactively");
                } catch (Exception e) {
                    Log.w("DaymarkAi", "Proactive token refresh failed: " + e.getMessage());
                }
            });
            mainHandler.postDelayed(this, 5 * 60_000L);
        }
    };

    /** Never-Stop Session Watchdog: ensures every in-progress session runs to completion
     *  unless manually stopped. Monitors session health, restarts on network loss,
     *  fails over on provider errors, never times out. */
    private final Runnable watchdogTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed || syncKey == null || snapshot == null) {
                mainHandler.postDelayed(this, WATCHDOG_POLL_INTERVAL_MS);
                return;
            }
            networkExecutor.execute(() -> {
                try {
                    long now = System.currentTimeMillis();
                    for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                        // Only watch in-progress, non-paused tasks
                        if (!task.completed && progressSectionIds.contains(task.sectionId) && !isTaskPaused(task)) {
                            // Check if session has been stuck (no progress updates for > watchdog deadline)
                            long lastProgress = getLastProgressTime(task.description);
                            if (now - lastProgress > WATCHDOG_RESPONSE_DEADLINE_MS) {
                                Log.w("DaymarkAi", "Watchdog: session " + task.id + " appears stuck, checking health...");
                                // Force a refresh to see if session is actually alive
                                networkExecutor.execute(() -> refreshNow());
                            }
                            // Check if provider is rate-limited and should failover
                            String provider = currentProviderPref();
                            if (providerLimitReached.containsKey(provider)) {
                                String next = findNextAvailableProvider(provider);
                                if (next != null && !next.equals(provider)) {
                                    Log.i("DaymarkAi", "Watchdog: auto-failover from " + provider + " to " + next);
                                    saveProviderPref(next);
                                    mainHandler.post(() -> {
                                        if (providerChip != null) providerChip.setText(next);
                                        Toast.makeText(AiWorkspaceActivity.this,
                                                "Watchdog: switched to " + PROVIDER_LABELS.get(next),
                                                Toast.LENGTH_SHORT).show();
                                    });
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w("DaymarkAi", "Watchdog check failed: " + e.getMessage());
                }
            });
            mainHandler.postDelayed(this, WATCHDOG_POLL_INTERVAL_MS);
        }
    };

    /** Extract last progress timestamp from task description journal. */
    private long getLastProgressTime(String description) {
        if (description == null || description.isEmpty()) return 0;
        try {
            SessionUpdateParser.Result parsed = SessionUpdateParser.parse(description, System.currentTimeMillis());
            if (parsed.latest != null && parsed.latest.timeMillis > 0) {
                return parsed.latest.timeMillis;
            }
        } catch (Exception ignored) {}
        return 0;
    }

    /** (Re)starts the sync loop on its own thread, killing any stale loop first. */
    private void startSyncLoop() {
        final Thread old = syncThread;
        if (old != null) old.interrupt();
        final Thread t = new Thread(this::syncLoop, "daymark-sync");
        t.setDaemon(true);
        syncThread = t;
        t.start();
    }

    @Override
    protected void onPause() {
        super.onPause();
        running = false;
        final Thread st = syncThread;
        if (st != null) st.interrupt();
        mainHandler.removeCallbacks(uiTick);
        mainHandler.removeCallbacks(usageTick);
        mainHandler.removeCallbacks(pendingTick);
        mainHandler.removeCallbacks(progressTick);
        mainHandler.removeCallbacks(providerLimitTick);
        mainHandler.removeCallbacks(tokenRefreshTick);
        mainHandler.removeCallbacks(watchdogTick);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        destroyed = true;
        running = false;
        mainHandler.removeCallbacks(pendingTick);
        mainHandler.removeCallbacks(progressTick);
        mainHandler.removeCallbacks(tokenRefreshTick);
        mainHandler.removeCallbacks(watchdogTick);
        networkExecutor.shutdownNow();
    }

    // ---- UI construction ----

    @SuppressLint("SetTextI18n")
    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BACKGROUND);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        root.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        column.addView(buildHeader());

        // Usage strip: two instrument gauges (5h / 7d remaining) plus reset meta,
        // one compact non-wrapping line above the chips bar. Hidden until present.
        usageStrip = new LinearLayout(this);
        usageStrip.setOrientation(LinearLayout.HORIZONTAL);
        usageStrip.setGravity(Gravity.CENTER_VERTICAL);
        usageStrip.setPadding(dp(16), dp(4), dp(16), dp(4));
        usageStrip.setVisibility(View.GONE);
        column.addView(usageStrip);

        chipsBar = new FlowLayout(this);
        chipsBar.setPadding(dp(SPACE_L), dp(SPACE_XS), dp(SPACE_L), dp(SPACE_S));
        column.addView(chipsBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progressHeader = buildProgressHeader();
        progressHeader.setVisibility(View.GONE);
        column.addView(progressHeader);

        toDoHeader = buildToDoHeader();
        toDoHeader.setVisibility(View.GONE);
        column.addView(toDoHeader);

        finishedHeader = buildFinishedHeader();
        finishedHeader.setVisibility(View.GONE);
        column.addView(finishedHeader);

        grid = new GridView(this);
        grid.setNumColumns(1);
        grid.setVerticalSpacing(dp(16));
        grid.setPadding(dp(SPACE_L), dp(SPACE_XS), dp(SPACE_L), dp(96));
        grid.setClipToPadding(false);
        // Let card shadows (and the batch enter rise) draw past cell edges.
        grid.setClipChildren(false);
        grid.setScrollBarStyle(View.SCROLLBARS_OUTSIDE_OVERLAY);
        grid.setOnItemClickListener((parent, view, position, id) ->
                toggleExpanded(visibleTasks.get(position).id));
        column.addView(grid, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout emptyWrap = new LinearLayout(this);
        emptyWrap.setOrientation(LinearLayout.VERTICAL);
        emptyWrap.setGravity(Gravity.CENTER);
        emptyWrap.setVisibility(View.GONE);
        this.emptyWrap = emptyWrap;
        emptyIcon = new TextView(this);
        emptyIcon.setTextColor(withAlpha(COLOR_TEXT_DIM, 0x59));
        emptyIcon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        emptyIcon.setGravity(Gravity.CENTER);
        emptyIcon.setPadding(0, 0, 0, dp(6));
        emptyWrap.addView(emptyIcon);
        emptyView = new TextView(this);
        emptyView.setTextColor(COLOR_TEXT_DIM);
        emptyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        emptyView.setGravity(Gravity.CENTER);
        emptyView.setPadding(dp(32), 0, dp(32), dp(16));
        emptyActions = new LinearLayout(this);
        emptyActions.setOrientation(LinearLayout.HORIZONTAL);
        emptyActions.setGravity(Gravity.CENTER);
        emptyWrap.addView(emptyView);
        emptyWrap.addView(emptyActions);
        ((LinearLayout) column).addView(emptyWrap, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(buildFab());
        root.addView(buildUndoBar());
        setContentView(root);
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(SPACE_L), dp(SPACE_L), dp(SPACE_L), dp(8));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titleView = new TextView(this);
        titleView.setText("AI Workspace");
        titleView.setTextColor(COLOR_TEXT);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        titleView.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        statusView = new TextView(this);
        statusView.setTextColor(COLOR_TEXT_DIM);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        statusView.setPadding(0, dp(2), 0, 0);
        titles.addView(titleView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        titles.addView(statusView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(titles, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        refreshView = new TextView(this);
        refreshView.setTextColor(COLOR_TEXT_DIM);
        refreshView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        refreshView.setGravity(Gravity.END);
        row.addView(refreshView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        header.addView(row);

        LinearLayout pillRow = new LinearLayout(this);
        pillRow.setOrientation(LinearLayout.HORIZONTAL);
        pillRow.setGravity(Gravity.CENTER_VERTICAL);
        pillRow.setPadding(0, dp(6), 0, 0);

        modelChip = (TextView) pillButton(currentModelPref(), COLOR_TEXT, COLOR_SURFACE);
        styleQuietHeaderTextButton(modelChip);
        modelChip.setMaxLines(1);
        modelChip.setEllipsize(TextUtils.TruncateAt.END);
        modelChip.setOnClickListener(view -> showModelDialog());
        LinearLayout.LayoutParams modelParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.2f);
        pillRow.addView(modelChip, modelParams);

        providerChip = (TextView) pillButton(currentProviderPref(), COLOR_ACCENT, COLOR_ACCENT_DIM);
        styleQuietHeaderTextButton(providerChip);
        providerChip.setMaxLines(1);
        providerChip.setEllipsize(TextUtils.TruncateAt.END);
        providerChip.setOnClickListener(view -> showProviderDialog());
        LinearLayout.LayoutParams providerParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        pillRow.addView(providerChip, providerParams);

        TextView diaryButton = (TextView) pillButton("Diary", COLOR_TEXT, COLOR_SURFACE);
        styleQuietHeaderTextButton(diaryButton);
        diaryButton.setOnClickListener(view ->
                startActivity(DiaryActivity.intentFor(this, null)));
        LinearLayout.LayoutParams diaryParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.8f);
        diaryParams.leftMargin = dp(10);
        pillRow.addView(diaryButton, diaryParams);

        refreshButton = pillButton("Refresh", COLOR_TEXT, COLOR_SURFACE);
        styleQuietHeaderTextButton(refreshButton);
        refreshButton.setOnClickListener(view -> refreshNow());
        mainHandler.postDelayed(autoTick, 5_000L);
        LinearLayout.LayoutParams refreshParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.8f);
        refreshParams.leftMargin = dp(10);
        pillRow.addView(refreshButton, refreshParams);
        header.addView(pillRow);

        // OpenCode model truth warning banner (shown when configured model not in live list)
        opencodeWarningBanner = new TextView(this);
        opencodeWarningBanner.setTextColor(COLOR_RED);
        opencodeWarningBanner.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        opencodeWarningBanner.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        opencodeWarningBanner.setPadding(dp(4), dp(4), dp(4), dp(4));
        opencodeWarningBanner.setGravity(Gravity.CENTER);
        opencodeWarningBanner.setBackground(roundedBg(0xFFFFEBEE, (int) RADIUS_INNER, COLOR_RED, 1));
        opencodeWarningBanner.setVisibility(View.GONE);
        header.addView(opencodeWarningBanner);

        TextView caption = new TextView(this);
        caption.setText("Real-time multi-session control panel \u00b7 live updates, full lifecycle actions");
        caption.setTextColor(COLOR_TEXT_DIM);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        caption.setPadding(0, dp(4), 0, 0);
        header.addView(caption);
        return header;
    }

    private View buildUndoBar() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.bottomMargin = dp(96);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(SPACE_L), dp(SPACE_M), dp(SPACE_L), dp(SPACE_M));
        bar.setBackground(roundedBg(COLOR_SURFACE, (int) RADIUS_FLOAT, COLOR_STROKE, 1));
        bar.setElevation(dp(6));
        undoMessage = new TextView(this);
        undoMessage.setTextColor(COLOR_TEXT);
        undoMessage.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        bar.addView(undoMessage);
        TextView undo = new TextView(this);
        undo.setText("UNDO");
        undo.setTextColor(COLOR_GREEN);
        undo.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        undo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        undo.setPadding(dp(14), dp(4), 0, dp(4));
        undo.setMinimumHeight(dp(48));
        undo.setOnClickListener(view -> {
            if (undoTaskId != null) undoDelete(undoTaskId);
        });
        bar.addView(undo);
        bar.setVisibility(View.GONE);
        this.undoBar = bar;
        return bar;
    }

    private View buildFab() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(56), dp(56));
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.rightMargin = dp(20);
        params.bottomMargin = dp(24);
        TextView fab = new TextView(this);
        fab.setText("+");
        fab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        fab.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        fab.setTextColor(COLOR_BACKGROUND);
        fab.setGravity(Gravity.CENTER);
        fab.setElevation(dp(6));
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(COLOR_ACCENT);
        fab.setBackground(rippleOver(background, COLOR_BACKGROUND, 999f));
        fab.setLayoutParams(params);
        fab.setOnClickListener(view -> showCreateDialog());
        return fab;
    }

    /** Canonical bucket for a section name: progress / todo / finished / null (custom). */
    private static String bucketOf(String name) {
        String normalized = name == null ? "" : name.replaceAll("[\\s_-]", "").toLowerCase(Locale.US);
        if (normalized.contains("progress")) return "progress";
        if (normalized.contains("todo")) return "todo";
        if (normalized.contains("finish") || normalized.contains("done")) return "finished";
        return null;
    }

    private void rebuildChips() {
        progressSectionIds.clear();
        todoSectionIds.clear();
        finishedSectionIds.clear();
        List<String> chipNames = new ArrayList<>();
        List<String> chipTags = new ArrayList<>();
        List<String> signatureParts = new ArrayList<>();
        chipNames.add("All");
        chipTags.add("all");

        boolean hasCompletedTasks = false;
        List<String[]> customSections = new ArrayList<>();
        Set<String> customNames = new HashSet<>();
        if (snapshot != null) {
            for (DaymarkWorkspaceClient.SectionInfo section : snapshot.sections) {
                String bucket = bucketOf(section.name);
                signatureParts.add(section.id);
                if ("progress".equals(bucket)) {
                    progressSectionIds.add(section.id);
                } else if ("todo".equals(bucket)) {
                    todoSectionIds.add(section.id);
                } else if ("finished".equals(bucket)) {
                    finishedSectionIds.add(section.id);
                } else if (customNames.add(section.name.replaceAll("[\\s_-]", "").toLowerCase(Locale.US))) {
                    customSections.add(new String[] {section.id, section.name});
                }
            }
            for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                if (task.completed) hasCompletedTasks = true;
            }
        }
        if (!progressSectionIds.isEmpty()) {
            chipNames.add("In Progress");
            chipTags.add("progress");
        }
        // Smart tab: only shown while at least one unfinished task is paused.
        boolean hasPausedTasks = false;
        if (snapshot != null) {
            for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                if (!task.completed && isTaskPaused(task)) {
                    hasPausedTasks = true;
                    break;
                }
            }
        }
        if (hasPausedTasks) {
            chipNames.add("Paused");
            chipTags.add("paused");
        }
        // PAUSED LAW (auto-switch): the instant a pause appears the view jumps
        // to the Paused tab, remembering where the user was; the moment the
        // last pause clears it returns to that exact tab. Only fires on the
        // transition so a manual tab change while paused is respected.
        if (hasPausedTasks && !lastHadPaused) {
            if (!"paused".equals(selectedChip)) chipBeforePause = selectedChip;
            selectedChip = "paused";
        } else if (!hasPausedTasks && lastHadPaused) {
            if ("paused".equals(selectedChip)) {
                selectedChip = chipBeforePause != null && chipTags.contains(chipBeforePause)
                        ? chipBeforePause : defaultChip();
            }
            chipBeforePause = null;
        }
        lastHadPaused = hasPausedTasks;
        if (!todoSectionIds.isEmpty()) {
            chipNames.add("To do");
            chipTags.add("todo");
        }
        if (!finishedSectionIds.isEmpty() || hasCompletedTasks) {
            chipNames.add("Finished");
            chipTags.add("finished");
        }
        for (String[] custom : customSections) {
            chipNames.add(custom[1]);
            chipTags.add("sec:" + custom[0]);
        }

        // Header chips carry live counts; the signature covers them so a count
        // change re-renders the bar.
        List<Integer> counts = new ArrayList<>();
        if (snapshot != null) {
            for (String tag : chipTags) {
                int count = 0;
                for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                    if (matchesChip(task, tag)) count += 1;
                }
                counts.add(count);
            }
        } else {
            for (String tag : chipTags) counts.add(0);
        }

        StringBuilder countSignature = new StringBuilder();
        for (Integer count : counts) {
            if (countSignature.length() > 0) countSignature.append(',');
            countSignature.append(count);
        }
        String signature = TextUtils.join("|", signatureParts) + "#" + chipTags.size()
                + "#" + countSignature;
        if (signature.equals(chipSignature) && chipsBar.getChildCount() > 0) {
            highlightChips();
            return;
        }
        chipSignature = signature;
        chipsBar.removeAllViews();
        for (int index = 0; index < chipNames.size(); index += 1) {
            final String chipId = chipTags.get(index);
            TextView chip = (TextView) pillButton(
                    chipNames.get(index) + "  \u00b7  " + counts.get(index),
                    COLOR_GRAY, COLOR_GRAY_DIM);
            chip.setOnClickListener(view -> {
                selectedChip = chipId;
                highlightChips();
                applyFilter();
            });
            chip.setTag(chipId);
            chipsBar.addView(chip);
            ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) chip.getLayoutParams();
            params.rightMargin = dp(8);
            params.bottomMargin = dp(8);
        }
        if (selectedChip == null || !chipTags.contains(selectedChip)) {
            selectedChip = defaultChip();
        }
        highlightChips();
    }

    private String defaultChip() {
        return !progressSectionIds.isEmpty() ? "progress" : "all";
    }

    private void highlightChips() {
        for (int index = 0; index < chipsBar.getChildCount(); index += 1) {
            TextView chip = (TextView) chipsBar.getChildAt(index);
            boolean selected = TextUtils.equals((String) chip.getTag(), selectedChip);
            if (selected) {
                chip.setBackground(rippleRounded(COLOR_ACCENT, 999, 0, 0, COLOR_BACKGROUND));
                chip.setTextColor(COLOR_BACKGROUND);
                chip.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            } else {
                chip.setBackground(rippleRounded(COLOR_SURFACE, 999, 0, 0, COLOR_TEXT_DIM));
                chip.setTextColor(COLOR_TEXT_DIM);
                chip.setTypeface(Typeface.DEFAULT);
            }
            chip.setPadding(dp(SPACE_L), dp(SPACE_XS), dp(SPACE_L), dp(SPACE_XS));
        }
    }

    /** Chip membership test, shared by the filter and the chip count badges. */
    private boolean matchesChip(DaymarkWorkspaceClient.TaskInfo task, String chip) {
        switch (chip) {
            case "progress":
                // PAUSED LAW: paused cards live ONLY under the Paused tab;
                // the millisecond they resume they return here.
                return !task.completed && progressSectionIds.contains(task.sectionId)
                        && !isTaskPaused(task);
            case "paused":
                // Smart tab: any unfinished paused task, regardless of section.
                return !task.completed && isTaskPaused(task);
            case "todo":
                return !task.completed && todoSectionIds.contains(task.sectionId);
            case "finished":
                return task.completed || finishedSectionIds.contains(task.sectionId);
            default:
                if (chip.startsWith("sec:")) {
                    return !task.completed
                            && TextUtils.equals(task.sectionId, chip.substring(4));
                }
                return true;
        }
    }

    private void applyFilter() {
        visibleTasks.clear();
        if (snapshot != null) {
            String chip = selectedChip == null ? "all" : selectedChip;
            for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                if (matchesChip(task, chip)) visibleTasks.add(task);
            }
        }
        adapter.notifyDataSetChanged();
        updateEmptyState();
        updateProgressHeader();
        updateToDoHeader();
        updateFinishedHeader();
        maybeAutoAssign();
    }

    /**
     * Mirrors AIControlPanel: one-tap pause-all / resume-all for running
     * sessions, pinned at the top of the In Progress list. State tone follows
     * the action (amber pause / green resume) like the web board button.
     */
    private LinearLayout buildProgressHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(2), dp(12), 0);
        TextView label = new TextView(this);
        label.setText("IN PROGRESS");
        label.setTextColor(COLOR_TEXT_DIM);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_MICRO);
        label.setLetterSpacing(0.06f);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        progressLabel = label;
        header.addView(label, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        // Pills live in a horizontal scroller so [Pause all][Resume all][Move all]
        // can never clip past the screen edge when labels grow with counts.
        HorizontalScrollView pillScroller = new HorizontalScrollView(this);
        pillScroller.setHorizontalScrollBarEnabled(false);
        LinearLayout pillRow = new LinearLayout(this);
        pillRow.setOrientation(LinearLayout.HORIZONTAL);
        pillRow.setGravity(Gravity.CENTER_VERTICAL);
        pauseAllButton = (TextView) pillButton("Pause all", COLOR_AMBER, COLOR_AMBER_DIM);
        pauseAllButton.setOnClickListener(view -> onAllPausePressed(true));
        pillRow.addView(pauseAllButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        // Separate RESUME ALL button (user demand): always next to Pause all,
        // resumes every paused session in one tap, independent of Pause all.
        resumeAllButton = (TextView) pillButton("Resume all", COLOR_TEXT, COLOR_SURFACE);
        resumeAllButton.setOnClickListener(view -> onAllPausePressed(false));
        pillRow.addView(resumeAllButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        // Move-all (demand 4.1): bulk-move every visible card to a chosen
        // section via a compact destination picker dialog.
        moveAllButton = (TextView) pillButton("Move all", COLOR_TEXT, COLOR_SURFACE);
        moveAllButton.setOnClickListener(view -> showMoveAllDialog());
        pillRow.addView(moveAllButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        pillScroller.addView(pillRow, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        header.addView(pillScroller, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return header;
    }

    /** Shows the In Progress header (with pause-all) only on the In Progress chip. */
    private void updateProgressHeader() {
        boolean showing = ("progress".equals(selectedChip) || "paused".equals(selectedChip))
                && !visibleTasks.isEmpty();
        progressHeader.setVisibility(showing ? View.VISIBLE : View.GONE);
        if (!showing) return;
        int running = 0;
        int paused = 0;
        for (DaymarkWorkspaceClient.TaskInfo task : visibleTasks) {
            if (isTaskPaused(task)) paused += 1;
            else running += 1;
        }
        progressLabel.setText(("paused".equals(selectedChip) ? "PAUSED" : "IN PROGRESS")
                + "  \u00b7  " + visibleTasks.size());
        boolean nextPaused = running > 0;
        int targets = nextPaused ? running : paused;
        if (pauseAllBusy) {
            pauseAllButton.setText(nextPaused ? "Pausing\u2026" : "Resuming\u2026");
            return;
        }
        pauseAllButton.setText(nextPaused
                ? "Pause all (" + targets + ")"
                : "Resume all (" + targets + ")");
        int tone = nextPaused ? COLOR_AMBER : COLOR_GREEN;
        pauseAllButton.setBackground(rippleRounded(tone, 999, 0, 0, COLOR_BACKGROUND));
        pauseAllButton.setTextColor(COLOR_BACKGROUND);
        pauseAllButton.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    }

    /**
     * One tap pauses every running session (or resumes every paused one) by
     * prepending the same "\u2014 PAUSED/RESUMED HH:MM \u2014" journal marker the
     * single-session button uses — the PC relay enforces it within seconds.
     */
    /** Pause-all or Resume-all, explicitly chosen by the button pressed. */
    private void onAllPausePressed(final boolean pausing) {
        if (pauseAllBusy || snapshot == null) return;
        List<DaymarkWorkspaceClient.TaskInfo> targets = new ArrayList<>();
        if (pausing) {
            for (DaymarkWorkspaceClient.TaskInfo task : visibleTasks) {
                if (!task.completed && progressSectionIds.contains(task.sectionId)) targets.add(task);
            }
        } else {
            // RESUME ALL LAW: force-resume EVERY paused task in the whole
            // snapshot, whatever tab it sits in — paused cards are excluded
            // from the In Progress tab by paused-purity, so visibleTasks alone
            // would always be empty here.
            if (snapshot != null) {
                for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                    if (!task.completed && isTaskPaused(task)) targets.add(task);
                }
            }
        }
        if (targets.isEmpty()) return;
        final String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                .format(new java.util.Date());
        pauseAllBusy = true;
        updateProgressHeader();
        runAllPause(targets, pausing, stamp);
    }

    private void runAllPause(final List<DaymarkWorkspaceClient.TaskInfo> targets,
            final boolean pausing, final String stamp) {
        // State contract: pause-all/resume-all only PREPEND journal markers.
        // They never mutate per-card UI state; per-card pause/resume buttons
        // derive solely from isTaskPaused(task) on every render, so they stay
        // truthful whether a pause came from here or the individual button.
        Log.i("DaymarkAi", "all-pause: targets=" + targets.size() + " pausing=" + pausing);
        // NO DELAY law with bounded concurrency: 3 parallel writers — a full
        // burst against the sync worker caused connection aborts/DNS failures
        // (observed: 6 of 8 writes lost), while pure-serial took ~9s per task.
        // 3 workers + one retry per task freezes everything in seconds, safely.
        final java.util.concurrent.ExecutorService pool =
                java.util.concurrent.Executors.newFixedThreadPool(3);
        final java.util.List<java.util.concurrent.Future<int[]>> futures = new ArrayList<>();
        for (final DaymarkWorkspaceClient.TaskInfo task : targets) {
            futures.add(pool.submit(() -> {
                boolean currentlyPaused = isTaskPaused(task);
                if (pausing == currentlyPaused) return new int[]{0, 0};
                String line = "\u2014 " + (pausing ? "PAUSED" : "RESUMED") + " " + stamp + " \u2014";
                for (int attempt = 0; attempt < 2; attempt++) {
                    try {
                        DaymarkWorkspaceClient.prependJournalLine(syncKey, task.id, line);
                        return new int[]{1, 0};
                    } catch (Exception error) {
                        Log.w("DaymarkAi", "pause-all failed for " + task.id
                                + " attempt " + (attempt + 1) + ": " + error.getMessage());
                        if (attempt == 0) {
                            try { Thread.sleep(1500L); } catch (InterruptedException ie) { }
                        }
                    }
                }
                return new int[]{0, 1};
            }));
        }
        networkExecutor.execute(() -> {
            int acted = 0;
            int failures = 0;
            for (java.util.concurrent.Future<int[]> future : futures) {
                try {
                    int[] r = future.get(45, java.util.concurrent.TimeUnit.SECONDS);
                    acted += r[0];
                    failures += r[1];
                } catch (Exception error) {
                    failures += 1;
                }
            }
            pool.shutdown();
            final int actedCount = acted;
            final int failedCount = failures;
            Log.i("DaymarkAi", "pause-all done: pausing=" + pausing
                    + " acted=" + actedCount + " failed=" + failedCount);
            mainHandler.post(() -> {
                pauseAllBusy = false;
                if (failedCount == 0) {
                    Toast.makeText(this, (pausing ? "Paused " : "Resumed ") + actedCount
                            + " session" + (actedCount == 1 ? "" : "s"), Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, "Could not update " + failedCount
                            + " session" + (failedCount == 1 ? "" : "s") + " \u00b7 tap the button again to retry",
                            Toast.LENGTH_LONG).show();
                }
                refreshNow();
            });
        });
    }

    /** Move-all (demand 4.1): compact destination picker for every visible card. */
    private void showMoveAllDialog() {
        if (moveAllBusy || snapshot == null || visibleTasks.isEmpty()) return;
        final List<String> destinationNames = new ArrayList<>();
        destinationNames.add("In Progress");
        destinationNames.add("To do");
        destinationNames.add("Finished");
        new android.app.AlertDialog.Builder(this)
                .setTitle("Move all " + visibleTasks.size() + " card"
                        + (visibleTasks.size() == 1 ? "" : "s") + " to\u2026")
                .setItems(destinationNames.toArray(new String[0]), (dialog, which) -> {
                    final String destinationName = destinationNames.get(which);
                    String resolvedId;
                    if ("In Progress".equals(destinationName)) {
                        resolvedId = progressSectionIds.isEmpty()
                                ? "section-f4273c48bb921753b1b6e73a"
                                : progressSectionIds.get(0);
                    } else if ("To do".equals(destinationName)) {
                        resolvedId = todoSectionIds.isEmpty()
                                ? "section-5fc763b0f6ac492b7c4eaa0f"
                                : todoSectionIds.get(0);
                    } else {
                        resolvedId = finishedSectionIds.isEmpty()
                                ? "section-7f2adc429cd4a01046f1415d"
                                : finishedSectionIds.get(0);
                    }
                    final String destinationId = resolvedId;
                    runMoveAll(new ArrayList<>(visibleTasks), destinationName, destinationId);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /**
     * Move-all (demand 4.1): optimistically re-sections every visible card so
     * the UI moves instantly, then fires a direct-PATCH volley (6 workers, 3
     * attempts per task). Honest success: the success toast fires ONLY when
     * every PATCH landed AND the "— ORDER HH:MM — move-all: <section>" journal
     * line landed on ONE affected card (FULL description PATCH, new line on
     * top) so the PC bridge reconciles any stragglers. Any failure toasts a
     * failure and refreshNow() reverts the optimistic state.
     */
    private void runMoveAll(final List<DaymarkWorkspaceClient.TaskInfo> targets,
            final String sectionName, final String sectionId) {
        final String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                .format(new java.util.Date());
        moveAllBusy = true;
        // 1) Optimistic local re-section: every visible card moves instantly.
        final List<String> targetIds = new ArrayList<>();
        for (DaymarkWorkspaceClient.TaskInfo task : targets) {
            targetIds.add(task.id);
            try {
                JSONObject optimistic = new JSONObject(task.raw.toString());
                optimistic.put("sectionId", sectionId);
                optimistic.put("updatedAt", DaymarkWorkspaceClient.nowIso());
                applyOptimisticView(task.id, optimistic, false);
            } catch (JSONException error) {
                Log.w("DaymarkAi", "move-all optimistic failed for " + task.id
                        + ": " + error.getMessage());
            }
        }
        final DaymarkWorkspaceClient.TaskInfo carrier = targets.get(0);
        final String carrierDescription = carrier.description == null ? "" : carrier.description;
        final String journalLine = "\u2014 ORDER " + stamp + " \u2014 move-all: " + sectionName;
        networkExecutor.execute(() -> {
            final java.util.concurrent.atomic.AtomicInteger failures =
                    new java.util.concurrent.atomic.AtomicInteger(0);
            final java.util.concurrent.ExecutorService pool =
                    java.util.concurrent.Executors.newFixedThreadPool(6);
            final java.util.concurrent.CountDownLatch latch =
                    new java.util.concurrent.CountDownLatch(targetIds.size());
            for (final String taskId : targetIds) {
                pool.execute(() -> {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("sectionId", sectionId);
                        boolean landed = false;
                        for (int attempt = 0; attempt < 3 && !landed; attempt++) {
                            try {
                                DaymarkWorkspaceClient.patchTask(syncKey, taskId, body);
                                landed = true;
                            } catch (Exception error) {
                                Log.w("DaymarkAi", "move-all patch " + taskId
                                        + " attempt " + (attempt + 1) + ": " + error.getMessage());
                                if (attempt < 2) {
                                    try { Thread.sleep(300L * (attempt + 1)); }
                                    catch (InterruptedException ie) { }
                                }
                            }
                        }
                        if (!landed) failures.incrementAndGet();
                    } catch (Exception error) {
                        Log.w("DaymarkAi", "move-all worker " + taskId + ": " + error.getMessage());
                        failures.incrementAndGet();
                    } finally {
                        latch.countDown();
                    }
                });
            }
            boolean volleyOk = false;
            try {
                volleyOk = latch.await(45, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            pool.shutdown();
            // Journal marker on ONE affected card so the PC bridge reconciles
            // stragglers: PATCH the FULL description with the new line on top.
            boolean journalOk = false;
            try {
                String freshDesc = carrierDescription;
                try {
                    JSONObject rawCarrier = new JSONObject(DaymarkWorkspaceClient.fetchTaskRaw(syncKey, carrier.id));
                    String liveDesc = rawCarrier.optString("description", "");
                    if (!liveDesc.isEmpty()) freshDesc = liveDesc;
                } catch (Exception ignore) { }
                JSONObject journal = new JSONObject();
                journal.put("description", freshDesc.isEmpty()
                        ? journalLine : journalLine + "\n" + freshDesc);
                DaymarkWorkspaceClient.patchTask(syncKey, carrier.id, journal);
                journalOk = true;
            } catch (Exception error) {
                Log.w("DaymarkAi", "move-all journal failed: " + error.getMessage());
            }
            final boolean success = volleyOk && failures.get() == 0 && journalOk;
            Log.i("DaymarkAi", "move-all done: target=" + sectionName
                    + " count=" + targetIds.size() + " success=" + success);
            mainHandler.post(() -> {
                moveAllBusy = false;
                if (success) {
                    Toast.makeText(this, "Moved " + targetIds.size() + " card"
                            + (targetIds.size() == 1 ? "" : "s") + " to " + sectionName,
                            Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, "Move-all did not fully land \u00b7 restoring",
                            Toast.LENGTH_LONG).show();
                }
                refreshNow();
            });
        });
    }

    /** Shows the Finished section header (with delete-all) only on the Finished chip. */
    private void updateFinishedHeader() {
        boolean showing = "finished".equals(selectedChip) && !visibleTasks.isEmpty();
        finishedHeader.setVisibility(showing ? View.VISIBLE : View.GONE);
        if (showing) {
            finishedLabel.setText("FINISHED  \u00b7  " + visibleTasks.size());
            if (!deleteAllBusy) deleteAllButton.setText("Delete all");
        }
    }

    /** To-do section header with the AUTO sequential-runner toggle. */
    private LinearLayout buildToDoHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(2), dp(12), 0);
        TextView label = new TextView(this);
        label.setText("TO DO");
        label.setTextColor(COLOR_TEXT_DIM);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_MICRO);
        label.setLetterSpacing(0.06f);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        toDoLabel = label;
        header.addView(label, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        autoRunButton = (TextView) pillButton("AUTO \u25cb", COLOR_TEXT, COLOR_SURFACE);
        autoRunButton.setOnClickListener(view -> onAutoRunToggled());
        header.addView(autoRunButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        autoSessionsButton = (TextView) pillButton("\u25d4 1", COLOR_TEXT, COLOR_SURFACE);
        autoSessionsButton.setOnClickListener(view -> showSessionsDialog());
        header.addView(autoSessionsButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        autoIntervalButton = (TextView) pillButton("\u23f1 off", COLOR_TEXT, COLOR_SURFACE);
        autoIntervalButton.setOnClickListener(view -> onAutoIntervalCycled());
        header.addView(autoIntervalButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        styleAutoRunButton();
        return header;
    }

    /** Tap opens a free-number dialog: enter ANY minute count (no limit) or
     * hit Off to disable the force-start timer entirely. */
    private void onAutoIntervalCycled() {
        android.widget.EditText input = new android.widget.EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        input.setHint("minutes (any amount)");
        input.setText(autoIntervalMin > 0 ? String.valueOf(autoIntervalMin) : "");
        input.setSelection(input.getText().length());
        LinearLayout wrap = new LinearLayout(this);
        wrap.setPadding(dp(24), dp(8), dp(24), 0);
        wrap.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
                .setTitle("Force-start timer")
                .setMessage("Start the next To do task every N minutes, no limit on N. Off = never force-start.")
                .setView(wrap)
                .setPositiveButton("Set", (dialog, which) -> {
                    Integer minutes = parseMinutes(input.getText().toString());
                    autoIntervalMin = minutes == null ? 0 : minutes;
                    getSharedPreferences("daymark", MODE_PRIVATE).edit()
                            .putInt(AUTO_INTERVAL_PREF, autoIntervalMin).apply();
                    styleAutoRunButton();
                })
                .setNeutralButton("Off", (dialog, which) -> {
                    autoIntervalMin = 0;
                    getSharedPreferences("daymark", MODE_PRIVATE).edit()
                            .putInt(AUTO_INTERVAL_PREF, 0).apply();
                    styleAutoRunButton();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /** Tap opens a free-number dialog: run ANY number of AUTO sessions at once
     * (minimum 1). Every slot stays filled — one finishes, next To do starts. */
    private void showSessionsDialog() {
        android.widget.EditText input = new android.widget.EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        input.setHint("sessions running at the same time");
        input.setText(String.valueOf(autoSessions));
        input.setSelection(input.getText().length());
        LinearLayout wrap = new LinearLayout(this);
        wrap.setPadding(dp(24), dp(8), dp(24), 0);
        wrap.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
                .setTitle("AUTO parallel sessions")
                .setMessage("How many sessions should AUTO keep running at all times? The moment one finishes, the next To do task starts.")
                .setView(wrap)
                .setPositiveButton("Set", (dialog, which) -> {
                    Integer count = parseMinutes(input.getText().toString());
                    autoSessions = count == null ? 1 : Math.max(1, count);
                    getSharedPreferences("daymark", MODE_PRIVATE).edit()
                            .putInt(AUTO_SESSIONS_PREF, autoSessions).apply();
                    styleAutoRunButton();
                    if (autoRunEnabled) maybeAutoAssign();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private Integer parseMinutes(String text) {
        try {
            int value = Integer.parseInt(text.trim());
            return value > 0 ? value : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    /** Shows the To do header (with AUTO toggle) only on the To do chip. */
    private void updateToDoHeader() {
        boolean showing = "todo".equals(selectedChip) && !visibleTasks.isEmpty();
        toDoHeader.setVisibility(showing ? View.VISIBLE : View.GONE);
        if (showing) {
            toDoLabel.setText("TO DO  \u00b7  " + visibleTasks.size());
            styleAutoRunButton();
        }
    }

    /** AUTO pill tone: filled green when running, YELLOW while the X-minute
     * force-start interval override is active, dim outline when off. */
    private void styleAutoRunButton() {
        if (autoRunButton == null) return;
        autoRunButton.setText(autoRunEnabled ? "AUTO \u25cf" : "AUTO \u25cb");
        if (autoIntervalMin > 0) {
            autoRunButton.setBackground(rippleRounded(COLOR_AUTO_YELLOW, 999, 0, 0,
                    0xFF14140F));
            autoRunButton.setTextColor(0xFF14140F);
            autoRunButton.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        } else if (autoRunEnabled) {
            autoRunButton.setBackground(rippleRounded(COLOR_GREEN, 999, 0, 0, COLOR_BACKGROUND));
            autoRunButton.setTextColor(COLOR_BACKGROUND);
            autoRunButton.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        } else {
            autoRunButton.setBackground(rippleRounded(COLOR_SURFACE, 999, COLOR_STROKE, 1,
                    COLOR_TEXT_DIM));
            autoRunButton.setTextColor(COLOR_TEXT_DIM);
            autoRunButton.setTypeface(Typeface.DEFAULT);
        }
        if (autoSessionsButton != null) {
            autoSessionsButton.setText("\u25d4 " + autoSessions);
            if (autoSessions > 1) {
                autoSessionsButton.setBackground(rippleRounded(COLOR_BLUE, 999, 0, 0, COLOR_BACKGROUND));
                autoSessionsButton.setTextColor(COLOR_BACKGROUND);
                autoSessionsButton.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            } else {
                autoSessionsButton.setBackground(rippleRounded(COLOR_SURFACE, 999, COLOR_STROKE, 1,
                        COLOR_TEXT_DIM));
                autoSessionsButton.setTextColor(COLOR_TEXT_DIM);
                autoSessionsButton.setTypeface(Typeface.DEFAULT);
            }
        }
        if (autoIntervalButton != null) {
            autoIntervalButton.setText(autoIntervalMin > 0
                    ? ("\u23f1 " + autoIntervalMin + "m") : "\u23f1 off");
            if (autoIntervalMin > 0) {
                autoIntervalButton.setBackground(rippleRounded(COLOR_AUTO_YELLOW, 999, 0, 0,
                        0xFF14140F));
                autoIntervalButton.setTextColor(0xFF14140F);
                autoIntervalButton.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            } else {
                autoIntervalButton.setBackground(rippleRounded(COLOR_SURFACE, 999, COLOR_STROKE, 1,
                        COLOR_TEXT_DIM));
                autoIntervalButton.setTextColor(COLOR_TEXT_DIM);
                autoIntervalButton.setTypeface(Typeface.DEFAULT);
            }
        }
    }

    /**
     * AUTO sequential runner: when enabled, after every refresh the first To do
     * task is assigned (same path as the Assign button). A new task is started
     * only once the previously assigned one left In Progress or completed.
     * Toggling OFF clears the guard so a later ON starts fresh; the session
     * currently running finishes naturally (no journal writes are made here).
     */
    private void onAutoRunToggled() {
        autoRunEnabled = !autoRunEnabled;
        getSharedPreferences("daymark", MODE_PRIVATE).edit()
                .putBoolean(AUTO_PREF, autoRunEnabled).apply();
        autoAssignedIds.clear();
        autoAssignInFlight = false;
        styleAutoRunButton();
        if (autoRunEnabled) maybeAutoAssign();
    }

    /**
     * AUTO runner: keeps EXACTLY autoSessions tasks running at all times
     * (user demand). Every running auto slot is tracked in autoAssignedIds;
     * the 5s autoTick refills any freed slot from the top of the To do list
     * the moment a task finishes — with N slots the board always shows N
     * live sessions. autoSessions = 1 reproduces the old strict-sequential
     * behavior, so the default flow is unchanged.
     */
    private void maybeAutoAssign() {
        if (!autoRunEnabled || snapshot == null || syncKey == null) return;
        // Free finished/abandoned slots. "Finished" = completed, gone from the
        // snapshot, or sitting in a finished section (sections are the
        // authoritative signal — sessions move cards without completing them).
        // A slot task the USER moved back to To do is a human decision: drop
        // the slot and let the next task in line fill it. With the timer set,
        // a slot whose task ran longer than N minutes is force-released so the
        // next To do starts even while the old session still runs.
        java.util.Iterator<Map.Entry<String, Long>> slots = autoAssignedIds.entrySet().iterator();
        while (slots.hasNext()) {
            Map.Entry<String, Long> slot = slots.next();
            DaymarkWorkspaceClient.TaskInfo task = findTask(slot.getKey());
            boolean finished = task == null || task.completed
                    || finishedSectionIds.contains(task.sectionId);
            boolean userMovedBack = task != null && todoSectionIds.contains(task.sectionId);
            boolean timedOut = !finished && !userMovedBack && autoIntervalMin > 0
                    && System.currentTimeMillis() - slot.getValue()
                            >= autoIntervalMin * 60_000L;
            if (finished || userMovedBack || timedOut) slots.remove();
        }
        // USER ORDER LAW: refill every free slot with the lowest-order eligible
        // To do task (top of the list) — never an excluded one, never a task
        // already holding a slot, never one handed to an agent <2 min ago.
        while (autoAssignedIds.size() < autoSessions) {
            DaymarkWorkspaceClient.TaskInfo next = null;
            for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                if (task.completed || !todoSectionIds.contains(task.sectionId)) continue;
                if (autoExcluded.contains(task.id)) continue;   // user exclusion
                if (autoAssignedIds.containsKey(task.id)) continue;
                if (autoParkedRecently(task.id)) continue;      // handed <2 min ago: hold
                if (next == null || task.order < next.order) next = task;
            }
            if (next == null) break;   // no more eligible To do tasks
            autoAssignedIds.put(next.id, System.currentTimeMillis());
            final String taskId = next.id;
            mutate("AUTO assigned \u00b7 pinned to In Progress", state -> {
                DaymarkWorkspaceClient.assignSession(state, taskId);
                return null;
            });
        }
    }

    /** Per-task AUTO exclusion: an excluded To do task is never auto-assigned
     * (manual Assign still works). Tap again to re-include it. */
    private void toggleAutoExcluded(final DaymarkWorkspaceClient.TaskInfo task) {
        if (autoExcluded.contains(task.id)) {
            autoExcluded.remove(task.id);
        } else {
            autoExcluded.add(task.id);
        }
        getSharedPreferences("daymark", MODE_PRIVATE).edit()
                .putStringSet(AUTO_EXCLUDED_PREF, autoExcluded).apply();
        refreshNow();
    }

    /** Finished section header: label + immediate force delete-all pill. */
    private LinearLayout buildFinishedHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(2), dp(12), 0);
        TextView label = new TextView(this);
        label.setText("FINISHED");
        label.setTextColor(COLOR_TEXT_DIM);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_MICRO);
        label.setLetterSpacing(0.06f);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        finishedLabel = label;
        header.addView(label, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        deleteAllButton = (TextView) pillButton("Delete all", COLOR_RED, COLOR_RED_DIM);
        deleteAllButton.setOnClickListener(view -> showDeleteAllDialog());
        header.addView(deleteAllButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return header;
    }

    /**
     * One tap: shows dialog to choose delete FINISHED only or delete ALL tasks.
     * Both options are instant, no confirm step, retry-hardened journal marker.
     */
    private void showDeleteAllDialog() {
        if (deleteAllBusy || snapshot == null || syncKey == null) return;
        
        final long finishedCount = snapshot.tasks.stream().filter(t -> t.completed || finishedSectionIds.contains(t.sectionId)).count();
        final long unfinishedCount = snapshot.tasks.stream().filter(t -> !t.completed && !finishedSectionIds.contains(t.sectionId)).count();
        
        if (finishedCount == 0 && unfinishedCount == 0) {
            Toast.makeText(this, "No tasks to delete.", Toast.LENGTH_SHORT).show();
            return;
        }
        
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Delete All Tasks");
        
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        
        TextView desc = new TextView(this);
        desc.setText(String.format("Choose what to delete:\n\u2022 Finished tasks: %d\n\u2022 Unfinished tasks (In Progress + To do): %d\n\u2022 Total: %d", finishedCount, unfinishedCount, finishedCount + unfinishedCount));
        desc.setTextColor(COLOR_TEXT_DIM);
        desc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        desc.setPadding(0, 0, 0, dp(16));
        
        LinearLayout options = new LinearLayout(this);
        options.setOrientation(LinearLayout.VERTICAL);
        options.setPadding(0, dp(8), 0, 0);
        
        if (finishedCount > 0) {
            TextView opt1 = (TextView) pillButton("Delete FINISHED only (" + finishedCount + ")", COLOR_RED, COLOR_RED_DIM);
            opt1.setOnClickListener(v -> {
                deleteAllType = "finished";
                executeDeleteAll();
            });
            options.addView(opt1);
        }
        
        if (unfinishedCount > 0) {
            TextView opt2 = (TextView) pillButton("Delete ALL (" + (finishedCount + unfinishedCount) + ")", COLOR_RED, COLOR_RED_DIM);
            opt2.setBackground(rippleRounded(0xFF8B0000, 999, 0xFFB71C1C, 2, COLOR_BACKGROUND));
            opt2.setOnClickListener(v -> {
                deleteAllType = "all";
                executeDeleteAll();
            });
            options.addView(opt2);
        }
        
        LinearLayout fullForm = new LinearLayout(this);
        fullForm.setOrientation(LinearLayout.VERTICAL);
        fullForm.addView(desc);
        fullForm.addView(options);
        
        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(wrapScroll(fullForm))
                .setNegativeButton("Cancel", null)
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }
    
    private String deleteAllType = "finished";
    
    private void executeDeleteAll() {
        if (deleteAllBusy || snapshot == null || syncKey == null) return;
        
        final boolean deleteFinished = "finished".equals(deleteAllType);
        final long count = snapshot.tasks.stream()
                .filter(t -> deleteFinished 
                    ? (t.completed || finishedSectionIds.contains(t.sectionId))
                    : true)
                .count();
        
        if (count == 0) {
            Toast.makeText(this, deleteFinished ? "Finished is already empty." : "No tasks to delete.", Toast.LENGTH_SHORT).show();
            return;
        }
        
        DaymarkWorkspaceClient.TaskInfo carrier = null;
        for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
            if (deleteFinished) {
                if (task.completed || finishedSectionIds.contains(task.sectionId)) { carrier = task; break; }
            } else {
                carrier = task; break; // any task works for all-delete
            }
        }
        if (carrier == null) { 
            Toast.makeText(this, "No tasks to delete.", Toast.LENGTH_SHORT).show(); 
            return; 
        }
        
        deleteAllBusy = true;
        Toast.makeText(this, "Purging " + (deleteFinished ? "finished" : "all") + " tasks\u2026", Toast.LENGTH_SHORT).show();
        final DaymarkWorkspaceClient.TaskInfo carrierTask = carrier;
        final String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US).format(new java.util.Date());

        // FINISHED PURGE: submit every finished-task deletion in parallel on the
        // networkExecutor (fixed pool) with a 10s CountDownLatch deadline; one
        // summary journal line total instead of one per task. Filter is exactly
        // (completed || finishedSectionIds) — To do / In Progress never touched.
        if (deleteFinished) {
            final java.util.List<String> finishedIds = new ArrayList<>();
            for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
                if (task.completed || finishedSectionIds.contains(task.sectionId)) {
                    finishedIds.add(task.id);
                }
            }
            final long startMs = SystemClock.elapsedRealtime();
            networkExecutor.execute(() -> {
                final java.util.concurrent.CountDownLatch latch =
                        new java.util.concurrent.CountDownLatch(finishedIds.size());
                final java.util.concurrent.atomic.AtomicInteger deleted =
                        new java.util.concurrent.atomic.AtomicInteger();
                for (final String id : finishedIds) {
                    networkExecutor.execute(() -> {
                        try {
                            DaymarkWorkspaceClient.deleteTask(syncKey, id);
                            deleted.incrementAndGet();
                        } catch (Exception e) {
                            Log.w("DaymarkAi", "parallel delete failed for " + id + ": " + e.getMessage());
                        } finally {
                            latch.countDown();
                        }
                    });
                }
                try {
                    latch.await(10, java.util.concurrent.TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {}
                long wallMs = SystemClock.elapsedRealtime() - startMs;
                final int n = deleted.get();
                // ONE summary journal line total, not one per task.
                if (n > 0) {
                    try {
                        DaymarkWorkspaceClient.prependJournalLine(syncKey, carrierTask.id,
                                "\u2014 ORDER " + stamp + " \u2014 delete-finished: purged " + n + " finished tasks");
                    } catch (Exception e) {
                        Log.w("DaymarkAi", "delete-finished summary line failed: " + e.getMessage());
                    }
                }
                mainHandler.post(() -> {
                    deleteAllBusy = false;
                    Toast.makeText(AiWorkspaceActivity.this,
                            "Deleted " + n + " tasks in " + wallMs + " ms", Toast.LENGTH_LONG).show();
                    refreshNow();
                });
            });
            return;
        }

        networkExecutor.execute(() -> {
            boolean ok = false;
            for (int attempt = 0; attempt < 12 && !ok; attempt++) {
                try {
                    String marker = deleteFinished
                        ? "\u2014 ORDER " + stamp + " \u2014 delete-finished: purge every finished task now"
                        : "\u2014 ORDER " + stamp + " \u2014 delete-all: purge every task now";
                    DaymarkWorkspaceClient.prependJournalLine(syncKey, carrierTask.id, marker);
                    ok = true;
                } catch (Exception error) {
                    Log.w("DaymarkAi", "delete-all marker attempt " + (attempt + 1) + " failed: " + error.getMessage());
                    try { Thread.sleep(Math.min(8000L, 500L * (attempt + 1))); } catch (InterruptedException ie) { }
                }
            }
            final boolean ordered = ok;
            mainHandler.post(() -> {
                deleteAllBusy = false;
                Toast.makeText(this, ordered
                        ? "Purge ordered \u2014 " + (deleteFinished ? "finished" : "all") + " clears in seconds"
                        : "Could not reach the workspace \u00b7 try again", Toast.LENGTH_LONG).show();
                if (ordered) { mainHandler.postDelayed(this::refreshNow, 6000L); }
            });
        });
    }

    /**
     * One tap: immediate force delete of every Finished task — no arm/confirm
     * step. Hard scope guard scans the full snapshot, so only finished tasks
     * (completed or in a finished section) can ever be deleted; In Progress and
     * To do tasks are untouched.
     */
    /**
     * One tap: orders the PC bridge to purge every Finished task via the
     * authoritative agent API. The phone only writes ONE marker line (single
     * push, retry-hardened) — per-task deletes from the phone were conflict-
     * prone ("saving" forever); the bridge deletes server-side in seconds.
     */
    private void onDeleteAllPressed() {
        if (deleteAllBusy || snapshot == null || syncKey == null) return;
        DaymarkWorkspaceClient.TaskInfo carrier = null;
        for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
            if (task.completed || finishedSectionIds.contains(task.sectionId)) { carrier = task; break; }
        }
        if (carrier == null) { Toast.makeText(this, "Finished is already empty.", Toast.LENGTH_SHORT).show(); return; }
        deleteAllBusy = true;
        Toast.makeText(this, "Purging finished\u2026", Toast.LENGTH_SHORT).show();
        final DaymarkWorkspaceClient.TaskInfo carrierTask = carrier;
        final String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                .format(new java.util.Date());
        networkExecutor.execute(() -> {
            boolean ok = false;
            for (int attempt = 0; attempt < 12 && !ok; attempt++) {
                try {
                    DaymarkWorkspaceClient.prependJournalLine(syncKey, carrierTask.id,
                            "\u2014 ORDER " + stamp + " \u2014 delete-finished: purge every finished task now");
                    ok = true;
                } catch (Exception error) {
                    Log.w("DaymarkAi", "delete-all marker attempt " + (attempt + 1)
                            + " failed: " + error.getMessage());
                    try { Thread.sleep(Math.min(8000L, 500L * (attempt + 1))); } catch (InterruptedException ie) { }
                }
            }
            final boolean ordered = ok;
            mainHandler.post(() -> {
                deleteAllBusy = false;
                Toast.makeText(this, ordered
                        ? "Purge ordered \u2014 finished clears in seconds"
                        : "Could not reach the workspace \u00b7 try again", Toast.LENGTH_LONG).show();
                if (ordered) { mainHandler.postDelayed(this::refreshNow, 6000L); }
            });
        });
    }

    private void updateEmptyState() {
        boolean showEmpty = visibleTasks.isEmpty();
        emptyWrap.setVisibility(showEmpty ? View.VISIBLE : View.GONE);
        grid.setVisibility(showEmpty ? View.GONE : View.VISIBLE);
        if (!showEmpty) return;
        emptyActions.removeAllViews();
        if (syncKey == null) {
            emptyIcon.setText("\u25c7");
            emptyView.setText("Nothing here yet.\nPair a Daymark workspace to watch your AI sessions live.");
            emptyActions.addView(emptyButton("Open Daymark", view -> openMainActivity()));
            emptyActions.addView(emptyButton("Paste sync key", view -> showSyncKeyDialog()));
        } else if (snapshot != null && snapshot.projectId == null) {
            emptyIcon.setText("\u25c7");
            emptyView.setText("The AIControlPanel workspace was not found in this Daymark workspace.\nCreate a project named \u201cAIControlPanel\u201d to monitor it here.");
        } else if (snapshot == null) {
            emptyIcon.setText("\u25cb");
            emptyView.setText("Connecting to Daymark\u2026");
        } else {
            emptyIcon.setText("\u25c7");
            emptyView.setText("All quiet in this section.\nStart a session from an agent, or create one here.");
        }
    }

    private LinearLayout emptyWrap() {
        return emptyWrap;
    }

    private View emptyButton(String label, View.OnClickListener listener) {
        TextView button = (TextView) pillButton(label, COLOR_TEXT, COLOR_SURFACE);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.rightMargin = dp(10);
        button.setLayoutParams(params);
        return button;
    }

    private void openMainActivity() {
        startActivity(new Intent(this, MainActivity.class));
    }

    // ---- Session cards ----

    private void toggleExpanded(String taskId) {
        if (!expandedTaskIds.remove(taskId)) {
            expandedTaskIds.add(taskId);
        }
        adapter.notifyDataSetChanged();
    }

    private View buildCard(final DaymarkWorkspaceClient.TaskInfo task) {
        long now = System.currentTimeMillis();
        SessionUpdateParser.Result journal = SessionUpdateParser.parse(
                task.description, task.updatedAtMillis);
        boolean paused = !task.completed && isTaskPaused(task);

        // Modern surface: 16dp corners, hairline stroke, layered tinted shadow
        // and a 4dp state-colored accent stripe down the left edge.
        FrameLayout shell = new FrameLayout(this);
        shell.setMinimumHeight(dp(220));
        shell.setBackground(roundedBg(COLOR_CARD, 16, COLOR_STROKE, 1));
        shell.setElevation(dp(ELEVATION_CARD_DP));
        if (Build.VERSION.SDK_INT >= 28) {
            shell.setOutlineAmbientShadowColor(withAlpha(COLOR_ACCENT, 0x2E));
            shell.setOutlineSpotShadowColor(0xD2000000);
        }
        shell.addView(cardAccentStripe(task, journal, now));
        // Paused cards read as muted ONLY while monitoring the In Progress tab
        // (they also live in the Paused tab, where they must render full-strength).
        if (paused && "progress".equals(selectedChip)) shell.setAlpha(0.6f);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(SPACE_L), dp(SPACE_L), dp(SPACE_L), dp(SPACE_L));

        // Status pills scroll horizontally instead of clipping at the card edge.
        HorizontalScrollView topRowScroller = new HorizontalScrollView(this);
        topRowScroller.setHorizontalScrollBarEnabled(false);
        // USER LAW: a non-default model is ALWAYS named in YELLOW at the very
        // top of the card, real-time, for as long as it is the chosen model.
        String modelBanner = taskModelId(task);
        if (modelBanner != null) {
            TextView modelLine = new TextView(this);
            modelLine.setText("\u26a1 MODEL: " + modelBanner);
            modelLine.setTextColor(COLOR_AMBER);
            modelLine.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
            modelLine.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            modelLine.setPadding(0, dp(SPACE_XS), 0, 0);
            card.addView(modelLine);
        }

        topRowScroller.addView(buildCardTopRow(task, journal, now, paused),
                new ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT));
        card.addView(topRowScroller, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText(task.content);
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setLetterSpacing(-0.01f);
        title.setLineSpacing(0f, 1.4f);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(0, dp(SPACE_M), 0, 0);
        card.addView(title);
        // MODEL VISIBILITY LAW: while a card runs on a non-default model, the
        // model name is always on the card so the user can trust what is running.
        final String modelTag = cardModelTag(task);
        if (modelTag != null) {
            String shortName = modelTag.startsWith("zai-metered-api/")
                    ? "METERED " + modelTag.substring("zai-metered-api/".length())
                    : modelTag;
            TextView modelPill = (TextView) pillButton("\u26a1 " + shortName, COLOR_PURPLE, COLOR_PURPLE_DIM);
            modelPill.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_MICRO);
            LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            mp.topMargin = dp(SPACE_XS);
            modelPill.setLayoutParams(mp);
            card.addView(modelPill);
        }

        card.addView(buildUpdateBox(task, journal));
        card.addView(buildDetailArea(task, journal));
        card.addView(buildAttachmentsRow(task));

        ViewGroup actions = new FlowLayout(this);
        if (task.completed) {
            actions.addView(cardAction("Reopen", COLOR_AMBER, COLOR_AMBER_DIM,
                    view -> {
                        mutate("Session reopened", state -> {
                            DaymarkWorkspaceClient.setTaskCompleted(state, task.id, false);
                            return null;
                        });
                        final String rKey = syncKey;
                        final String rId = task.id;
                        networkExecutor.execute(() -> {
                            try { DaymarkWorkspaceClient.toggleCompletionApi(rKey, rId, false); }
                            catch (Exception re) { Log.w("DaymarkAi", "reopen endpoint: " + re.getMessage()); }
                        });
                    }));
            actions.addView(cardAction("Retry", COLOR_GREEN, COLOR_GREEN_DIM,
                    view -> showRetryDialog(task)));
            // Model override is selectable from EVERY tab, Finished included.
            actions.addView(cardAction("Model", COLOR_PURPLE, COLOR_PURPLE_DIM,
                    view -> showModelDialog(task)));
            actions.addView(cardAction("Message", COLOR_BLUE, COLOR_BLUE_DIM,
                    view -> showMessageDialog(task)));
        } else {
            actions.addView(cardAction("Complete", COLOR_GREEN, COLOR_GREEN_DIM,
                    view -> {
                        mutate("Session completed", state -> {
                            DaymarkWorkspaceClient.setTaskCompleted(state, task.id, true);
                            return null;
                        });
                        // ZERO-DELAY: one tiny agent PATCH moves the card out of
                        // In Progress on the server in <1s; the PC bridge then
                        // terminates the session tree on its next 3s poll.
                        final String stamp2 = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                                .format(new java.util.Date());
                        final String finishedId = finishedSectionIds.isEmpty()
                                ? "section-7f2adc429cd4a01046f1415d" : finishedSectionIds.iterator().next();
                        final String syncKey2 = syncKey;
                        final String taskId2 = task.id;
                        final String syncKey3 = syncKey;
                        final String taskId3 = task.id;
                        networkExecutor.execute(() -> {
                            try { DaymarkWorkspaceClient.toggleCompletionApi(syncKey3, taskId3, true); }
                            catch (Exception ce) { Log.w("DaymarkAi", "complete endpoint: " + ce.getMessage()); }
                            for (int attempt = 0; attempt < 8; attempt++) {
                                try {
                                    DaymarkWorkspaceClient.forceComplete(syncKey2, taskId2, finishedId, stamp2);
                                    mainHandler.post(() -> refreshNow());
                                    return;
                                } catch (Exception error) {
                                    Log.w("DaymarkAi", "force-complete attempt " + (attempt + 1) + ": " + error.getMessage());
                                    try { Thread.sleep(Math.min(4000L, 300L * (attempt + 1))); } catch (InterruptedException ie) { }
                                }
                            }
                        });
                    }));
            actions.addView(cardAction("Update", COLOR_BLUE, COLOR_BLUE_DIM,
                    view -> showLogUpdateDialog(task)));
            actions.addView(cardAction("Message", COLOR_BLUE, COLOR_BLUE_DIM,
                    view -> showMessageDialog(task)));
            actions.addView(cardAction("Assign session", COLOR_AMBER, COLOR_AMBER_DIM,
                    view -> mutate("Session assigned \u00b7 pinned to In Progress",
                            state -> {
                                DaymarkWorkspaceClient.assignSession(state, task.id);
                                return null;
                            })));
            if (todoSectionIds.contains(task.sectionId)) {
                // Per-task AUTO exclusion: excluded tasks are never picked by
                // the AUTO runner; manual Assign still works.
                actions.addView(cardAction(autoExcluded.contains(task.id)
                                ? "\u2713 AUTO excluded" : "\u26d4 Exclude AUTO",
                        COLOR_GRAY, COLOR_GRAY_DIM,
                        view -> toggleAutoExcluded(task)));
            }
            if (todoSectionIds.contains(task.sectionId)
                    || progressSectionIds.contains(task.sectionId)) {
                // Ordering on EVERY tab that shows an ordered list (To do AND
                // In Progress; Finished stays newest-first and offers none):
                // type the position number to switch to — the swap lands in
                // ONE verified push, always correct, under 2 seconds.
                actions.addView(cardAction("# Order", COLOR_GRAY, COLOR_GRAY_DIM,
                        view -> showTodoOrderDialog(task)));
            }
            actions.addView(pauseResumeAction(task, paused));
            // Per-task model override (MODEL chip dialog, task context): the
            // chosen id is stored locally and sent to the PC bridge as an
            // "— ORDER HH:MM — model: <id>" line on the task.
            actions.addView(cardAction("Model", COLOR_PURPLE, COLOR_PURPLE_DIM,
                    view -> showModelDialog(task)));
        }
        actions.addView(cardAction("Agents", COLOR_BLUE, COLOR_BLUE_DIM,
                view -> showAgentsDialog(task)));
        actions.addView(cardAction("Add step", COLOR_BLUE, COLOR_BLUE_DIM,
                view -> showAddStepDialog(task)));
        // Add images directly to this task from any tab (user demand).
        actions.addView(cardAction("Image", COLOR_GREEN, COLOR_GREEN_DIM,
                view -> pickImagesForTask(task)));
        // Hand button wire format (must stay in sync with DaymarkWorkspaceClient.buildOrderLine("hand")):
        // — ORDER HH:MM — hand: stop whatever you are doing right now and run /handoff immediately
        actions.addView(cardAction("Hand", COLOR_PURPLE, COLOR_PURPLE_DIM,
                view -> handParkTask(task)));
        actions.addView(cardAction("Edit", COLOR_GRAY, COLOR_GRAY_DIM, view -> showEditDialog(task)));
        actions.addView(cardAction("Move", COLOR_GRAY, COLOR_GRAY_DIM, view -> showMoveDialog(task)));
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actionParams.topMargin = dp(SPACE_L);
        card.addView(actions, actionParams);
        // WRAP_CONTENT is load-bearing here: a GridView item is measured with
        // AT_MOST, and a MATCH_PARENT child resolves to the full viewport height,
        // clipping the attachments + action buttons out of the card entirely.
        shell.addView(card, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return shell;
    }

    /** 4dp left accent stripe; color mirrors the session state. */
    private View cardAccentStripe(DaymarkWorkspaceClient.TaskInfo task,
            SessionUpdateParser.Result journal, long now) {
        int color;
        if (task.completed) {
            color = withAlpha(COLOR_ACCENT, 0x99);              // finished: muted teal
        } else if (journal.latest != null
                && now - journal.latest.timeMillis < ACTIVE_WINDOW_MS) {
            color = COLOR_GREEN;                                 // in progress: lively green
        } else {
            color = COLOR_GRAY;                                  // to do / stalled: slate
        }
        View stripe = new View(this);
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadii(new float[] {
                dpF(1.5f), dpF(1.5f), 0f, 0f, 0f, 0f, dpF(1.5f), dpF(1.5f)});
        background.setColor(color);
        stripe.setBackground(background);
        stripe.setLayoutParams(new FrameLayout.LayoutParams(
                dp(3), ViewGroup.LayoutParams.MATCH_PARENT));
        return stripe;
    }

    private LinearLayout buildCardTopRow(DaymarkWorkspaceClient.TaskInfo task,
            SessionUpdateParser.Result journal, long now, boolean paused) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        row.addView(statusPill(task, journal, now));

        if (paused) {
            TextView pausedPill = (TextView) pillButton("PAUSED", COLOR_AMBER, COLOR_AMBER_DIM);
            pausedPill.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            LinearLayout.LayoutParams pausedParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            pausedParams.leftMargin = dp(6);
            row.addView(pausedPill, pausedParams);
        }

        // AUTO-excluded marker: the user took this task out of the auto-runner.
        if (!task.completed && autoExcluded.contains(task.id)) {
            TextView excludedPill = (TextView) pillButton("AUTO \u26d4",
                    COLOR_GRAY, COLOR_GRAY_DIM);
            excludedPill.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            LinearLayout.LayoutParams excludedParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            excludedParams.leftMargin = dp(6);
            row.addView(excludedPill, excludedParams);
        }

        // LIVE AGENT COUNT (user demand, absolute): EVERY running card shows
        // the count in red at all times — newest parsed count, 0 when none.
        if (!task.completed) {
            LinearLayout agents = agentsPill(journal.agentsCount != null ? journal.agentsCount : 0);
            LinearLayout.LayoutParams agentsParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            agentsParams.leftMargin = dp(6);
            row.addView(agents, agentsParams);
        }

        PendingMessage pending = pendingMessages.get(task.id);
        if (pending != null) {
            long waiting = Math.max(0L, System.currentTimeMillis() - pending.sentAt);
            TextView awaiting = (TextView) pillButton(
                    "awaiting AI reply \u00b7 " + countdown(waiting),
                    COLOR_AMBER, COLOR_AMBER_DIM);
            awaiting.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            LinearLayout.LayoutParams awaitingParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            awaitingParams.leftMargin = dp(6);
            row.addView(awaiting, awaitingParams);
        }

        TextView age = !task.completed ? ageChip(journal, now) : null;
        if (age != null) {
            LinearLayout.LayoutParams ageParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            ageParams.leftMargin = dp(6);
            row.addView(age, ageParams);
        }

        if (task.pinned) {
            TextView pinned = (TextView) pillButton("PINNED", COLOR_AMBER, COLOR_AMBER_DIM);
            pinned.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            LinearLayout.LayoutParams pinnedParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            pinnedParams.leftMargin = dp(6);
            row.addView(pinned, pinnedParams);
        }

        TextView priority = (TextView) pillButton(
                "P" + task.priority + " " + priorityLabel(task.priority),
                priorityColor(task.priority), priorityDim(task.priority));
        priority.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        LinearLayout.LayoutParams priorityParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        priorityParams.leftMargin = dp(6);
        row.addView(priority, priorityParams);

        if (savingIds.contains(task.id)) {
            TextView saving = (TextView) pillButton("SAVING\u2026", COLOR_GRAY, COLOR_GRAY_DIM);
            LinearLayout.LayoutParams savingParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            savingParams.leftMargin = dp(6);
            row.addView(saving, savingParams);
        }

        TextView updated = new TextView(this);
        long reference = journal.latest != null ? journal.latest.timeMillis : task.updatedAtMillis;
        updated.setText(SessionUpdateParser.relativeTime(reference, now));
        updated.setTextColor(COLOR_TEXT_DIM);
        updated.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams updatedParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        updatedParams.leftMargin = dp(8);
        updated.setGravity(Gravity.END);
        row.addView(updated, updatedParams);

        // Destructive: danger-colored hairline outline, no fill.
        TextView delete = (TextView) pillButton("\u2715", COLOR_RED, Color.TRANSPARENT);
        delete.setContentDescription("Delete session " + task.content);
        // The delete glyph is one character wide; widen the tap area so the
        // pill still meets the 48dp minimum touch target.
        delete.setMinWidth(dp(48));
        delete.setOnClickListener(view -> commitTaskDelete(task.id, task.raw));
        LinearLayout.LayoutParams deleteParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        deleteParams.leftMargin = dp(8);
        row.addView(delete, deleteParams);
        return row;
    }

    private TextView statusPill(DaymarkWorkspaceClient.TaskInfo task,
            SessionUpdateParser.Result journal, long now) {
        String label;
        int color;
        int dim;
        if (task.completed) {
            label = "DONE";
            color = COLOR_GRAY;
            dim = COLOR_GRAY_DIM;
        } else if (journal.latest != null
                && now - journal.latest.timeMillis < ACTIVE_WINDOW_MS) {
            label = "IN PROGRESS";
            color = COLOR_GREEN;
            dim = COLOR_GREEN_DIM;
        } else if (journal.latest != null) {
            label = "STALLED";
            color = COLOR_AMBER;
            dim = COLOR_AMBER_DIM;
        } else {
            label = "QUEUED";
            color = COLOR_BLUE;
            dim = COLOR_BLUE_DIM;
        }
        TextView pill = (TextView) pillButton(label, color, dim);
        pill.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return pill;
    }

    /** True when the newest journal line (below any "— pinned —" marker) is a PAUSED marker. */
    private boolean isTaskPaused(DaymarkWorkspaceClient.TaskInfo task) {
        String description = task.description;
        if (description == null) return false;
        // Same rule as the PC relay: the NEWEST PAUSED-vs-RESUMED marker wins.
        // Session updates or machine lines prepended above a PAUSED marker must
        // not flip the card back to running — only a RESUMED click does.
        java.util.regex.Pattern marker =
                java.util.regex.Pattern.compile("\u2014\\s*(PAUSED|RESUMED)\\s+(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*\u2014");
        for (String line : description.split("\n")) {
            java.util.regex.Matcher m = marker.matcher(line);
            if (m.find()) return "PAUSED".equals(m.group(1));
        }
        return false;
    }

    /**
     * Quiet icon toggle for running sessions: prepends a "\u2014 PAUSED/RESUMED HH:MM \u2014"
     * journal line via the client, optimistically flipping the card first.
     */
    private View pauseResumeAction(final DaymarkWorkspaceClient.TaskInfo task, boolean paused) {
        ImageView button = new ImageView(this);
        button.setImageResource(paused
                ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause);
        button.setColorFilter(paused ? COLOR_GREEN : COLOR_GRAY);
        button.setContentDescription(paused ? "Resume session" : "Pause session");
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(16));
        background.setColor(paused ? COLOR_GREEN_DIM : COLOR_GRAY_DIM);
        background.setStroke(dp(1), withAlpha(paused ? COLOR_GREEN : COLOR_GRAY, 0x55));
        button.setBackground(rippleOver(background, paused ? COLOR_GREEN : COLOR_GRAY, 16f));
        button.setPadding(dp(13), dp(13), dp(13), dp(13));
        button.setOnClickListener(view -> togglePauseResume(task));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.rightMargin = dp(8);
        button.setLayoutParams(params);
        return button;
    }

    private void togglePauseResume(final DaymarkWorkspaceClient.TaskInfo task) {
        boolean currentlyPaused = isTaskPaused(task);
        String marker = currentlyPaused ? "RESUMED" : "PAUSED";
        String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                .format(new java.util.Date());
        final String line = "\u2014 " + marker + " " + stamp + " \u2014";
        // Optimistic flip: show the new journal line on the card immediately.
        try {
            JSONObject optimistic = new JSONObject(task.raw.toString());
            String existing = optimistic.optString("description", "");
            optimistic.put("description", existing.isEmpty() ? line : line + "\n" + existing);
            optimistic.put("updatedAt", DaymarkWorkspaceClient.nowIso());
            applyOptimisticView(task.id, optimistic, false);
        } catch (JSONException error) {
            Log.w("DaymarkAi", "pause/resume optimistic view failed: " + error.getMessage());
        }
        final boolean resuming = currentlyPaused;
        networkExecutor.execute(() -> {
            try {
                DaymarkWorkspaceClient.prependJournalLine(syncKey, task.id, line);
                refreshNow();
            } catch (Exception error) {
                mainHandler.post(() -> {
                    Toast.makeText(this, "Could not " + (resuming ? "resume" : "pause")
                            + " session: " + error.getMessage(), Toast.LENGTH_SHORT).show();
                    refreshNow();
                });
            }
        });
    }

    /**
     * Freshness chip on running cards, mirroring AIControlPanel: green under 5m,
     * amber 5-10m, red past 10m, neutral when no journal update exists yet.
     * Journal stamps are wall-clock HH:MM, so a small negative age is a midnight
     * wrap and gets 24h added back.
     */
    /** Newest "model: <id>" token from the journal (newest line first), or null. */
    private static String taskModelId(DaymarkWorkspaceClient.TaskInfo task) {
        if (task == null || task.description == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\\u2014\\s*ORDER[^\\n]*\\bmodel:\\s*([A-Za-z0-9._:/-]+)")
                .matcher(task.description);
        if (!m.find()) return null;
        final String id = m.group(1);
        return ("default".equals(id) || DEFAULT_MODEL.equals(id)) ? null : id;
    }

    private TextView ageChip(SessionUpdateParser.Result journal, long now) {
        boolean neutral = journal.latest == null;
        long ageMillis = 0;
        if (!neutral) {
            ageMillis = now - journal.latest.timeMillis;
            if (ageMillis < -60000L) ageMillis += 24L * 60L * 60L * 1000L;
            if (ageMillis < 0) ageMillis = 0;
        }
        long minutes = ageMillis / 60000L;
        int color;
        int dim;
        String label;
        if (neutral) {
            color = COLOR_GRAY;
            dim = COLOR_GRAY_DIM;
            label = "no updates yet";
        } else if (minutes < 5) {
            color = COLOR_GREEN;
            dim = COLOR_GREEN_DIM;
            label = minutes < 1 ? "<1m" : minutes + "m";
        } else if (minutes <= 10) {
            color = COLOR_AMBER;
            dim = COLOR_AMBER_DIM;
            label = minutes + "m";
        } else {
            color = COLOR_RED;
            dim = COLOR_RED_DIM;
            label = minutes + "m";
        }
        TextView chip = (TextView) pillButton(label, color, dim);
        chip.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return chip;
    }

    private View buildUpdateBox(DaymarkWorkspaceClient.TaskInfo task, SessionUpdateParser.Result journal) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable background = roundedBg(0, 10, 0, 0);

        TextView kind = new TextView(this);
        kind.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_CAPTION);
        kind.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        TextView message = new TextView(this);
        // The newest journal line is the visual hero: slightly larger, full-bright.
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_BODY);
        message.setLineSpacing(0f, 1.4f);
        // Fixed hero line count: the status never re-wraps/jitters between
        // refreshes; the full text stays reachable via the Full details toggle.
        message.setMaxLines(4);
        message.setEllipsize(TextUtils.TruncateAt.END);

        // HERO SELECTION (user demand: never show machine gibberish as the card's
        // status): prefer the newest SESSION-authored line (update/ack/reopened);
        // only fall back to a machine line (heartbeat/ORDER nudge) when the
        // session has not written anything yet. When the hero is a machine line
        // but a real session line exists below it, show the machine line as a
        // small muted "system" note UNDER the hero, never instead of it.
        SessionUpdateParser.Entry hero = journal.latestSession != null
                ? journal.latestSession
                : (journal.latestAgent != null ? journal.latestAgent : journal.latest);
        SessionUpdateParser.Entry systemNote = (journal.latestSession != null
                && journal.latest != null && journal.latest.machine)
                        ? journal.latest : null;

        if (hero != null) {
            int color;
            int dim;
            String label;
            switch (hero.kind) {
                case "heartbeat":
                    color = COLOR_GRAY;
                    dim = COLOR_GRAY_DIM;
                    label = "HEARTBEAT";
                    break;
                case "ack":
                    // REPLY IN RED (user demand): every direct reply to a
                    // message renders red so the user instantly sees the
                    // session is answering THEM, even mid-progress.
                    color = COLOR_RED;
                    dim = COLOR_RED_DIM;
                    label = "REPLY";
                    break;
                case "reopened":
                    color = COLOR_AMBER;
                    dim = COLOR_AMBER_DIM;
                    label = "REOPENED";
                    break;
                case "progress":
                    color = COLOR_GREEN;
                    dim = COLOR_GREEN_DIM;
                    label = "PROGRESS";
                    break;
                case "message":
                    color = COLOR_BLUE;
                    dim = COLOR_BLUE_DIM;
                    label = "MESSAGE";
                    break;
                case "order":
                    color = COLOR_AMBER;
                    dim = COLOR_AMBER_DIM;
                    label = "ORDER";
                    break;
                default:
                    color = COLOR_GREEN;
                    dim = COLOR_GREEN_DIM;
                    label = "UPDATE";
                    break;
            }
            // AGENTS RECEIPT IN RED (user demand, absolute): an ack/update that
            // reports created/running sub-agents always renders in red so the
            // user instantly sees the agents demand was executed.
            if (hero.message != null
                    && (hero.message.matches(".*(created|launched|spawning)\\s+(?:exactly\\s+)?\\d+\\s+(?:sub-?\\s*)?agents.*")
                        || hero.message.matches(".*\\d+\\s+(?:sub-?\\s*)?agents\\s+(?:created|running|spawning).*"))) {
                color = COLOR_RED;
                dim = COLOR_RED_DIM;
                label = "AGENTS RUNNING";
            }
            background.setColor(dim);
            kind.setTextColor(color);
            kind.setText("\u25cf  " + label + "  \u00b7  " + hero.stamp + "  \u00b7  "
                    + SessionUpdateParser.relativeTime(hero.timeMillis,
                            System.currentTimeMillis()));
            message.setTextColor(withAlpha(COLOR_TEXT, 0xE6));
            message.setText(hero.message.isEmpty()
                    ? "(no message \u2014 agent is alive and polling)"
                    : hero.message);
            if (systemNote != null) {
                TextView system = new TextView(this);
                system.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_MICRO);
                system.setTextColor(COLOR_TEXT_DIM);
                system.setMaxLines(2);
                system.setPadding(0, dp(4), 0, 0);
                system.setText("\u2699 system " + systemNote.stamp + " \u00b7 "
                        + (systemNote.message.isEmpty() ? "watchdog active" : systemNote.message));
                box.addView(system);
            }
        } else {
            background.setColor(COLOR_SURFACE);
            kind.setTextColor(COLOR_TEXT_DIM);
            kind.setText("NO UPDATES LOGGED");
            String preview = task.description == null ? "" : task.description.trim();
            message.setTextColor(COLOR_TEXT_DIM);
            message.setText(preview.isEmpty() ? "Waiting for the first agent update." : preview);
            message.setMaxLines(2);
        }
        box.addView(kind);
        box.addView(message, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(10);
        box.setLayoutParams(params);
        return box;
    }

    private View buildDetailArea(DaymarkWorkspaceClient.TaskInfo task,
            SessionUpdateParser.Result journal) {
        LinearLayout area = new LinearLayout(this);
        area.setOrientation(LinearLayout.VERTICAL);
        boolean expanded = expandedTaskIds.contains(task.id);

        TextView meta = new TextView(this);
        meta.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        meta.setTextColor(COLOR_TEXT_DIM);
        meta.setPadding(0, dp(8), 0, 0);
        List<String> bits = new ArrayList<>();
        bits.add(journal.markerCount > 1 ? "+ " + (journal.markerCount - 1) + " earlier updates" : null);
        bits.add(journal.plainBody.isEmpty() ? null : "Full details \u25be");
        bits.removeAll(Collections.singleton(null));
        meta.setText(TextUtils.join("   \u00b7   ", bits));
        meta.setVisibility(bits.isEmpty() ? View.GONE : View.VISIBLE);
        area.addView(meta);

        // Expanded view: one row per journal line, color-coded by marker type with
        // relative stamps; the newest line is slightly larger and brighter.
        LinearLayout full = new LinearLayout(this);
        full.setOrientation(LinearLayout.VERTICAL);
        full.setPadding(dp(12), dp(8), dp(12), dp(4));
        full.setBackground(roundedBg(COLOR_SURFACE, 12, 0, 0));
        full.setVisibility(expanded ? View.VISIBLE : View.GONE);
        if (expanded) {
            String description = task.description == null ? "" : task.description;
            String[] lines = description.isEmpty()
                    ? new String[] {"(empty description)"} : description.split("\n", -1);
            int newest = 0;
            for (int index = 0; index < lines.length; index += 1) {
                if (JOURNAL_MARKER_LINE.matcher(lines[index]).find()) {
                    newest = index;
                    break;
                }
            }
            int renderLimit = 60;
            for (int index = 0; index < lines.length && index < renderLimit; index += 1) {
                full.addView(journalLine(lines[index], index == newest));
            }
            if (lines.length > renderLimit) {
                TextView more = new TextView(this);
                more.setText("\u22ee " + (lines.length - renderLimit) + " earlier lines");
                more.setTextColor(COLOR_TEXT_DIM);
                more.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                more.setPadding(0, dp(2), 0, dp(2));
                full.addView(more);
            }
            area.addView(full, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        return area;
    }

    /**
     * One expanded-journal line: colored dot + type tint ("\u2014 update" green,
     * "\u2014 message" blue, "\u2014 ORDER" amber, "\u2014 ack" purple,
     * "\u2014 heartbeat" slate, "\u2014 pinned" gray), the first HH:MM annotated
     * with its relative age, and the newest line emphasized.
     */
    private TextView journalLine(String line, boolean newest) {
        TextView view = new TextView(this);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, newest ? 14f : 12.5f);
        view.setLineSpacing(0f, 1.35f);
        String trimmed = line.trim();
        String lower = trimmed.toLowerCase(Locale.US);
        int color;
        boolean plain = false;
        String dot = "";
        if (lower.startsWith("\u2014 update")) {
            color = COLOR_GREEN;
            dot = "\u25cf ";
        } else if (lower.startsWith("\u2014 message")) {
            color = COLOR_BLUE;
            dot = "\u25cf ";
        } else if (lower.startsWith("\u2014 order")) {
            color = COLOR_AMBER;
            dot = "\u25cf ";
        } else if (lower.startsWith("\u2014 ack")) {
            color = COLOR_PURPLE;
            dot = "\u25cf ";
        } else if (lower.startsWith("\u2014 heartbeat")) {
            color = COLOR_GRAY;
            dot = "\u25cf ";
        } else if (lower.startsWith("\u2014 pinned") || lower.startsWith("- pinned")) {
            color = COLOR_GRAY;
        } else {
            color = COLOR_TEXT_DIM;
            plain = true;
        }
        // Newest line pops (full tint, brighter for plain prose); older lines recede.
        view.setTextColor(newest ? (plain ? COLOR_TEXT : color) : withAlpha(color, 0x9E));
        String text = trimmed.isEmpty() ? " " : annotateStamp(trimmed);
        view.setText(dot.isEmpty() ? text : dot + text);
        return view;
    }

    /** Appends "\u00b7 2m ago" right after the first HH:MM stamp in a journal line. */
    private String annotateStamp(String line) {
        java.util.regex.Matcher matcher = TIME_STAMP.matcher(line);
        if (!matcher.find()) return line;
        long resolved = resolveStampMillis(matcher.group());
        return line.substring(0, matcher.end()) + "  \u00b7  "
                + SessionUpdateParser.relativeTime(resolved, System.currentTimeMillis())
                + line.substring(matcher.end());
    }

    /** Wall-clock HH:MM anchored to today; a stamp "in the future" is yesterday's. */
    private static long resolveStampMillis(String stamp) {
        int colon = stamp.indexOf(':');
        java.util.Calendar resolved = java.util.Calendar.getInstance();
        resolved.set(java.util.Calendar.HOUR_OF_DAY, Integer.parseInt(stamp.substring(0, colon)));
        resolved.set(java.util.Calendar.MINUTE, Integer.parseInt(stamp.substring(colon + 1)));
        resolved.set(java.util.Calendar.SECOND, 0);
        resolved.set(java.util.Calendar.MILLISECOND, 0);
        if (resolved.getTimeInMillis() > System.currentTimeMillis() + 60_000L) {
            resolved.add(java.util.Calendar.DAY_OF_YEAR, -1);
        }
        return resolved.getTimeInMillis();
    }

    // ---- Attachments ----

    /** Image thumbnails / file chips for a task's attachments; absent field renders nothing. */
    private View buildAttachmentsRow(final DaymarkWorkspaceClient.TaskInfo task) {
        final List<DaymarkWorkspaceClient.TaskInfo.Attachment> attachments =
                DaymarkWorkspaceClient.TaskInfo.attachmentsOf(task.attachments);
        if (attachments.isEmpty()) return new View(this);
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (final DaymarkWorkspaceClient.TaskInfo.Attachment attachment : attachments) {
            View chip = attachment.isImage()
                    ? attachmentThumbChip(attachment)
                    : attachmentFileChip(attachment);
            chip.setOnClickListener(view -> openAttachment(attachment, chip));
            row.addView(chip);
            LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) chip.getLayoutParams();
            params.rightMargin = dp(8);
        }
        scroll.addView(row);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        scrollParams.topMargin = dp(8);
        scroll.setLayoutParams(scrollParams);
        return scroll;
    }

    private View attachmentThumbChip(final DaymarkWorkspaceClient.TaskInfo.Attachment attachment) {
        final ImageView thumb = new ImageView(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(72), dp(72));
        thumb.setLayoutParams(params);
        thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        thumb.setContentDescription(attachment.name);
        thumb.setBackground(roundedBg(COLOR_SURFACE, (int) RADIUS_INNER, COLOR_STROKE, 1));
        thumb.setClipToOutline(true);
        Bitmap cached = thumbnailCache.get(attachment.id);
        if (cached != null) {
            thumb.setImageBitmap(cached);
            return thumb;
        }
        thumb.post(() -> loadThumbnail(attachment, thumb));
        return thumb;
    }

    private void loadThumbnail(final DaymarkWorkspaceClient.TaskInfo.Attachment attachment,
            final ImageView thumb) {
        final Bitmap cached = thumbnailCache.get(attachment.id);
        if (cached != null) {
            thumb.setImageBitmap(cached);
            return;
        }
        synchronized (thumbnailInFlight) {
            if (!thumbnailInFlight.add(attachment.id)) return;
        }
        networkExecutor.execute(() -> {
            Bitmap bitmap = null;
            try {
                byte[] bytes = DaymarkWorkspaceClient.fetchAttachment(this, attachment.id);
                if (bytes != null) {
                    bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                }
            } catch (IOException error) {
                Log.w("DaymarkAi", "attachment thumbnail failed: " + error.getMessage());
            }
            synchronized (thumbnailInFlight) {
                thumbnailInFlight.remove(attachment.id);
            }
            if (bitmap != null) thumbnailCache.put(attachment.id, bitmap);
            final Bitmap result = bitmap;
            mainHandler.post(() -> {
                if (result != null && thumb.isAttachedToWindow()) {
                    thumb.setImageBitmap(result);
                }
            });
        });
    }

    private View attachmentFileChip(final DaymarkWorkspaceClient.TaskInfo.Attachment attachment) {
        TextView chip = (TextView) pillButton(
                attachment.name + "  \u00b7  " + formatSize(attachment.size),
                COLOR_BLUE, COLOR_BLUE_DIM);
        chip.setMaxWidth(dp(220));
        chip.setSingleLine(true);
        chip.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        chip.setContentDescription("Download " + attachment.name);
        return chip;
    }

    /** Downloads on the network thread, saves to Downloads, then opens with a viewer. */
    private void openAttachment(final DaymarkWorkspaceClient.TaskInfo.Attachment attachment,
            final View chip) {
        chip.setEnabled(false);
        chip.setAlpha(0.5f);
        networkExecutor.execute(() -> {
            boolean failed = false;
            boolean missing = false;
            byte[] bytes = null;
            try {
                bytes = DaymarkWorkspaceClient.fetchAttachment(this, attachment.id);
                missing = bytes == null;
            } catch (IOException error) {
                failed = true;
                Log.w("DaymarkAi", "attachment download failed: " + error.getMessage());
            }
            final boolean downloadFailed = failed;
            final boolean notFound = missing;
            final byte[] payload = bytes;
            mainHandler.post(() -> {
                chip.setEnabled(true);
                chip.setAlpha(1f);
                if (downloadFailed) {
                    Toast.makeText(this, "Attachment could not be downloaded.", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (notFound) {
                    // The endpoint is gone for this id: hide the entry, never crash.
                    ViewGroup parent = (ViewGroup) chip.getParent();
                    if (parent != null) parent.removeView(chip);
                    Toast.makeText(this, "Attachment no longer exists.", Toast.LENGTH_SHORT).show();
                    return;
                }
                saveAndOpen(attachment, payload);
            });
        });
    }

    private void saveAndOpen(DaymarkWorkspaceClient.TaskInfo.Attachment attachment, byte[] bytes) {
        String fileName = attachment.name == null || attachment.name.trim().isEmpty()
                ? "daymark-attachment" : attachment.name.trim();
        try {
            Uri uri = saveToDownloads(fileName, attachment.mimeType, bytes);
            if (uri == null) {
                Toast.makeText(this, "Saved attachment locally.", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, attachment.mimeType == null
                    ? "application/octet-stream" : attachment.mimeType);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(view);
            } catch (RuntimeException noViewer) {
                Toast.makeText(this, "Saved to Downloads (no viewer for this type).",
                        Toast.LENGTH_SHORT).show();
            }
        } catch (IOException error) {
            Toast.makeText(this, "Could not save attachment.", Toast.LENGTH_SHORT).show();
        }
    }

    /** MediaStore Downloads on API 29+; app-external fallback for older devices. */
    private Uri saveToDownloads(String fileName, String mimeType, byte[] bytes) throws IOException {
        String type = mimeType == null || mimeType.isEmpty()
                ? "application/octet-stream" : mimeType;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, type);
            Uri uri = getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return null;
            try (FileOutputStream output = (FileOutputStream) getContentResolver()
                    .openOutputStream(uri)) {
                if (output == null) throw new IOException("No output stream for " + uri);
                output.write(bytes);
            }
            return uri;
        }
        File dir = getExternalFilesDir(null);
        if (dir == null) return null;
        // The name arrives over sync and must never carry path structure.
        String baseName = fileName.replaceAll("[\\\\/]", "_").trim();
        if (baseName.isEmpty() || ".".equals(baseName) || "..".equals(baseName)) {
            baseName = "attachment";
        }
        File target = new File(new File(dir, "attachments"), baseName);
        //noinspection ResultOfMethodCallIgnored
        target.getParentFile().mkdirs();
        try (FileOutputStream output = new FileOutputStream(target)) {
            output.write(bytes);
        }
        return null;
    }

    private static String formatSize(long size) {
        if (size < 0) return "?";
        if (size < 1024) return size + " B";
        if (size < 1024 * 1024) return String.format(Locale.US, "%.1f KB", size / 1024d);
        return String.format(Locale.US, "%.1f MB", size / (1024d * 1024d));
    }

    private TextView cardAction(String label, int color, int dimColor, View.OnClickListener listener) {
        TextView button = (TextView) pillButton(label, COLOR_TEXT, COLOR_SURFACE);
        button.setOnClickListener(listener);
        ViewGroup.MarginLayoutParams params = new ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.rightMargin = dp(8);
        params.bottomMargin = dp(8);
        button.setLayoutParams(params);
        return button;
    }

    private TextView pillButton(String label, int color, int dimColor) {
        TextView pill = new TextView(this);
        pill.setText(label);
        pill.setTextColor(color);
        pill.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_CAPTION);
        pill.setGravity(Gravity.CENTER);
        pill.setMaxLines(1);
        pill.setEllipsize(TextUtils.TruncateAt.END);
        pill.setFontFeatureSettings("tnum");
        // Minimum touch target: every pill (chips, card actions, refresh,
        // delete, status pills) stays comfortably tappable on small screens.
        pill.setMinimumHeight(dp(TOUCH_MIN_DP));
        pill.setBackground(rippleRounded(dimColor, 999, withAlpha(color, 0x55), 1, color));
        pill.setPadding(dp(SPACE_M), dp(SPACE_XS), dp(SPACE_M), dp(SPACE_XS));
        return pill;
    }

    /** One row in a card's action overflow sheet: label, tint, existing listener. */
    private static class OverflowAction {
        final String label;
        final int color;
        final View.OnClickListener listener;
        OverflowAction(String label, int color, View.OnClickListener listener) {
            this.label = label;
            this.color = color;
            this.listener = listener;
        }
    }

    /**
     * Bottom-sheet style overflow: the task title (one line) plus one full-width
     * 52dp row per action. Tapping a row fires the SAME listener the inline pill
     * fired before the redesign, then dismisses. Pure presentation.
     */
    private void showActionsOverflow(String taskTitle, java.util.List<OverflowAction> actions) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        for (int index = 0; index < actions.size(); index += 1) {
            final OverflowAction action = actions.get(index);
            if (index > 0) {
                View divider = new View(this);
                divider.setBackgroundColor(COLOR_STROKE);
                list.addView(divider, new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1))));
            }
            TextView row = new TextView(this);
            row.setText(action.label);
            row.setTextColor(action.color == COLOR_RED ? COLOR_RED : COLOR_TEXT);
            row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            row.setMinHeight(dp(52));
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(20), 0, dp(20), 0);
            row.setBackground(rippleRounded(Color.TRANSPARENT, 0, 0, 0, COLOR_TEXT));
            row.setOnClickListener(view -> {
                action.listener.onClick(view);
            });
            list.addView(row);
        }
        scroll.addView(list, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(taskTitle)
                .setView(scroll)
                .setNegativeButton("Close", null)
                .create();
        dialog.show();
        chromeDialogSurface(dialog);
        styleDialogButtons(dialog);
    }

    /** Borderless quiet text button for the header pill row (model / Diary / Refresh). */
    private void styleQuietHeaderTextButton(TextView button) {
        button.setTextColor(COLOR_TEXT_DIM);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setBackground(rippleRounded(Color.TRANSPARENT, 999, 0, 0, COLOR_TEXT_DIM));
        button.setPadding(dp(12), dp(10), dp(12), dp(10));
    }

    private int priorityColor(int priority) {
        switch (priority) {
            case 1: return COLOR_RED;
            case 2: return COLOR_AMBER;
            case 3: return COLOR_BLUE;
            default: return COLOR_GRAY;
        }
    }

    private int priorityDim(int priority) {
        switch (priority) {
            case 1: return COLOR_RED_DIM;
            case 2: return COLOR_AMBER_DIM;
            case 3: return COLOR_BLUE_DIM;
            default: return COLOR_GRAY_DIM;
        }
    }

    private String priorityLabel(int priority) {
        switch (priority) {
            case 1: return "Urgent";
            case 2: return "High";
            case 3: return "Medium";
            default: return "Low";
        }
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    private int dp(int value) {
        return dpF(value);
    }

    private int dpF(float value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /** Shared rounded surface: fill + optional hairline stroke, radius in dp. */
    private GradientDrawable roundedBg(int fillColor, float radiusDp, int strokeColor, float strokeWdp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(dpF(radiusDp));
        drawable.setColor(fillColor);
        if (strokeWdp > 0) drawable.setStroke(dpF(strokeWdp), strokeColor);
        return drawable;
    }

    /** Rounded fill wrapped in a press ripple tinted with the pill's own color. */
    private RippleDrawable rippleRounded(int fillColor, float radiusDp,
            int strokeColor, float strokeWdp, int rippleTint) {
        GradientDrawable mask = roundedBg(0xFFFFFFFF, radiusDp, 0, 0);
        return new RippleDrawable(ColorStateList.valueOf(withAlpha(rippleTint, 0x42)),
                roundedBg(fillColor, radiusDp, strokeColor, strokeWdp), mask);
    }

    /** Wraps any drawable in a press ripple with a rounded mask of the same radius. */
    private RippleDrawable rippleOver(android.graphics.drawable.Drawable base,
            int rippleTint, float maskRadiusDp) {
        GradientDrawable mask = roundedBg(0xFFFFFFFF, maskRadiusDp, 0, 0);
        return new RippleDrawable(ColorStateList.valueOf(withAlpha(rippleTint, 0x33)), base, mask);
    }

    /** False when the user disabled animations system-wide (animator duration scale 0). */
    private boolean animationsEnabled() {
        try {
            return android.provider.Settings.Global.getFloat(getContentResolver(),
                    android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f;
        } catch (RuntimeException unavailable) {
            return true;
        }
    }

    /** "\u00f0 N agents" pill with a subtle pulsing live dot (skipped when animations are off). */
    /** Live sub-agent counter (user demand: ALWAYS visible in RED, real time). */
    private LinearLayout agentsPill(int count) {
        LinearLayout pill = new LinearLayout(this);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        boolean live = count > 0;
        int tone = live ? COLOR_ACCENT : COLOR_TEXT_DIM;
        int toneDim = live ? COLOR_ACCENT_DIM : 0x149AA6B5;
        pill.setBackground(roundedBg(toneDim, 999, withAlpha(tone, 0x55), 1));
        pill.setPadding(dp(SPACE_M), dp(SPACE_XS), dp(SPACE_M), dp(SPACE_XS));
        pill.setMinimumHeight(dp(28));
        View dot = new View(this);
        GradientDrawable dotBackground = new GradientDrawable();
        dotBackground.setShape(GradientDrawable.OVAL);
        dotBackground.setColor(tone);
        dot.setBackground(dotBackground);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(6), dp(6));
        dotParams.rightMargin = dp(5);
        dot.setLayoutParams(dotParams);
        pill.addView(dot);
        TextView label = new TextView(this);
        label.setText(count + " agents running");
        label.setTextColor(tone);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_CAPTION);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        pill.addView(label);
        if (animationsEnabled()) {
            ValueAnimator pulse = ValueAnimator.ofFloat(1f, 0.25f, 1f);
            pulse.setDuration(2000L);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.addUpdateListener(animation -> dot.setAlpha((Float) animation.getAnimatedValue()));
            pulse.start();
            pill.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
                @Override public void onViewAttachedToWindow(View view) { }
                @Override public void onViewDetachedFromWindow(View view) { pulse.cancel(); }
            });
        }
        return pill;
    }

    // ---- Responsive columns ----

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        grid.post(this::applyResponsiveColumns);
    }

    private void applyResponsiveColumns() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int columns = Math.max(1, Math.min(3, (int) (metrics.widthPixels / (440f * metrics.density))));
        if (grid.getNumColumns() != columns) {
            grid.setNumColumns(columns);
        }
    }

    // ---- Sync loop and data flow ----

    private final Runnable usageTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            renderUsage();
            mainHandler.postDelayed(this, 1_000L);
        }
    };

    private final Runnable uiTick = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            applyResponsiveColumns();
            renderUsage();
            maybeFetchApiBalance();
            checkPendingMessages();
            refreshView.setText(inFlight ? "updating\u2026"
                    : lastRefreshAt == 0L ? "waiting\u2026"
                    : "Updated " + SessionUpdateParser.relativeTime(lastRefreshAt, System.currentTimeMillis()));
            if (adapter != null && !visibleTasks.isEmpty()) {
                adapter.notifyDataSetChanged();
            }
            mainHandler.postDelayed(this, UI_TICK_MS);
        }
    };

    private void syncLoop() {
        Log.i("DaymarkAi", "syncLoop started, running=" + running + ", syncKey=" + syncKey);
        int consecutiveErrors = 0;
        long baseErrorDelay = 1000L;
        long maxErrorDelay = 60_000L;
        
        while (running && !Thread.currentThread().isInterrupted()) {
            String key = syncKey;
            if (key == null) {
                Log.w("DaymarkAi", "syncLoop: syncKey is null");
                postStatus("No workspace paired", COLOR_AMBER);
                sleepQuietly(2_000L);
                continue;
            }
            Log.i("DaymarkAi", "syncLoop: pulling with key=" + key);
            try {
                DaymarkWorkspaceClient.Envelope envelope = DaymarkWorkspaceClient.pull(key);
                Log.i("DaymarkAi", "syncLoop: pull returned, envelope=" + (envelope == null ? "null" : "rev=" + envelope.revision));
                if (envelope == null) {
                    Log.w("DaymarkAi", "syncLoop: envelope is null");
                    postStatus("workspace not initialized yet", COLOR_AMBER);
                    sleepQuietly(3_000L);
                    continue;
                }
                Log.i("DaymarkAi", "syncLoop: got envelope revision=" + envelope.revision);
                publish(envelope, "live");
                consecutiveErrors = 0;
                baseErrorDelay = 1000L;
                while (running && key.equals(syncKey)) {
                    DaymarkWorkspaceClient.Envelope change =
                            DaymarkWorkspaceClient.waitForChange(key, publishedRevision);
                    if (change != null) {
                        publish(change, "live");
                    }
                }
            } catch (DaymarkWorkspaceClient.ConflictException conflict) {
                Log.w("DaymarkAi", "syncLoop: conflict at revision=" + (conflict.current != null ? conflict.current.revision : "unknown"));
                if (conflict.current != null && conflict.current.state != null) {
                    try {
                        publish(conflict.current, "live");
                    } catch (JSONException ignored) {
                    }
                }
                consecutiveErrors = 0;
                baseErrorDelay = 1000L;
            } catch (IOException e) {
                consecutiveErrors++;
                long delay = Math.min(baseErrorDelay * (long) Math.pow(2, consecutiveErrors - 1), 60_000L);
                Log.e("DaymarkAi", "syncLoop: network error (" + consecutiveErrors + " consecutive): " + e.getMessage(), e);
                if (!running) return;
                postStatus("Offline \u00b7 retrying in " + (delay / 1000) + "s", COLOR_RED);
                // NVIDIA-specific: check if error is related to NVIDIA provider
                if (isNvidiaProvider()) {
                    handleNvidiaError(e);
                }
                sleepQuietly(delay);
            } catch (Exception e) {
                consecutiveErrors++;
                long delay = Math.min(baseErrorDelay * (long) Math.pow(2, consecutiveErrors - 1), 60_000L);
                Log.e("DaymarkAi", "syncLoop: unexpected error (" + consecutiveErrors + " consecutive): " + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
                if (!running) return;
                postStatus("Error \u00b7 retrying in " + (delay / 1000) + "s", COLOR_RED);
                // NVIDIA-specific: check if error is related to NVIDIA provider
                if (isNvidiaProvider()) {
                    handleNvidiaError(e);
                }
                sleepQuietly(delay);
            }
        }
    }

    private void postStatus(String text, int color) {
        if (destroyed) return;
        mainHandler.post(() -> {
            statusView.setText("AIControlPanel \u00b7 " + text);
            statusView.setTextColor(color);
            updateEmptyState();
        });
    }

    private void publish(DaymarkWorkspaceClient.Envelope envelope, String status) throws JSONException {
        if (envelope == null || envelope.state == null) return;
        if (envelope.revision < publishedRevision) return;
        final DaymarkWorkspaceClient.WorkspaceSnapshot next = DaymarkWorkspaceClient.snapshot(envelope);
        publishedRevision = Math.max(publishedRevision, envelope.revision);
        synchronized (stateLock) {
            lastState = envelope.state;
            JSONObject tasks = lastState.optJSONObject("tasks");
            for (PendingOp op : pendingOps) {
                if (tasks == null) break;
                if ("delete".equals(op.kind)) {
                    tasks.remove(op.taskId);
                } else if ("create".equals(op.kind)) {
                    tasks.put(op.taskId, op.createTask);
                } else {
                    JSONObject current = tasks.optJSONObject(op.taskId);
                    if (current != null) {
                        try {
                            JSONObject result = op.mutation.apply(current);
                            if (result != null) tasks.put(op.taskId, result);
                        } catch (JSONException ignored) {
                        }
                    }
                }
            }
        }
        synchronized (stateLock) {
            Iterator<Map.Entry<String, JSONObject>> it = optimisticTasks.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, JSONObject> entry = it.next();
                boolean present = false;
                for (DaymarkWorkspaceClient.TaskInfo task : next.tasks) {
                    if (task.id.equals(entry.getKey())) {
                        present = true;
                        break;
                    }
                }
                if (present) {
                    savingIds.remove(entry.getKey());
                    it.remove();
                } else {
                    try {
                        next.tasks.add(0, new DaymarkWorkspaceClient.TaskInfo(entry.getValue()));
                    } catch (JSONException ignored) {
                    }
                }
            }
        }
        lastRefreshAt = System.currentTimeMillis();
        if (destroyed) return;
        mainHandler.post(() -> {
            snapshot = next;
            // Desktop pushes usage inside the merged preferences object; fall back
            // to a top-level field for older pushes.
            JSONObject prefs = envelope.state.optJSONObject("preferences");
            lastUsage = (prefs != null ? prefs.optJSONObject("usage") : null);
            if (lastUsage == null) lastUsage = envelope.state.optJSONObject("usage");
            renderUsage();
            checkPendingMessages();
            if (syncKey != null && snapshot.projectId != null) {
                statusView.setText("AIControlPanel \u00b7 " + status);
                statusView.setTextColor(COLOR_GREEN);
            } else {
                postStatus(snapshot.projectId == null ? "workspace not found" : status, COLOR_AMBER);
            }
            // Broadcaster transitions: immediate first update for new In Progress
            // tasks, closing "finished" line for tasks that left In Progress.
            onBroadcastTransitions(snapshot.tasks);
            if (selectedChip != null && !"all".equals(selectedChip) && !chipExists(selectedChip)) {
                selectedChip = defaultChip();
            }
            // One enter animation per freshly synced state batch, not per refresh re-render.
            cardAnimWindow = animationsEnabled()
                    ? System.currentTimeMillis() + 350L : 0L;
            rebuildChips();
            applyFilter();
            refreshView.setText("Updated just now");
        });
    }

    private boolean chipExists(String chip) {
        switch (chip) {
            case "all":
                return true;
            case "progress":
                return !progressSectionIds.isEmpty();
            case "todo":
                return !todoSectionIds.isEmpty();
            case "finished":
                return !finishedSectionIds.isEmpty();
            default:
                if (chip.startsWith("sec:")) {
                    String sectionId = chip.substring(4);
                    if (snapshot == null) return false;
                    for (DaymarkWorkspaceClient.SectionInfo section : snapshot.sections) {
                        if (section.id.equals(sectionId)) return true;
                    }
                }
                return false;
        }
    }

    private void refreshNow() {
        final String key = syncKey;
        // Manual/pull refresh: drop the card cache so every card does a true
        // rebind (signature diff is bypassed once, by design).
        if (adapter != null) adapter.invalidateBoundCards();
        if (key == null) {
            Toast.makeText(this, "Pair a Daymark workspace first.", Toast.LENGTH_SHORT).show();
            return;
        }
        networkExecutor.execute(() -> {
            inFlight = true;
            try {
                publish(DaymarkWorkspaceClient.pull(key), "live");
            } catch (Exception error) {
                postStatus("Offline \u00b7 retrying", COLOR_RED);
                // NVIDIA-specific: check if error is related to NVIDIA provider
                if (isNvidiaProvider()) {
                    handleNvidiaError(error);
                }
            } finally {
                inFlight = false;
            }
        });
    }

    // ---- Mutations: optimistic same-frame UI, immediate push, never-drop queue ----

    private interface TaskMutation {
        JSONObject apply(JSONObject task) throws JSONException;
    }

    /** State-level mutation used by dialogs: receives a copy of the last synced state. */
    private interface StateMutation {
        Object apply(JSONObject state) throws JSONException;
    }

    /**
     * Applies a state-level UI mutation (create/edit/complete/move/log) to a copy of
     * the last synced state, detects which task record changed, and queues it through
     * the optimistic op queue.
     */
    private void mutate(String successMessage, StateMutation mutation) {
        JSONObject base;
        synchronized (stateLock) {
            base = lastState;
        }
        if (base == null) {
            Toast.makeText(this, "No workspace is connected yet.", Toast.LENGTH_SHORT).show();
            return;
        }
        JSONObject working;
        try {
            working = new JSONObject(base.toString());
            mutation.apply(working);
        } catch (JSONException error) {
            Toast.makeText(this, "Daymark rejected that change: " + error.getMessage(),
                    Toast.LENGTH_SHORT).show();
            return;
        }
        JSONObject before = base.optJSONObject("tasks");
        JSONObject after = working.optJSONObject("tasks");
        if (after == null) {
            Toast.makeText(this, "Daymark rejected that change.", Toast.LENGTH_SHORT).show();
            return;
        }
        String taskId = null;
        JSONObject taskJson = null;
        boolean created = false;
        java.util.Iterator<String> keys = after.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject next = after.optJSONObject(key);
            if (next == null) continue;
            JSONObject previous = before == null ? null : before.optJSONObject(key);
            if (previous == null) {
                taskId = key;
                taskJson = next;
                created = true;
                break;
            }
            if (!next.toString().equals(previous.toString())) {
                taskId = key;
                taskJson = next;
                break;
            }
        }
        if (taskId == null) {
            Toast.makeText(this, "Nothing changed.", Toast.LENGTH_SHORT).show();
            return;
        }
        final JSONObject committedTaskJson = taskJson;
        commitTaskChange(successMessage, taskId,
                created ? "create" : "patch",
                created ? taskJson : null,
                current -> committedTaskJson);
    }

    private static final class PendingOp {
        final String taskId;
        final String kind;            // "create" | "patch" | "delete"
        final JSONObject createTask;  // create: the full task record
        final TaskMutation mutation;  // patch: mutates the task record in place
        final String successMessage;
        int attempts;

        PendingOp(String taskId, String kind, JSONObject createTask,
                TaskMutation mutation, String successMessage) {
            this.taskId = taskId;
            this.kind = kind;
            this.createTask = createTask;
            this.mutation = mutation;
            this.successMessage = successMessage;
        }
    }

    /** Canonical chip tag that shows this task, switching the view if needed. */
    private void revealChipForTask(String taskId) {
        if (snapshot == null) return;
        String sectionId = null;
        boolean completed = false;
        for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
            if (task.id.equals(taskId)) {
                sectionId = task.sectionId;
                completed = task.completed;
                break;
            }
        }
        String tag = "finished";
        if (!completed) {
            String bucket = null;
            for (DaymarkWorkspaceClient.SectionInfo section : snapshot.sections) {
                if (section.id.equals(sectionId)) {
                    bucket = bucketOf(section.name);
                    break;
                }
            }
            tag = bucket != null ? bucket : "sec:" + sectionId;
        }
        if (chipExists(tag)) {
            selectedChip = tag;
            rebuildChips();
        }
    }

    /** Instant (same-frame) optimistic view update; returns the optimistic record. */
    private JSONObject applyOptimisticView(String taskId, JSONObject taskJson, boolean created) {
        synchronized (stateLock) {
            savingIds.add(taskId);
            optimisticTasks.put(taskId, taskJson);
        }
        if (snapshot != null) {
            try {
                DaymarkWorkspaceClient.TaskInfo info = new DaymarkWorkspaceClient.TaskInfo(taskJson);
                int index = -1;
                for (int i = 0; i < snapshot.tasks.size(); i += 1) {
                    if (snapshot.tasks.get(i).id.equals(taskId)) {
                        index = i;
                        break;
                    }
                }
                if (index >= 0 && !created) snapshot.tasks.set(index, info);
                else if (index >= 0) snapshot.tasks.remove(index);
                if (created) snapshot.tasks.add(0, info);
            } catch (JSONException ignored) {
            }
            if (created) revealChipForTask(taskId);
            // Chip counts read the SAME snapshot the list renders from; rebuild
            // here so an optimistic flip updates counts in the same frame and
            // any later sync re-render recomputes from the newest snapshot.
            rebuildChips();
            applyFilter();
            adapter.notifyDataSetChanged();
        }
        return taskJson;
    }

    private int indexOfOp(String taskId, String kind) {
        for (int index = 0; index < pendingOps.size(); index += 1) {
            PendingOp op = pendingOps.get(index);
            if (op.taskId.equals(taskId) && op.kind.equals(kind)) return index;
        }
        return -1;
    }

    private void commitTaskChange(String successMessage, String taskId, String kind,
            JSONObject createTaskJson, TaskMutation mutation) {
        JSONObject optimistic = createTaskJson;
        if (optimistic == null) {
            synchronized (stateLock) {
                JSONObject tasks = lastState == null ? null : lastState.optJSONObject("tasks");
                JSONObject raw = tasks == null ? null : tasks.optJSONObject(taskId);
                if (raw != null) {
                    try {
                        optimistic = new JSONObject(raw.toString());
                    } catch (JSONException error) {
                        return;
                    }
                    try {
                        JSONObject applied = mutation.apply(optimistic);
                        if (applied != null) optimistic = applied;
                    } catch (JSONException error) {
                        Toast.makeText(this, "Daymark rejected that change: " + error.getMessage(),
                                Toast.LENGTH_SHORT).show();
                        return;
                    }
                }
            }
        }
        if (optimistic == null) {
            Toast.makeText(this, "No workspace is connected yet.", Toast.LENGTH_SHORT).show();
            return;
        }
        applyOptimisticView(taskId, optimistic, "create".equals(kind));
        synchronized (stateLock) {
            int existing = indexOfOp(taskId, kind);
            PendingOp op = new PendingOp(taskId, kind, createTaskJson, mutation, successMessage);
            if (existing >= 0) pendingOps.set(existing, op);
            else pendingOps.add(op);
        }
        drainPendingOps();
    }

    private void commitTaskDelete(String taskId, JSONObject taskJson) {
        synchronized (stateLock) {
            savingIds.add(taskId);
            deletedBackup.put(taskId, taskJson);
        }
        if (snapshot != null) {
            Iterator<DaymarkWorkspaceClient.TaskInfo> it = snapshot.tasks.iterator();
            while (it.hasNext()) {
                if (it.next().id.equals(taskId)) {
                    it.remove();
                    break;
                }
            }
            applyFilter();
            adapter.notifyDataSetChanged();
        }
        synchronized (stateLock) {
            pendingOps.add(new PendingOp(taskId, "delete", null, null, "Session deleted"));
        }
        drainPendingOps();
        showUndoBar(taskId, taskJson);
    }

    private void undoDelete(String taskId) {
        JSONObject backup;
        synchronized (stateLock) {
            backup = deletedBackup.get(taskId);
            Iterator<PendingOp> it = pendingOps.iterator();
            while (it.hasNext()) {
                PendingOp op = it.next();
                if (op.taskId.equals(taskId) && "delete".equals(op.kind)) {
                    it.remove();
                    savingIds.remove(taskId);
                }
            }
        }
        hideUndoBar();
        if (backup == null) return;
        JSONObject restored;
        try {
            restored = new JSONObject(backup.toString());
            restored.put("updatedAt", DaymarkWorkspaceClient.nowIso());
        } catch (JSONException error) {
            return;
        }
        applyOptimisticView(taskId, restored, true);
        synchronized (stateLock) {
            pendingOps.add(new PendingOp(taskId, "create", restored, null, "Session restored"));
        }
        drainPendingOps();
        Toast.makeText(this, "Session restored", Toast.LENGTH_SHORT).show();
    }

    private void showUndoBar(String taskId, JSONObject taskJson) {
        undoTaskId = taskId;
        synchronized (stateLock) {
            deletedBackup.put(taskId, taskJson);
        }
        undoMessage.setText("Session deleted");
        undoBar.setVisibility(View.VISIBLE);
        undoBar.bringToFront();
        mainHandler.removeCallbacks(hideUndoBarRunnable);
        mainHandler.postDelayed(hideUndoBarRunnable, 2500L);
    }

    private final Runnable hideUndoBarRunnable = new Runnable() {
        @Override
        public void run() {
            undoBar.setVisibility(View.GONE);
            undoTaskId = null;
        }
    };

    private void hideUndoBar() {
        mainHandler.removeCallbacks(hideUndoBarRunnable);
        undoBar.setVisibility(View.GONE);
        undoTaskId = null;
    }

    private void drainPendingOps() {
        networkExecutor.execute(() -> {
            PendingOp op;
            synchronized (stateLock) {
                if (draining || pendingOps.isEmpty()) return;
                draining = true;
                op = pendingOps.get(0);
            }
            try {
                long backoffMs = 1200L;
                int conflicts = 0;
                int failures = 0;
                int nullWaits = 0;
                while (true) {
                    String key = syncKey;
                    JSONObject base;
                    long expectedRevision;
                    synchronized (stateLock) {
                        base = lastState;
                        expectedRevision = publishedRevision;
                    }
                    if (key == null || base == null) {
                        nullWaits += 1;
                        if (nullWaits > 15) {
                            // Never spin forever: ~30 s disconnected -> fail the
                            // op honestly so no later action is ever blocked.
                            mainHandler.post(() -> {
                                synchronized (stateLock) {
                                    pendingOps.remove(op);
                                    savingIds.remove(op.taskId);
                                }
                                Toast.makeText(this, "Workspace disconnected \u2014 change not saved. Reconnect and try again.", Toast.LENGTH_LONG).show();
                                refreshNow();
                            });
                            break;
                        }
                        sleepQuietly(2000L);
                        continue;
                    }
                    try {
                        JSONObject working = new JSONObject(base.toString());
                        JSONObject tasks = working.optJSONObject("tasks");
                        if ("delete".equals(op.kind)) {
                            JSONObject tombstones = working.optJSONObject("syncTombstones");
                            if (tombstones == null) {
                                tombstones = new JSONObject();
                                working.put("syncTombstones", tombstones);
                            }
                            if (tasks != null) tasks.remove(op.taskId);
                            tombstones.put("tasks:" + op.taskId,
                                    new JSONObject().put("deletedAt", DaymarkWorkspaceClient.nowIso()));
                        } else if ("create".equals(op.kind)) {
                            tasks.put(op.taskId, op.createTask);
                        } else if ("patch".equals(op.kind)) {
                            JSONObject current = tasks.optJSONObject(op.taskId);
                            if (current != null) {
                                JSONObject result = op.mutation.apply(current);
                                if (result != null) tasks.put(op.taskId, result);
                            }
                        }
                        boolean directPatched = false;
                        if ("patch".equals(op.kind) && key != null && !key.isEmpty()) {
                            // DIRECT PER-TASK PATCH (user law: a move ALWAYS lands,
                            // <1s, zero popups): the board revision changes every
                            // second, so a full-state PUT conflicts constantly and
                            // drops moves ("Session changed elsewhere"). A per-task
                            // PATCH has no revision lock - send what actually changed.
                            try {
                                JSONObject before = null;
                                try { before = new JSONObject(DaymarkWorkspaceClient.fetchTaskRaw(key, op.taskId)); } catch (Exception ignore) { }
                                JSONObject after = tasks.optJSONObject(op.taskId);
                                JSONObject body = new JSONObject();
                                if (after != null) {
                                    java.util.Iterator<String> itk = after.keys();
                                    while (itk.hasNext()) {
                                        String k2 = itk.next();
                                        Object nv = after.opt(k2);
                                        Object ov = before == null ? null : before.opt(k2);
                                        if ("syncTombstones".equals(k2)) continue;
                                        // completedAt/completionContext are endpoint-only fields — a PATCH
                                        // carrying them 409s forever and reverted the whole op (Complete button bug).
                                        if ("completedAt".equals(k2) || "completionContext".equals(k2)) continue;
                                        if (ov == null || !String.valueOf(ov).equals(String.valueOf(nv))) body.put(k2, nv);
                                    }
                                }
if (body.length() > 0) {
                                     DaymarkWorkspaceClient.patchTask(key, op.taskId, body);
                                     directPatched = true;
                                 } else {
                                     // Server record was read back fresh and
                                     // already equals the desired record - the
                                     // write HAS landed; nothing to send.
                                     directPatched = true;
                                 }
                             } catch (Exception directError) {
                                 Log.w("DaymarkAi", "direct patch failed, retrying as full-record patch: " + directError.getMessage());
                                 // NVIDIA-specific: check if error is related to NVIDIA provider
                                 if (isNvidiaProvider()) {
                                     handleNvidiaError(directError);
                                 }
                             }
if (!directPatched) {
                                 // BUTTON AUDIT LAW: a patch op NEVER falls back
                                 // to the legacy full-state PUT with expected-
                                 // Revision (constant conflicts, dropped moves).
                                 // PATCH the full task record instead - no
                                 // revision lock, verified by HTTP status.
                                 JSONObject full = tasks.optJSONObject(op.taskId);
                                 if (full != null) {
                                     try {
                                         DaymarkWorkspaceClient.patchTask(key, op.taskId, full);
                                         directPatched = true;
                                     } catch (Exception fallbackError) {
                                         Log.w("DaymarkAi", "fallback patch failed: " + fallbackError.getMessage());
                                         // NVIDIA-specific: check if error is related to NVIDIA provider
                                         if (isNvidiaProvider()) {
                                             handleNvidiaError(fallbackError);
                                         }
                                     }
                                 }
                             }
                             if (!directPatched) {
                                // Task no longer exists server-side: fail the op
                                // honestly instead of pushing full state that
                                // reports success while changing no task.
                                mainHandler.post(() -> {
                                    synchronized (stateLock) {
                                        pendingOps.remove(op);
                                        savingIds.remove(op.taskId);
                                    }
                                    Toast.makeText(this, "Task no longer exists \u2014 change dropped.", Toast.LENGTH_LONG).show();
                                    refreshNow();
                                });
                                break;
                            }
} else {
                             try {
                                 DaymarkWorkspaceClient.push(key, working, expectedRevision);
                             } catch (Exception pushError) {
                                 Log.w("DaymarkAi", "push failed: " + pushError.getMessage());
                                 // NVIDIA-specific: check if error is related to NVIDIA provider
                                 if (isNvidiaProvider()) {
                                     handleNvidiaError(pushError);
                                 }
                                 throw pushError;
                             }
                         }
                        boolean finalSuccess;
                        finalSuccess = !("delete".equals(op.kind));
                        boolean success = finalSuccess;
                        mainHandler.post(() -> {
                            synchronized (stateLock) {
                                pendingOps.remove(op);
                                if ("create".equals(op.kind)) optimisticTasks.remove(op.taskId);
                                savingIds.remove(op.taskId);
                            }
                            Toast.makeText(this, op.successMessage, Toast.LENGTH_SHORT).show();
                            refreshNow();
                            if (adapter != null) adapter.notifyDataSetChanged();
                        });
                        break;
                    } catch (DaymarkWorkspaceClient.ConflictException conflict) {
                        conflicts += 1;
                        if (conflict.current != null && conflict.current.state != null) {
                            synchronized (stateLock) {
                                lastState = conflict.current.state;
                                publishedRevision = Math.max(publishedRevision, conflict.current.revision);
                            }
                        }
                        if (conflicts >= 3) {
                            mainHandler.post(() -> {
                                synchronized (stateLock) {
                                    pendingOps.remove(op);
                                    savingIds.remove(op.taskId);
                                }
                                Toast.makeText(this,
                                        "Session changed elsewhere \u2014 change dropped, please retry.",
                                        Toast.LENGTH_LONG).show();
                                refreshNow();
                            });
                            break;
                        }
                        sleepQuietly(backoffMs);
                        backoffMs = Math.min(backoffMs * 2, 8_000L);
                    } catch (Exception error) {
                        Log.w("DaymarkAi", "drain attempt failed for " + op.taskId + ": " + error.getMessage());
                        failures += 1;
                        if (failures >= 4) {
                            // Give up on this op: a permanently failing op must
                            // NEVER stay at the queue head blocking every later
                            // action (head-of-line poison). Honest failure + drop.
                            mainHandler.post(() -> {
                                synchronized (stateLock) {
                                    pendingOps.remove(op);
                                    savingIds.remove(op.taskId);
                                }
                                Toast.makeText(this, "Change failed \u2014 the server did not accept it. Try again.", Toast.LENGTH_LONG).show();
                                refreshNow();
                            });
                            break;
                        }
                        sleepQuietly(backoffMs);
                        backoffMs = Math.min(backoffMs * 2, 8_000L);
                    }
                }
            } finally {
                synchronized (stateLock) {
                    draining = false;
                }
            }
        });
    }

    private String currentModelPref() {
        return getSharedPreferences("daymark", MODE_PRIVATE)
                .getString(MODEL_PREF, DEFAULT_MODEL);
    }

    private String currentProviderPref() {
        return getSharedPreferences("daymark", MODE_PRIVATE)
                .getString(PROVIDER_PREF, DEFAULT_PROVIDER);
    }

    private void saveProviderPref(String provider) {
        getSharedPreferences("daymark", MODE_PRIVATE)
                .edit()
                .putString(PROVIDER_PREF, provider)
                .apply();
    }

    /** Encrypted API key storage key prefix. */
    private static final String API_KEY_PREF_PREFIX = "api_key_encrypted_";

    /** Get encrypted API key for a provider from SharedPreferences. */
    private String getEncryptedApiKey(String provider) {
        return getSharedPreferences("daymark", MODE_PRIVATE)
                .getString(API_KEY_PREF_PREFIX + provider, null);
    }

    /** Save encrypted API key for a provider. */
    private void saveEncryptedApiKey(String provider, String plaintextKey) {
        try {
            String encrypted = encryptApiKey(plaintextKey);
            getSharedPreferences("daymark", MODE_PRIVATE)
                    .edit()
                    .putString(API_KEY_PREF_PREFIX + provider, encrypted)
                    .apply();
            Log.i("DaymarkAi", "API key saved for provider: " + provider);
        } catch (Exception e) {
            Log.e("DaymarkAi", "Failed to encrypt API key for " + provider + ": " + e.getMessage());
        }
    }

    /** Get decrypted API key for a provider, or null if not set. */
    public String getDecryptedApiKey(String provider) {
        String encrypted = getEncryptedApiKey(provider);
        if (encrypted == null) return null;
        try {
            return decryptApiKey(encrypted);
        } catch (Exception e) {
            Log.e("DaymarkAi", "Failed to decrypt API key for " + provider + ": " + e.getMessage());
            return null;
        }
    }

    /** Check if a provider has an API key configured. */
    public boolean hasApiKey(String provider) {
        return getEncryptedApiKey(provider) != null;
    }

    /** Remove API key for a provider. */
    private void removeApiKey(String provider) {
        getSharedPreferences("daymark", MODE_PRIVATE)
                .edit()
                .remove(API_KEY_PREF_PREFIX + provider)
                .apply();
    }

    /** Get NVIDIA API key, with fallback to hardcoded for testing. */
    public String getNvidiaApiKey() {
        String key = getDecryptedApiKey("nvidia-nim");
        if (key != null && !key.isEmpty()) return key;
        // No hardcoded fallback - must be configured by user
        return null;
    }

    // ---- NVIDIA key pool: multiple encrypted keys for the nvidia-nim provider.
    // The primary key stays in api_key_encrypted_nvidia-nim; additional keys live
    // as an encrypted JSON array in nvidia_keys_pool_encrypted. ----
    private static final String NVIDIA_POOL_PREF = "nvidia_keys_pool_encrypted";

    /** Number of pooled (additional) NVIDIA keys. */
    int nvidiaPoolSize() {
        try {
            return nvidiaPoolKeys().size();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Add a key to the NVIDIA pool (encrypt-merge, deduped against pool and primary). */
    synchronized void nvidiaPoolAdd(String key) {
        if (key == null || key.trim().isEmpty()) return;
        key = key.trim();
        try {
            java.util.List<String> pool = nvidiaPoolKeys();
            String primary = getDecryptedApiKey("nvidia-nim");
            if (key.equals(primary) || pool.contains(key)) return; // dedupe
            pool.add(key);
            org.json.JSONArray arr = new org.json.JSONArray();
            for (String k : pool) arr.put(k);
            String encrypted = encryptApiKey(arr.toString());
            getSharedPreferences("daymark", MODE_PRIVATE)
                    .edit()
                    .putString(NVIDIA_POOL_PREF, encrypted)
                    .apply();
            Log.i("DaymarkAi", "NVIDIA key pool: added key (pool size " + pool.size() + ")");
        } catch (Exception e) {
            Log.e("DaymarkAi", "NVIDIA pool add failed: " + e.getMessage());
        }
    }

    /** Decrypt and return the pooled NVIDIA keys (empty list if none). */
    java.util.List<String> nvidiaPoolKeys() {
        java.util.List<String> out = new ArrayList<>();
        try {
            String encrypted = getSharedPreferences("daymark", MODE_PRIVATE)
                    .getString(NVIDIA_POOL_PREF, null);
            if (encrypted == null) return out;
            String json = decryptApiKey(encrypted);
            org.json.JSONArray arr = new org.json.JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                String k = arr.optString(i, "").trim();
                if (!k.isEmpty()) out.add(k);
            }
        } catch (Exception e) {
            Log.e("DaymarkAi", "NVIDIA pool read failed: " + e.getMessage());
        }
        return out;
    }

    /** Masked form of a key for display: first 4 + ... + last 2 chars, never full. */
    private String maskKey(String key) {
        if (key == null || key.length() <= 6) return "\u2022\u2022\u2022\u2022";
        return key.substring(0, 4) + "\u2026" + key.substring(key.length() - 2);
    }

    private String currentProviderModelPref() {
        String provider = currentProviderPref();
        String prefix = PROVIDER_MODEL_PREFIX.getOrDefault(provider, "");
        return prefix + currentModelPref();
    }

    /** Show provider selection dialog with API key management. */
    private void showProviderDialog() {
        final String[] choices = PROVIDER_CHOICES;
        final String current = currentProviderPref();
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(24), dp(16), dp(24), dp(8));
        final Map<String, RadioButton> buttons = new LinkedHashMap<>();
        RadioGroup group = new RadioGroup(this);
        for (final String provider : choices) {
            RadioButton rb = new RadioButton(this);
            String label = PROVIDER_LABELS.get(provider);
            rb.setText(label != null ? label : provider);
            rb.setTextColor(COLOR_TEXT);
            rb.setChecked(provider.equals(currentProviderPref()));
            group.addView(rb);
            buttons.put(provider, rb);
        }
        list.addView(group);

        // API Key management section
        TextView apiKeyHeader = new TextView(this);
        apiKeyHeader.setText("API Key Management (encrypted via Android Keystore)");
        apiKeyHeader.setTextColor(COLOR_ACCENT);
        apiKeyHeader.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        apiKeyHeader.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        apiKeyHeader.setPadding(0, dp(16), 0, dp(8));
        list.addView(apiKeyHeader);

        for (final String provider : choices) {
            boolean hasKey = hasApiKey(provider);
            LinearLayout providerKeyRow = new LinearLayout(this);
            providerKeyRow.setOrientation(LinearLayout.HORIZONTAL);
            providerKeyRow.setPadding(0, dp(8), 0, 0);

            TextView status = new TextView(this);
            status.setText(hasKey ? "● Key configured" : "○ No key");
            status.setTextColor(hasKey ? COLOR_GREEN : COLOR_RED);
            status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            providerKeyRow.addView(status, statusParams);

            TextView btnAdd = new TextView(this);
            btnAdd.setText(hasKey ? "Change" : "Add");
            btnAdd.setTextColor(COLOR_ACCENT);
            btnAdd.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            btnAdd.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
            btnAdd.setPadding(dp(16), dp(4), dp(16), dp(4));
            btnAdd.setBackgroundResource(android.R.drawable.btn_default);
            btnAdd.setOnClickListener(v -> showApiKeyDialog(provider));
            providerKeyRow.addView(btnAdd);

            if (hasKey) {
                TextView btnTest = new TextView(this);
                btnTest.setText("Test");
                btnTest.setTextColor(COLOR_BLUE);
                btnTest.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                btnTest.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
                btnTest.setPadding(dp(16), dp(4), dp(16), dp(4));
                btnTest.setBackgroundResource(android.R.drawable.btn_default);
                btnTest.setOnClickListener(v -> testApiKey(provider));
                providerKeyRow.addView(btnTest);

                TextView btnRemove = new TextView(this);
                btnRemove.setText("Remove");
                btnRemove.setTextColor(COLOR_RED);
                btnRemove.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                btnRemove.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
                btnRemove.setPadding(dp(16), dp(4), dp(16), dp(4));
                btnRemove.setBackgroundResource(android.R.drawable.btn_default);
                btnRemove.setOnClickListener(v -> {
                    removeApiKey(provider);
                    Toast.makeText(this, "API key removed for " + PROVIDER_LABELS.get(provider), Toast.LENGTH_SHORT).show();
                    showProviderDialog(); // Refresh
                });
                providerKeyRow.addView(btnRemove);
            }
            list.addView(providerKeyRow);

            if ("nvidia-nim".equals(provider)) {
                final int poolCount = nvidiaPoolSize();
                LinearLayout poolRow = new LinearLayout(this);
                poolRow.setOrientation(LinearLayout.HORIZONTAL);
                poolRow.setPadding(dp(16), dp(2), 0, 0);

                TextView poolLabel = new TextView(this);
                poolLabel.setText("NVIDIA key pool: " + poolCount + " key" + (poolCount == 1 ? "" : "s"));
                poolLabel.setTextColor(COLOR_TEXT_DIM);
                poolLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                LinearLayout.LayoutParams poolParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                poolRow.addView(poolLabel, poolParams);

                TextView btnPoolAdd = new TextView(this);
                btnPoolAdd.setText("Add key to pool");
                btnPoolAdd.setTextColor(COLOR_ACCENT);
                btnPoolAdd.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                btnPoolAdd.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
                btnPoolAdd.setPadding(dp(16), dp(4), dp(16), dp(4));
                btnPoolAdd.setBackgroundResource(android.R.drawable.btn_default);
                btnPoolAdd.setOnClickListener(v -> showNvidiaPoolAddDialog());
                poolRow.addView(btnPoolAdd);

                list.addView(poolRow);
            }
        }

        TextView hint = new TextView(this);
        hint.setText("Select AI provider. Auto-switches on limit reached. Keys are encrypted with Android Keystore AES-256-GCM.");
        hint.setTextColor(COLOR_TEXT_DIM);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        hint.setPadding(0, dp(8), 0, 0);
        list.addView(hint);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("AI Provider")
                .setView(wrapScroll(list))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, which) -> {
                    String chosen = current;
                    for (Map.Entry<String, RadioButton> e : buttons.entrySet()) {
                        if (e.getValue().isChecked()) { chosen = e.getKey(); break; }
                    }
                    if (!chosen.equals(currentProviderPref())) {
                        saveProviderPref(chosen);
                        if (providerChip != null) providerChip.setText(chosen);
                        Toast.makeText(this, "Provider changed to " + PROVIDER_LABELS.get(chosen), Toast.LENGTH_SHORT).show();
                    }
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /** Show API key input dialog for a provider. */
    private void showApiKeyDialog(final String provider) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText keyField = new EditText(this);
        keyField.setHint("Enter API key for " + PROVIDER_LABELS.get(provider));
        keyField.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyField.setTextColor(COLOR_TEXT);
        keyField.setBackgroundResource(android.R.drawable.edit_text);
        form.addView(keyField);

        if (hasApiKey(provider)) {
            TextView note = new TextView(this);
            note.setText("Leave blank to keep existing key. Enter new key to replace.");
            note.setTextColor(COLOR_TEXT_DIM);
            note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            note.setPadding(0, dp(8), 0, 0);
            form.addView(note);
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("API Key: " + PROVIDER_LABELS.get(provider))
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, which) -> {
                    String key = keyField.getText().toString().trim();
                    if (!key.isEmpty()) {
                        saveEncryptedApiKey(provider, key);
                        Toast.makeText(this, "API key saved for " + PROVIDER_LABELS.get(provider), Toast.LENGTH_SHORT).show();
                    } else if (!hasApiKey(provider)) {
                        Toast.makeText(this, "No key entered", Toast.LENGTH_SHORT).show();
                    }
                    showProviderDialog(); // Refresh
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /** Add an additional key to the NVIDIA key pool (masked, deduped, encrypted). */
    private void showNvidiaPoolAddDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText keyField = new EditText(this);
        keyField.setHint("Additional NVIDIA API key");
        keyField.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyField.setTextColor(COLOR_TEXT);
        keyField.setBackgroundResource(android.R.drawable.edit_text);
        form.addView(keyField);

        java.util.List<String> pool = nvidiaPoolKeys();
        if (!pool.isEmpty()) {
            StringBuilder sb = new StringBuilder("Pooled keys (masked):\n");
            for (int i = 0; i < pool.size(); i++) {
                sb.append(i + 1).append(". ").append(maskKey(pool.get(i))).append("\n");
            }
            TextView note = new TextView(this);
            note.setText(sb.toString().trim());
            note.setTextColor(COLOR_TEXT_DIM);
            note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            note.setPadding(0, dp(8), 0, 0);
            form.addView(note);
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("NVIDIA key pool")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Add", (d, which) -> {
                    String key = keyField.getText().toString().trim();
                    if (key.isEmpty()) {
                        Toast.makeText(this, "No key entered", Toast.LENGTH_SHORT).show();
                    } else {
                        nvidiaPoolAdd(key);
                        Toast.makeText(this, "Key added to NVIDIA pool (" + nvidiaPoolSize() + " pooled)", Toast.LENGTH_SHORT).show();
                    }
                    showProviderDialog(); // Refresh
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /** Test API key for a provider by making a lightweight API call. */
    private void testApiKey(final String provider) {
        String key = getDecryptedApiKey(provider);
        if (key == null) {
            Toast.makeText(this, "No key configured for " + PROVIDER_LABELS.get(provider), Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(this, "Testing " + PROVIDER_LABELS.get(provider) + "...", Toast.LENGTH_SHORT).show();
        networkExecutor.execute(() -> {
            try {
                boolean ok = false;
                if ("nvidia-nim".equals(provider)) {
                    ok = testNvidiaKey(key);
                } else if ("openrouter".equals(provider)) {
                    ok = testOpenRouterKey(key);
                } else if ("xai".equals(provider)) {
                    ok = testXaiKey(key);
                } else if ("zai-headless".equals(provider) || "zai-metered-api".equals(provider)) {
                    ok = testZaiKey(key);
                }
                final boolean result = ok;
                mainHandler.post(() -> {
                    if (result) {
                        Toast.makeText(this, "✓ " + PROVIDER_LABELS.get(provider) + " key is valid", Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(this, "✗ " + PROVIDER_LABELS.get(provider) + " key test failed", Toast.LENGTH_LONG).show();
                    }
                    showProviderDialog();
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    Toast.makeText(this, "✗ Test error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    showProviderDialog();
                });
            }
        });
    }

    /** Test NVIDIA API key against integrate.api.nvidia.com/v1/models. */
    private boolean testNvidiaKey(String key) {
        try {
            java.net.URL url = new java.net.URL("https://integrate.api.nvidia.com/v1/models");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            Log.w("DaymarkAi", "NVIDIA key test failed: " + e.getMessage());
            return false;
        }
    }

    /** Test OpenRouter API key. */
    private boolean testOpenRouterKey(String key) {
        try {
            java.net.URL url = new java.net.URL("https://openrouter.ai/api/v1/models");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            Log.w("DaymarkAi", "OpenRouter key test failed: " + e.getMessage());
            return false;
        }
    }

    /** Test xAI API key. */
    private boolean testXaiKey(String key) {
        try {
            java.net.URL url = new java.net.URL("https://api.x.ai/v1/models");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            Log.w("DaymarkAi", "xAI key test failed: " + e.getMessage());
            return false;
        }
    }

    /** Test Z.ai API key. */
    private boolean testZaiKey(String key) {
        try {
            java.net.URL url = new java.net.URL("https://api.z.ai/api/anthropic/v1/models");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            Log.w("DaymarkAi", "Z.ai key test failed: " + e.getMessage());
            return false;
        }
    }

    private String findNextAvailableProvider(String current) {
        int idx = -1;
        for (int i = 0; i < PROVIDER_CHOICES.length; i++) {
            if (PROVIDER_CHOICES[i].equals(current)) { idx = i; break; }
        }
        for (int i = 1; i < PROVIDER_CHOICES.length; i++) {
            String candidate = PROVIDER_CHOICES[(idx + i) % PROVIDER_CHOICES.length];
            if (!providerLimitReached.containsKey(candidate)) return candidate;
        }
        return null;
    }

    /** Called when a provider reports rate limit (429). */
    public void onProviderRateLimit(String provider) {
        long now = System.currentTimeMillis();
        providerLimitReached.put(provider, now);
        // NVIDIA has longer rate limit reset (5 min), others 1 min
        long resetDelay = "nvidia-nim".equals(provider) ? 5 * 60_000L : 60_000L;
        providerLimitResetAt.put(provider, now + resetDelay);
        Log.i("DaymarkAi", "Provider rate limit hit: " + provider + ", reset in " + (resetDelay / 1000) + "s");
        if (provider.equals(currentProviderPref())) {
            checkProviderLimits();
        }
    }

    /** Check if current model is a NVIDIA model. */
    private boolean isNvidiaModel() {
        String model = currentProviderModelPref();
        return model != null && model.startsWith("nvidia-nim/");
    }

    /** Check if current provider is NVIDIA. */
    private boolean isNvidiaProvider() {
        return "nvidia-nim".equals(currentProviderPref());
    }

    /** Handle NVIDIA-specific errors with longer backoff. */
    private void handleNvidiaError(Exception e) {
        if (!isNvidiaProvider()) return;
        long now = System.currentTimeMillis();
        providerLimitReached.put("nvidia-nim", now);
        providerLimitResetAt.put("nvidia-nim", now + 5 * 60_000L); // 5 min for NVIDIA
        Log.w("DaymarkAi", "NVIDIA error detected: " + e.getMessage() + ", will auto-switch in 5 min");
        if ("nvidia-nim".equals(currentProviderPref())) {
            checkProviderLimits();
        }
    }

    /** Z.ai PAYG key: powers the live balance fetch shown in the usage strip. */
    private static final String METERED_API_KEY = "391f37c35bcf40f19cd6f8cd4d449774.C4v2oEkD86xgeem6";
    /** Live metered-API state for the usage strip ("$9.99" or "API active"). */
    private volatile String apiBalanceText;
    private volatile long apiBalanceNextMs;
    /** Model tag override currently on a card (newest ORDER model: token). */
    private static final java.util.regex.Pattern MODEL_TAG_RE = java.util.regex.Pattern.compile(
            "^.*\u2014\\s*ORDER[^\\n]*\\bmodel:\\s*([A-Za-z0-9._:/-]+).*$",
            java.util.regex.Pattern.MULTILINE);

    private void maybeFetchApiBalance() {
        if (System.currentTimeMillis() < apiBalanceNextMs) return;
        apiBalanceNextMs = System.currentTimeMillis() + 300_000L;
        networkExecutor.execute(() -> {
            String result = null;
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                        new java.net.URL("https://api.z.ai/api/paas/v4/user/balance").openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(6000);
                c.setRequestProperty("Authorization", "Bearer " + METERED_API_KEY);
                int code = c.getResponseCode();
                if (code == 200) {
                    java.io.BufferedReader r = new java.io.BufferedReader(
                            new java.io.InputStreamReader(c.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                    StringBuilder b = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) b.append(line);
                    org.json.JSONObject body = new org.json.JSONObject(b.toString());
                    double val = body.optDouble("balance",
                            body.optJSONObject("data") == null ? Double.NaN
                                    : body.optJSONObject("data").optDouble("balance", Double.NaN));
                    if (!Double.isNaN(val)) result = "$" + String.format(java.util.Locale.US, "%.2f", val);
                }
            } catch (Exception error) {
                Log.w("DaymarkAi", "api balance: " + error.getMessage());
            }
            apiBalanceText = result != null ? result : "API active";
            mainHandler.post(() -> renderUsage());
        });
    }

    private String cardModelTag(final DaymarkWorkspaceClient.TaskInfo task) {
        String tag = taskModelPref(task.id);
        if (tag != null && !tag.isEmpty() && !"default".equals(tag) && !DEFAULT_MODEL.equals(tag)) return tag;
        if (task.description == null) return null;
        java.util.regex.Matcher m = MODEL_TAG_RE.matcher(task.description);
        if (m.find()) {
            String id = m.group(1).trim();
            if (!id.isEmpty() && !"default".equals(id) && !DEFAULT_MODEL.equals(id)) return id;
        }
        return null;
    }

    private String taskModelPref(String taskId) {
        return getSharedPreferences("daymark", MODE_PRIVATE)
                .getString(TASK_MODEL_PREF_PREFIX + taskId, null);
    }

    /**
     * LIVE MODEL CATALOG: the dialog list comes from assets/models.json
     * (a plain JSON array of model ids) bundled with the app, so the catalog
     * can be refreshed without a code change. Falls back to the hardcoded
     * MODEL_CHOICES when the asset is missing or unparsable. DEFAULT_MODEL is
     * always kept in the list and stays the default selection.
     */
    /** id -> human label from models.json (beauty: dialogs show labels, never raw ids). */
    private final java.util.Map<String, String> modelLabels = new java.util.HashMap<>();

    /** The exact five NVIDIA NIM models in failover order. Every entry was
     *  verified LIVE against integrate.api.nvidia.com through the rotating-key
     *  proxy: a model that 404s or stalls is never offered (glm-5.2 EOL'd
     *  2026-08-21, deepseek-v4-flash-0731 and inkling were retired upstream). */
    private static final String[] NVIDIA_NIM_MODELS = {
            "nvidia-nim/nvidia/nemotron-3-ultra-550b-a55b",      // 1. Default: Nemotron 3 Ultra 550B
            "nvidia-nim/nvidia/nemotron-3.5-lightning-30b-a3b",  // 2. Nemotron 3.5 Lightning 30B (fastest)
            "nvidia-nim/nvidia/nemotron-3.5-super-vl-120b-a12b", // 3. Nemotron 3.5 Super VL 120B (vision)
            "nvidia-nim/stepfun-ai/step-5-preview",              // 4. Step 5 Preview
            "nvidia-nim/meta/muse-glimmer-30b"                   // 5. Muse Glimmer 30B
    };
    /** Canonical name for the NVIDIA NIM catalog (exact 5, prefixed ids). */
    private static final String[] NVIDIA_MODELS = NVIDIA_NIM_MODELS;

    private String[] modelChoices() {
        String currentProvider = currentProviderPref();
        String providerPrefix = PROVIDER_MODEL_PREFIX.getOrDefault(currentProvider, "");
        boolean isOpenCode = "opencode".equals(currentProvider);
        boolean isNvidiaNim = "nvidia-nim".equals(currentProvider);
        
        java.util.List<String> models = new ArrayList<>();
        int openCodeCount = 0;
        try (java.io.InputStream input = getAssets().open("models.json")) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) > 0) buffer.write(chunk, 0, read);
            org.json.JSONArray array = new org.json.JSONArray(
                    new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8));
            for (int i = 0; i < array.length(); i++) {
                // Entries may be bare id strings or {"id":...,"label":...}
                // objects; always surface the human label, keep the id.
                Object entry = array.opt(i);
                String id = null;
                String label = null;
                if (entry instanceof JSONObject) {
                    id = ((JSONObject) entry).optString("id", "").trim();
                    label = ((JSONObject) entry).optString("label", "").trim();
                } else {
                    id = String.valueOf(entry).trim();
                }
                if (id.isEmpty()) continue;
                
                // Filter by current provider
                if (!id.startsWith(providerPrefix)) continue;
                
                // Limit OpenCode to 3 models
                boolean isOpenCodeModel = id.startsWith("opencode/");
                if (isOpenCode && isOpenCodeModel) {
                    if (openCodeCount >= 3) continue;
                    openCodeCount++;
                }
                
                if (!models.contains(id)) models.add(id);
                
                if (label != null && !label.isEmpty()) modelLabels.put(id, label);
            }
        } catch (Exception error) {
            Log.w("DaymarkAi", "models.json unavailable, using built-in catalog: " + error.getMessage());
        }
        
        // NVIDIA NIM: ensure exact 5 models in failover order are always available
        if (isNvidiaNim) {
            for (String nvidiaModel : NVIDIA_NIM_MODELS) {
                if (!models.contains(nvidiaModel)) {
                    models.add(nvidiaModel);
                }
            }
            // Reorder to ensure exact failover order
            java.util.List<String> reordered = new ArrayList<>();
            for (String nvidiaModel : NVIDIA_NIM_MODELS) {
                if (models.contains(nvidiaModel)) {
                    reordered.add(nvidiaModel);
                }
            }
            models = reordered;
        }
        
        if (models.isEmpty()) {
            return MODEL_CHOICES;
        }
        // Provider-filtered catalogs (NVIDIA NIM's exact five) stay pure: the
        // bare zai default id must never leak into another provider's picker.
        if (!models.contains(DEFAULT_MODEL) && !isNvidiaNim) models.add(0, DEFAULT_MODEL);
        String[] result = models.toArray(new String[0]);
        // OpenCode model truth enforcement: only show live models from API
        String[] enforced = enforceOpenCodeModelTruth(result);
        return enforced != null ? enforced : result;
    }

    // ===== OpenCode Model Truth Enforcement =====
    // Only ever display the 3 models actually returned by live OpenCode API.
    // Zero hard-coded fallbacks, zero stale cache.
    private static final String[] OPENCODE_REQUIRED_MODELS = {
            "opencode/opencode-1", "opencode/opencode-2", "opencode/opencode-3"
    };
    private static final long OPENCODE_FETCH_INTERVAL_MS = 60_000L; // refetch every minute
    private volatile Set<String> opencodeAvailableModels = new java.util.HashSet<>();
    private volatile long opencodeLastFetchMs = 0L;
    private volatile boolean opencodeFetchInProgress = false;

    /** Fetches live models from OpenCode API and caches availability.
     *  Returns the set of available OpenCode model IDs (empty on failure). */
    private void fetchOpenCodeModels() {
        if (opencodeFetchInProgress) return;
        long now = System.currentTimeMillis();
        if (now - opencodeLastFetchMs < OPENCODE_FETCH_INTERVAL_MS && !opencodeAvailableModels.isEmpty()) {
            return; // still fresh
        }
        opencodeFetchInProgress = true;
        networkExecutor.execute(() -> {
            try {
                java.net.URL url = new java.net.URL("https://api.opencode.ai/v1/models");
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
                c.setConnectTimeout(10_000);
                c.setReadTimeout(10_000);
                c.setRequestMethod("GET");
                c.setRequestProperty("Accept", "application/json");
                int code = c.getResponseCode();
                if (code == 200) {
                    java.io.BufferedReader r = new java.io.BufferedReader(
                            new java.io.InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder b = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) b.append(line);
                    r.close();
                    org.json.JSONObject body = new org.json.JSONObject(b.toString());
                    org.json.JSONArray data = body.optJSONArray("data");
                    Set<String> available = new java.util.HashSet<>();
                    if (data != null) {
                        for (int i = 0; i < data.length(); i++) {
                            org.json.JSONObject model = data.optJSONObject(i);
                            if (model != null) {
                                String id = model.optString("id", "").trim();
                                if (!id.isEmpty()) available.add(id);
                            }
                        }
                    }
                    opencodeAvailableModels = available;
                    opencodeLastFetchMs = now;
                    Log.i("DaymarkAi", "OpenCode live models fetched: " + available);
                } else {
                    Log.w("DaymarkAi", "OpenCode models API returned " + code);
                }
                c.disconnect();
            } catch (Exception error) {
                Log.w("DaymarkAi", "OpenCode models fetch failed: " + error.getMessage());
            } finally {
                opencodeFetchInProgress = false;
            }
        });
    }

    /** Returns true when all 3 required OpenCode models are available. */
    private boolean opencodeAllModelsAvailable() {
        for (String required : OPENCODE_REQUIRED_MODELS) {
            if (!opencodeAvailableModels.contains(required)) return false;
        }
        return true;
    }

    /** Returns the first missing OpenCode model, or null when all available. */
    private String opencodeMissingModel() {
        for (String required : OPENCODE_REQUIRED_MODELS) {
            if (!opencodeAvailableModels.contains(required)) return required;
        }
        return null;
    }

    /** Red warning banner text for missing OpenCode models, or null when all available. */
    private String opencodeMissingBanner() {
        String missing = opencodeMissingModel();
        if (missing == null) return null;
        String modelName = missing.substring(missing.lastIndexOf('/') + 1);
        return "OpenCode model " + modelName + " unavailable";
    }

    /** Update the OpenCode warning banner visibility and text. */
    private void updateOpenCodeWarning() {
        if (opencodeWarningBanner == null) return;
        mainHandler.post(() -> {
            if ("opencode".equals(currentProviderPref())) {
                String banner = opencodeMissingBanner();
                if (banner != null) {
                    opencodeWarningBanner.setText("⚠ " + banner + " — falling back to GLM-5.3-Flash");
                    opencodeWarningBanner.setVisibility(View.VISIBLE);
                } else {
                    opencodeWarningBanner.setVisibility(View.GONE);
                }
            } else {
                opencodeWarningBanner.setVisibility(View.GONE);
            }
        });
    }

    /** Filters model choices for OpenCode provider to only the 3 live models.
     *  Returns null when not OpenCode provider (caller uses normal flow). */
    private String[] enforceOpenCodeModelTruth(String[] choices) {
        if (!"opencode".equals(currentProviderPref())) return null;
        // Always fetch live models on OpenCode
        fetchOpenCodeModels();
        java.util.List<String> enforced = new ArrayList<>();
        for (String required : OPENCODE_REQUIRED_MODELS) {
            if (opencodeAvailableModels.contains(required)) {
                enforced.add(required);
            }
        }
        // No static fallback: if the live fetch hasn't produced models yet, an
        // empty list is returned and the UI hides the OpenCode options until a
        // successful fetch populates the live set.
        return enforced.toArray(new String[0]);
    }

    /** Header Model chip -> radio dialog; saving publishes to the "model" card. */
    private void showModelDialog() {
        showModelDialog(null);
    }

    /**
     * Model dialog. With {@code task == null} (header chip): sets the GLOBAL
     * default model and publishes it to the workspace "model" card as before.
     * With a task: stores a PER-TASK OVERRIDE and prepends an
     * "\u2014 ORDER HH:MM \u2014 model: <id>" line to that task so the PC bridge reads
     * it on its next poll; the global default is untouched. Default selection
     * remains the current default (or the task's existing override).
     */
    private void showModelDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        final boolean perTask = task != null;
        final String[] choices = modelChoices();
        final String taskOverride = perTask ? taskModelPref(task.id) : null;
        String current = perTask
                ? (taskOverride != null ? taskOverride : currentModelPref())
                : currentModelPref();
        // Provider default: when the stored pref is not on this provider's list
        // (e.g. switching to nvidia-nim, whose default is nvidia-nim/z-ai/glm-5.2),
        // fall back to the provider's first choice instead of leaving nothing checked.
        boolean currentOnList = false;
        for (String c : choices) if (c.equals(current)) { currentOnList = true; break; }
        if (!currentOnList && choices.length > 0) current = choices[0];
        final String currentInitial = current;
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(24), dp(16), dp(24), dp(8));
        final Map<String, RadioButton> buttons = new LinkedHashMap<>();
        if (choices.length == 0) {
            // OpenCode truth: no live models fetched yet — show nothing stale.
            TextView empty = new TextView(this);
            empty.setText("OpenCode: no live models yet — fetch in progress or failed. Try again shortly.");
            empty.setTextColor(COLOR_TEXT_DIM);
            empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            empty.setPadding(0, dp(8), 0, dp(4));
            list.addView(empty);
            AlertDialog emptyDialog = new AlertDialog.Builder(this)
                    .setTitle(perTask ? "Model for: " + task.content : "Model")
                    .setView(wrapScroll(list))
                    .setNegativeButton("OK", null)
                    .create();
            chromeDialogSurface(emptyDialog);
            emptyDialog.show();
            styleDialogButtons(emptyDialog);
            return;
        }
        RadioGroup group = new RadioGroup(this);
        for (final String model : choices) {
            RadioButton rb = new RadioButton(this);
            String label = modelLabels.get(model);
            rb.setText(label != null && !label.isEmpty() ? label : model);
            rb.setTextColor(COLOR_TEXT);
            rb.setChecked(model.equals(current));
            group.addView(rb);
            buttons.put(model, rb);
        }
        list.addView(group);
        TextView hint = new TextView(this);
        hint.setText(perTask
                ? "Saved as an override for THIS session and sent to the PC bridge as an ORDER line. The workspace default ("
                        + DEFAULT_MODEL + ") is unchanged."
                : "GLM-5.3-Flash is the default. The choice is published to the workspace \"model\" card; PC sessions run it via opencode.");
        hint.setTextColor(COLOR_TEXT_DIM);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hint.setPadding(0, dp(8), 0, 0);
        list.addView(hint);
        // OpenCode missing-model red warning banner
        if ("opencode".equals(currentProviderPref())) {
            String banner = opencodeMissingBanner();
            if (banner != null) {
                TextView warning = new TextView(this);
                warning.setText(banner + " · refresh to retry");
                warning.setTextColor(COLOR_RED);
                warning.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                warning.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
                warning.setPadding(0, dp(8), 0, dp(4));
                list.addView(warning);
            }
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(perTask ? "Model for: " + task.content : "Model")
                .setView(wrapScroll(list))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, which) -> {
                    String chosen = currentInitial;
                    for (Map.Entry<String, RadioButton> e : buttons.entrySet()) {
                        if (e.getValue().isChecked()) { chosen = e.getKey(); break; }
                    }
                    final String model = chosen;
                    if (perTask) {
                        savePerTaskModel(task, model);
                    } else {
                        getSharedPreferences("daymark", MODE_PRIVATE).edit()
                                .putString(MODEL_PREF, model).apply();
                        if (modelChip != null) modelChip.setText(model);
                        publishModelChoice(model);
                    }
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /**
     * Per-task override: persisted locally, then the "\u2014 ORDER HH:MM \u2014
     * model: <id>" line is prepended to the task's description through the
     * instant patch queue so the PC bridge reads it as the next order.
     */
    private void savePerTaskModel(final DaymarkWorkspaceClient.TaskInfo task, final String model) {
        final String stamp = DaymarkWorkspaceClient.nowHHMM();
        getSharedPreferences("daymark", MODE_PRIVATE).edit()
                .putString(TASK_MODEL_PREF_PREFIX + task.id, model).apply();
        final boolean backToDefault = DEFAULT_MODEL.equals(model);
        final String token = backToDefault ? "default" : model;
        mutate(backToDefault
                        ? "Model reset to the default (GLM-5.3-Flash)"
                        : "Model " + model + " ordered for this session",
                state -> {
                DaymarkWorkspaceClient.prependLine(state, task.id,
                        "\u2014 ORDER " + stamp + " \u2014 model: " + token);
                return Boolean.TRUE;
        });
    }

    /** Create-if-missing the workspace "model" card, then write "model: X". */
    private void publishModelChoice(final String model) {
        if (snapshot == null || snapshot.projectId == null) {
            Toast.makeText(this, "Model saved locally; workspace not connected.", Toast.LENGTH_SHORT).show();
            return;
        }
        DaymarkWorkspaceClient.TaskInfo card = findTaskByTitle(MODEL_CARD_TITLE);
        final String desc = "model: " + model + "\n— update " +
                new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US)
                        .format(new java.util.Date()) + " — model set from the Android AI Workspace.";
        if (card != null) {
            mutate("Model set: " + model, state -> {
                DaymarkWorkspaceClient.patchTask(state, card.id, MODEL_CARD_TITLE, desc,
                        card.priority, null);
                return null;
            });
        } else {
            mutate("Model card created: " + model, state -> DaymarkWorkspaceClient.createTask(
                    state, snapshot.projectId, defaultCreateSectionId(),
                    MODEL_CARD_TITLE, desc, 2));
        }
    }

    private void showCreateDialog() {
        if (snapshot == null || snapshot.projectId == null) {
            Toast.makeText(this, "Connect the AIControlPanel workspace first.", Toast.LENGTH_SHORT).show();
            return;
        }
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), 0);
        EditText titleField = labeledField(form, "Session title");
        EditText descriptionField = labeledMultilineField(form, "Starting notes");
        attachButton(form);
        Spinner sectionSpinner = sectionSpinner(form, snapshot.projectId, defaultCreateSectionId());
        Spinner prioritySpinner = prioritySpinner(form, 2);
        // MODEL AT CREATION (user law: he picks the model when creating a new
        // session, not only after it exists). Delivered as the first ORDER
        // line of the created task, so the bridge runs it on that model from
        // its very first launch. Default stays GLM-5.3-Flash.
        final String[] chosenModel = {null};
        final TextView modelPick = (TextView) pillButton("Model: Default (GLM-5.3-Flash)", COLOR_PURPLE, COLOR_SURFACE);
        modelPick.setOnClickListener(v -> {
            final String[] choices = modelChoices();
            String[] shown = new String[choices.length];
            for (int i = 0; i < choices.length; i++) {
                String lb = modelLabels.get(choices[i]);
                shown[i] = lb != null && !lb.isEmpty() ? lb : choices[i];
            }
            new AlertDialog.Builder(this)
                    .setTitle("Model for this session")
                    .setItems(shown, (d2, which2) -> {
                        chosenModel[0] = choices[which2];
                        String lb = modelLabels.get(chosenModel[0]);
                        modelPick.setText("Model: " + (lb != null && !lb.isEmpty() ? lb : chosenModel[0]));
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
        });
        form.addView(modelPick, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("New session")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Create", (d, which) -> {
                    String content = titleField.getText().toString().trim();
                    if (content.isEmpty()) {
                        Toast.makeText(this, "A title is required.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    String pendingDesc = descriptionField.getText().toString().trim();
                    if (chosenModel[0] != null) {
                        String modelLine = "\u2014 ORDER " + DaymarkWorkspaceClient.nowHHMM() + " \u2014 model: " + chosenModel[0];
                        pendingDesc = pendingDesc.isEmpty() ? modelLine : modelLine + "\n" + pendingDesc;
                    }
                    final String descForCreate = pendingDesc;
                    final boolean hasAttach = !pendingAttaches.isEmpty();
                    mutate("Session created", state -> DaymarkWorkspaceClient.createTask(
                            state,
                            snapshot.projectId,
                            selectedId(sectionSpinner),
                            content,
                            descForCreate,
                            priorityOf(prioritySpinner)));
                    if (hasAttach) {
                        networkExecutor.execute(() -> {
                            // Wait for the create push to land, then upload the
                            // whole queue and prepend ONE journal line with every
                            // attachment id. If the create never lands or an
                            // upload fails, the queue is kept (never lost).
                            for (int wait = 0; wait < 10; wait++) {
                                SystemClock.sleep(1500L);
                                DaymarkWorkspaceClient.TaskInfo fresh = findTaskByTitle(content);
                                if (fresh == null) continue;
                                uploadQueueAndJournal(fresh.id);
                                mainHandler.post(() -> {
                                    updateAttachButtonText();
                                    renderAttachQueue();
                                });
                                return;
                            }
                            mainHandler.post(() -> {
                                updateAttachButtonText();
                                renderAttachQueue();
                                Toast.makeText(this,
                                        "Session may not have been created; attachments stay queued.",
                                        Toast.LENGTH_LONG).show();
                            });
                        });
                    }
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    private void showEditDialog(DaymarkWorkspaceClient.TaskInfo task) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), 0);
        EditText titleField = labeledField(form, "Session title");
        titleField.setText(task.content);
        EditText descriptionField = labeledMultilineField(form, "Description (agent journal)");
        descriptionField.setText(task.description);
        Spinner prioritySpinner = prioritySpinner(form, task.priority);
        Spinner sectionSpinner = snapshot != null ? sectionSpinner(form, task.projectId, task.sectionId) : null;

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Edit session")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, which) -> mutate("Session saved", state -> {
                    DaymarkWorkspaceClient.patchTask(
                            state,
                            task.id,
                            titleField.getText().toString().trim(),
                            descriptionField.getText().toString(),
                            priorityOf(prioritySpinner),
                            sectionSpinner == null ? null : selectedId(sectionSpinner));
                    return null;
                }))
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /**
     * Retry a finished session: one dialog (optional prompt), then immediately
     * reopen + move to In Progress + assign (same "— pinned — / session
     * assigned" lines as the Assign button) and, when a prompt was typed,
     * prepend "— ORDER HH:MM — do this now: <prompt>; when finished continue
     * exactly where you left off".
     */
    private void showRetryDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText promptField = labeledMultilineField(form, "Optional prompt for the new run\u2026");
        helperText(form, "Restarts the session pinned to In Progress immediately.");

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Retry session")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Start", (d, which) -> {
                    String prompt = promptField.getText().toString().trim();
                    mutate("Retry started \u00b7 pinned to In Progress", state -> {
                        DaymarkWorkspaceClient.setTaskCompleted(state, task.id, false);
                        DaymarkWorkspaceClient.assignSession(state, task.id);
                        if (!prompt.isEmpty()) {
                            DaymarkWorkspaceClient.prependLine(state, task.id,
                                    DaymarkWorkspaceClient.buildOrderLine("step", prompt));
                        }
                        return null;
                    });
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    private void showLogUpdateDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText noteField = labeledMultilineField(form, "What changed? (prepends \u2014 update HH:MM \u2014)");
        helperText(form, "Appears instantly as the session's newest journal line.");

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Log update")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Log", (d, which) -> {
                    String note = noteField.getText().toString().trim();
                    if (note.isEmpty()) return;
                    mutate("Update logged", state -> {
                        DaymarkWorkspaceClient.logUpdate(state, task.id, note);
                        return null;
                    });
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    /**
     * Guaranteed channel to a session: prepends "— message HH:MM — <text>" at the
     * very top (below — pinned —). Finished sessions are first reopened and moved
     * to In Progress with a "— REOPENED —" line so the message is guaranteed to be
     * seen. Arms the 90-second auto-nudge ("awaiting AI reply" pill).
     */
    private void showMessageDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        showMessageDialog(task, null);
    }

    /** Re-openable variant: {@code presetText} keeps the user's text after a failure. */
    private void showMessageDialog(final DaymarkWorkspaceClient.TaskInfo task,
            final String presetText) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText messageField = labeledField(form, "Message to the session");
        messageField.setHint("Type an order for the agent\u2026");
        helperText(form, "Guaranteed channel \u00b7 finished sessions reopen automatically.");
        if (presetText != null) messageField.setText(presetText);
        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Message session")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Send", null)
                .create();
        chromeDialogSurface(dialog);
        // Override the click so a failed send can keep the dialog (and its text) open.
        dialog.setOnShowListener(which -> {
            styleDialogButtons(dialog);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    .setOnClickListener(view -> {
                        // Single line only: collapse any newline into a space.
                        String text = messageField.getText().toString()
                                .replaceAll("[\\r\\n]+", " ").trim();
                        if (text.isEmpty()) {
                            Toast.makeText(this, "Nothing to send.", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        final String hookTaskId = task.id;
                        sendWithAttachment(hookTaskId, text, finalText ->
                                runOnUiThread(() -> sendVerifiedMessage(task, finalText)));
                        dialog.dismiss();
                    });
        });
        dialog.show();
    }

    /**
     * Sends through the read-back-verified client channel (conflict + silent-loss
     * retry, up to 5 attempts). Optimistically shows the line on the card, then
     * refreshes immediately; on final failure shows "message failed to send — tap
     * to retry" and re-opens the dialog with the text preserved.
     */
    private void sendVerifiedMessage(final DaymarkWorkspaceClient.TaskInfo task,
            final String text) {
        final boolean finished = task.completed
                || (snapshot != null && finishedSectionIds.contains(task.sectionId));
        final String stamp = DaymarkWorkspaceClient.nowHHMM();
        final String line = "\u2014 message " + stamp + " \u2014 " + text;
        // Optimistic: show the new journal line on the card immediately.
        try {
            JSONObject optimistic = new JSONObject(task.raw.toString());
            String existing = optimistic.optString("description", "");
            optimistic.put("description", existing.isEmpty() ? line : line + "\n" + existing);
            optimistic.put("updatedAt", DaymarkWorkspaceClient.nowIso());
            if (finished) optimistic.put("completedAt", JSONObject.NULL);
            applyOptimisticView(task.id, optimistic, false);
        } catch (JSONException error) {
            Log.w("DaymarkAi", "message optimistic view failed: " + error.getMessage());
        }
        synchronized (pendingMessages) {
            pendingMessages.put(task.id, new PendingMessage(System.currentTimeMillis()));
        }
        networkExecutor.execute(() -> {
            try {
                DaymarkWorkspaceClient.sendMessage(syncKey, task.id, text, finished, stamp);
                mainHandler.post(() -> {
                    Toast.makeText(this, "Message sent", Toast.LENGTH_SHORT).show();
                    refreshNow();
                });
            } catch (Exception error) {
                Log.w("DaymarkAi", "message send failed: " + error.getMessage());
                mainHandler.post(() -> {
                    synchronized (pendingMessages) {
                        pendingMessages.remove(task.id);
                    }
                    savingIds.remove(task.id);
                    Toast.makeText(this,
                            "message failed to send \u2014 tap to retry",
                            Toast.LENGTH_LONG).show();
                    refreshNow();
                    DaymarkWorkspaceClient.TaskInfo fresh = findTask(task.id);
                    if (fresh != null) showMessageDialog(fresh, text);
                });
            }
        });
    }

    /**
     * Sub-agent control: sends "— ORDER HH:MM — sub-agents: <choice>" (create-N,
     * stop-all, or free-text custom order) through the read-back-verified order
     * channel, exactly like the message channel.
     */
    private void showAgentsDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        showAgentsDialog(task, null, -1, null);
    }

    /** Re-openable variant: keeps the count, choice and custom text after a failure. */
    private void showAgentsDialog(final DaymarkWorkspaceClient.TaskInfo task,
            final String presetCount, final int presetChoice, final String presetCustom) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText countField = labeledField(form, "Number of sub-agents (N)");
        helperText(form, "How many parallel sub-agents to spawn for this session.");
        countField.setText(presetCount != null ? presetCount : "2");
        List<String> choices = new ArrayList<>();
        choices.add("Create N sub-agents");
        choices.add("Stop all agents");
        choices.add("Custom order text");
        Spinner choiceSpinner = choiceSpinner(form, "Action", choices,
                presetChoice >= 0 ? presetChoice : 0);
        EditText customField = labeledField(form, "Custom order (for Custom order text)");
        customField.setHint("e.g. 2 agents: one tests, one writes docs\u2026");
        if (presetCustom != null && !presetCustom.isEmpty()) customField.setText(presetCustom);

        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Sub-agents")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Send order", null)
                .create();
        chromeDialogSurface(dialog);
        // Override the click so a failed send can keep the dialog (and inputs) open.
        dialog.setOnShowListener(show -> {
            styleDialogButtons(dialog);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                String payload;
                switch (choiceSpinner.getSelectedItemPosition()) {
                    case 0:
                        int count;
                        String countInput = countField.getText().toString().trim();
                        try {
                            count = Integer.parseInt(countInput);
                        } catch (NumberFormatException ignored) {
                            count = 0;
                        }
                        if (count < 1) {
                            Toast.makeText(this,
                                    "Enter the exact number of agents (1 or more).",
                                    Toast.LENGTH_SHORT).show();
                            return;
                        }
                        payload = "create " + count + " agents";
                        break;
                    case 1:
                        payload = "stop all agents";
                        break;
                    default:
                        payload = "custom: " + customField.getText().toString().trim();
                        break;
                }
                if (payload.endsWith(": ") || payload.trim().isEmpty()) {
                    Toast.makeText(this, "Enter a custom order first.", Toast.LENGTH_SHORT).show();
                    return;
                }
                final String countText = countField.getText().toString();
                final int choicePosition = choiceSpinner.getSelectedItemPosition();
                final String customText = customField.getText().toString();
                String orderLine = DaymarkWorkspaceClient.buildOrderLine("agents", payload);
                sendVerifiedOrderForTask(task, orderLine, "Agent order sent", () -> {
                    DaymarkWorkspaceClient.TaskInfo fresh = findTask(task.id);
                    showAgentsDialog(fresh != null ? fresh : task,
                            countText, choicePosition, customText);
                });
                dialog.dismiss();
            });
        });
        dialog.show();
    }

    /**
     * Extra step on a live session: sends the canonical
     * "— ORDER HH:MM — do this now: <text>; when finished continue exactly where you left off"
     * through the read-back-verified order channel.
     */
    private void showAddStepDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        showAddStepDialog(task, null);
    }

    /** Re-openable variant: {@code presetText} keeps the user's step after a failure. */
    private void showAddStepDialog(final DaymarkWorkspaceClient.TaskInfo task,
            final String presetText) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText stepField = labeledMultilineField(form, "Extra step for the session");
        helperText(form, "Prepends an ORDER the agent runs before continuing its plan.");
        stepField.setHint("What should the agent do now?\u2026");
        attachButton(form);
        if (presetText != null) stepField.setText(presetText);
        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Add step")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Send", null)
                .create();
        chromeDialogSurface(dialog);
        // Override the click so a failed send can keep the dialog (and its text) open.
        dialog.setOnShowListener(show -> {
            styleDialogButtons(dialog);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                // Single line only: collapse any newline into a space.
                String text = stepField.getText().toString()
                        .replaceAll("[\\r\\n]+", " ").trim();
                if (text.isEmpty()) {
                    Toast.makeText(this, "Nothing to send.", Toast.LENGTH_SHORT).show();
                    return;
                }
                sendWithAttachment(task.id, text, finalText -> runOnUiThread(() -> {
                    String orderLine = DaymarkWorkspaceClient.buildOrderLine("step", finalText);
                    sendVerifiedOrderForTask(task, orderLine, "Step sent", () -> {
                        DaymarkWorkspaceClient.TaskInfo fresh = findTask(task.id);
                        showAddStepDialog(fresh != null ? fresh : task, finalText);
                    });
                }));
                dialog.dismiss();
            });
        });
        dialog.show();
    }

    /**
     * Sends an already-built "— ORDER —" line through the read-back-verified client
     * channel (conflict + silent-loss retry). Optimistically shows the line on the
     * card first — finished sessions are reopened like the message channel — then
     * refreshes; on final failure toasts "order failed to send — tap to retry" and
     * re-opens the originating dialog with the user's input preserved.
     */
    private void sendVerifiedOrderForTask(final DaymarkWorkspaceClient.TaskInfo task,
            final String orderLine, final String successMessage, final Runnable retryWithInput) {
        final boolean finished = task.completed
                || (snapshot != null && finishedSectionIds.contains(task.sectionId));
        final String stamp = orderStamp(orderLine);
        // Optimistic: show the new journal line on the card immediately.
        try {
            JSONObject optimistic = new JSONObject(task.raw.toString());
            String existing = optimistic.optString("description", "");
            optimistic.put("description", existing.isEmpty() ? orderLine : orderLine + "\n" + existing);
            optimistic.put("updatedAt", DaymarkWorkspaceClient.nowIso());
            if (finished) optimistic.put("completedAt", JSONObject.NULL);
            applyOptimisticView(task.id, optimistic, false);
        } catch (JSONException error) {
            Log.w("DaymarkAi", "order optimistic view failed: " + error.getMessage());
        }
        networkExecutor.execute(() -> {
            try {
                DaymarkWorkspaceClient.sendVerifiedOrder(syncKey, task.id, orderLine, finished, stamp);
                mainHandler.post(() -> {
                    Toast.makeText(this, successMessage, Toast.LENGTH_SHORT).show();
                    refreshNow();
                });
            } catch (Exception error) {
                Log.w("DaymarkAi", "order send failed: " + error.getMessage());
                mainHandler.post(() -> {
                    savingIds.remove(task.id);
                    Toast.makeText(this,
                            "order failed to send \u2014 tap to retry",
                            Toast.LENGTH_LONG).show();
                    refreshNow();
                    if (retryWithInput != null) retryWithInput.run();
                });
            }
        });
    }

    /** "14:32" out of "— ORDER 14:32 — …"; falls back to the current time. */
    private static String orderStamp(String orderLine) {
        java.util.regex.Matcher matcher = ORDER_STAMP.matcher(orderLine);
        return matcher.find() ? matcher.group(1) : DaymarkWorkspaceClient.nowHHMM();
    }

    private void showMoveDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        final JSONObject state = lastState;
        if (state == null) {
            Toast.makeText(this, "Still syncing \u2014 tap again in a moment.", Toast.LENGTH_SHORT).show();
            return;
        }
        final List<String[]> projectChoices = collectProjects(state);
        if (projectChoices.isEmpty()) {
            Toast.makeText(this, "No projects available.", Toast.LENGTH_SHORT).show();
            return;
        }
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), 0);
        Spinner projectSpinner = choiceSpinner(form, "Project", projectNames(projectChoices),
                indexOfProject(projectChoices, task.projectId));
        Spinner sectionSpinner = new Spinner(this);
        labelField(form, "Section");
        form.addView(sectionSpinner);
        final boolean[] suppress = {false};
        Runnable populateSections = () -> populateSectionSpinner(state, sectionSpinner,
                projectChoices.get(projectSpinner.getSelectedItemPosition())[0], task.sectionId, suppress);
        projectSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (!suppress[0]) populateSections.run();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        populateSections.run();

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Move session")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Move", (d, which) -> {
                    String targetProject = projectChoices.get(projectSpinner.getSelectedItemPosition())[0];
                    String targetSection = selectedId(sectionSpinner);
                    mutate("Session moved", state2 -> {
                        // Duplicate section names exist on the server; resolve to the
                        // same-named section that actually holds tasks (or first by
                        // creation order) so moves never hit "task location invalid".
                        DaymarkWorkspaceClient.moveTask(state2, task.id, targetProject,
                                DaymarkWorkspaceClient.resolveDuplicateSection(
                                        state2, targetProject, targetSection));
                        return null;
                    });
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    private void showSyncKeyDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), dp(8));
        EditText keyField = labeledField(form, "22-character sync key");
        helperText(form, "Found in Daymark under Settings \u00b7 Sync.");
        keyField.setText(syncKey == null ? "" : syncKey);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Pair workspace")
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, which) -> {
                    String key = keyField.getText().toString().trim();
                    if (!DaymarkWorkspaceClient.isSyncKeyShape(key)) {
                        Toast.makeText(this, "Daymark sync keys are 22 characters.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    DaymarkWorkspaceClient.writeSyncKey(this, key);
                    syncKey = key;
                    publishedRevision = -1L;
                    lastState = null;
                    postStatus("Connecting\u2026", COLOR_TEXT_DIM);
                })
                .create();
        chromeDialogSurface(dialog);
        dialog.show();
        styleDialogButtons(dialog);
    }

    // ---- Usage strip ----

    /** Quiet header pill: shorter and dimmer than card pills (top row). */
    private void styleQuietHeaderButton(View button) {
        if (!(button instanceof TextView)) return;
        TextView b = (TextView) button;
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_CAPTION);
        b.setMinimumHeight(dp(40));
        b.setPadding(dp(SPACE_M), dp(SPACE_XS), dp(SPACE_M), dp(SPACE_XS));
        b.setMaxLines(1);
        b.setEllipsize(TextUtils.TruncateAt.END);
    }

    /** Instrument usage strip: 5h/7d gauges + reset countdown; "usage stale" past 30 min. */
    private void renderUsage() {
        if (usageStrip == null) return;
        JSONObject usage = lastUsage;
        JSONObject fiveHour = usage == null ? null : usage.optJSONObject("fiveHour");
        JSONObject sevenDay = usage == null ? null : usage.optJSONObject("sevenDay");
        if (fiveHour == null && sevenDay == null) {
            usageStrip.setVisibility(View.GONE);
            return;
        }
        usageStrip.removeAllViews();
        long now = System.currentTimeMillis();
        long resetsAt = 0L;
        long updatedAt = 0L;
        if (fiveHour != null) {
            usageStrip.addView(usageGauge("5h", fiveHour.optInt("remainingPct", 0)));
            resetsAt = fiveHour.optLong("resetsAtMs", 0L);
            updatedAt = Math.max(updatedAt, parseUpdatedMs(fiveHour.opt("updatedAt")));
        }
        if (sevenDay != null) {
            usageStrip.addView(usageGauge("7d", sevenDay.optInt("remainingPct", 0)));
            if (resetsAt == 0L) resetsAt = sevenDay.optLong("resetsAtMs", 0L);
            updatedAt = Math.max(updatedAt, parseUpdatedMs(sevenDay.opt("updatedAt")));
        }
        if (apiBalanceText != null) {
            TextView apiView = new TextView(this);
            apiView.setText("\u26a1 API " + apiBalanceText);
            apiView.setTextColor(COLOR_GREEN);
            apiView.setTextSize(TypedValue.COMPLEX_UNIT_SP, TYPE_CAPTION);
            apiView.setPadding(dp(SPACE_M), 0, 0, 0);
            usageStrip.addView(apiView);
        }
        StringBuilder meta = new StringBuilder();
        if (resetsAt > now) meta.append("resets ").append(countdown(resetsAt - now));
        if (updatedAt <= 0L || now - updatedAt > USAGE_STALE_MS) {
            if (meta.length() > 0) meta.append(" \u00b7 ");
            meta.append("stale");
        }
        if (meta.length() > 0) {
            TextView metaView = new TextView(this);
            metaView.setText(meta.toString());
            metaView.setTextColor(COLOR_TEXT_DIM);
            metaView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            metaView.setSingleLine(true);
            metaView.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams metaParams = new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            metaParams.leftMargin = dp(8);
            metaView.setLayoutParams(metaParams);
            usageStrip.addView(metaView);
        }
        usageStrip.setVisibility(View.VISIBLE);
    }

    /** One gauge: dim "5h 92%" label + a 4dp rounded track with accent remaining fill. */
    private View usageGauge(String label, int remainingPct) {
        LinearLayout gauge = new LinearLayout(this);
        gauge.setOrientation(LinearLayout.HORIZONTAL);
        gauge.setGravity(Gravity.CENTER_VERTICAL);
        TextView text = new TextView(this);
        text.setText(label + " " + Math.max(0, Math.min(100, remainingPct)) + "%");
        text.setTextColor(COLOR_TEXT_DIM);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        gauge.addView(text);
        int trackWidth = dp(64);
        FrameLayout track = new FrameLayout(this);
        track.setBackground(roundedBg(COLOR_SURFACE, 2, 0, 0));
        LinearLayout.LayoutParams trackParams = new LinearLayout.LayoutParams(trackWidth, dp(4));
        trackParams.leftMargin = dp(6);
        track.setLayoutParams(trackParams);
        View fill = new View(this);
        fill.setBackground(roundedBg(COLOR_ACCENT, 2, 0, 0));
        fill.setLayoutParams(new FrameLayout.LayoutParams(
                Math.max(dp(2), trackWidth * Math.max(0, Math.min(100, remainingPct)) / 100),
                ViewGroup.LayoutParams.MATCH_PARENT));
        track.addView(fill);
        gauge.addView(track);
        LinearLayout.LayoutParams gaugeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gaugeParams.rightMargin = dp(12);
        gauge.setLayoutParams(gaugeParams);
        return gauge;
    }

    /** updatedAt may be epoch millis or an ISO-8601 timestamp; 0 when absent/unparseable. */
    private static long parseUpdatedMs(Object raw) {
        if (raw instanceof Number) return ((Number) raw).longValue();
        if (!(raw instanceof String)) return 0L;
        String value = (String) raw;
        try {
            return Long.parseLong(value);
        } catch (Exception notNumber) {
            // fall through to ISO-8601
        }
        String normalized = value.trim().replace("Z", "+0000").replace("+00:00", "+0000");
        String[] patterns = {"yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss"};
        for (String pattern : patterns) {
            try {
                java.text.SimpleDateFormat format = new java.text.SimpleDateFormat(pattern, java.util.Locale.US);
                format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                format.setLenient(false);
                return format.parse(normalized).getTime();
            } catch (Exception badPattern) {
                // try the next pattern
            }
        }
        return 0L;
    }

    /** "2h15m" / "45m" style countdown for the usage reset label. */
    private static String countdown(long millis) {
        long minutes = millis / 60_000L;
        if (minutes >= 60) return (minutes / 60) + "h" + (minutes % 60) + "m";
        return minutes + "m";
    }

    // ---- Pending message channel (awaiting AI reply + auto-nudge) ----

    /**
     * TO-DO REORDER (user demand): \u2515/\u2514 buttons on To-do cards swap the
     * card's order with its neighbour, so the user chooses exactly which task
     * AUTO runs before what. One optimistic push, order values swapped.
     */
    /**
     * TO-DO REORDER (user demand): type the position number to switch to.
     * ONE optimistic push rewrites every To-do order value with this task
     * inserted at the typed position — always correct, under 2 seconds.
     * AUTO picks the lowest order, so this directly chooses its run order.
     */
    private void showTodoOrderDialog(final DaymarkWorkspaceClient.TaskInfo task) {
        // The pool is the task's OWN tab: To do orders within To do, In
        // Progress orders within In Progress. Finished is never offered.
        final List<DaymarkWorkspaceClient.TaskInfo> todos = new ArrayList<>();
        final boolean inProgress = progressSectionIds.contains(task.sectionId);
        if (snapshot != null) {
            for (DaymarkWorkspaceClient.TaskInfo t2 : snapshot.tasks) {
                if (t2.completed) continue;
                boolean member = inProgress
                        ? progressSectionIds.contains(t2.sectionId)
                        : todoSectionIds.contains(t2.sectionId);
                if (member) todos.add(t2);
            }
        }
        todos.sort((a, b) -> Double.compare(a.order, b.order));
        int current = todos.indexOf(task) + 1;
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(16), dp(24), 0);
        EditText positionField = labeledField(form, "New position number (1 = runs first)");
        positionField.setText(String.valueOf(Math.max(1, current)));
        positionField.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        new AlertDialog.Builder(this)
                .setTitle("Order: " + task.content)
                .setView(wrapScroll(form))
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Move", (d, which) -> {
                    int target;
                    try {
                        target = Integer.parseInt(positionField.getText().toString().trim());
                    } catch (NumberFormatException error) { return; }
                    if (target < 1) target = 1;
                    if (target > todos.size()) target = todos.size();
                    reorderTodoTo(task, todos, target - 1);
                })
                .show();
    }

    private void reorderTodoTo(final DaymarkWorkspaceClient.TaskInfo task,
            final List<DaymarkWorkspaceClient.TaskInfo> todos, final int targetIndex) {
        // Reorder via the bridge channel: ONE marker line (tiny push, retry-
        // hardened) — the PC bridge applies the order through the agent API,
        // which cannot lose races. Optimistic UI moves the card immediately.
        final String stamp = new java.text.SimpleDateFormat("HH:mm", Locale.US)
                .format(new java.util.Date());
        final String marker = "\u2014 ORDER " + stamp + " \u2014 reorder: position " + (targetIndex + 1);
        mutate("Order changed", state -> {
            // Optimistic: move the card locally so the UI is instant.
            final List<DaymarkWorkspaceClient.TaskInfo> optimistic = new ArrayList<>(todos);
            optimistic.sort((a, b) -> Double.compare(a.order, b.order));
            optimistic.remove(task);
            optimistic.add(Math.max(0, Math.min(targetIndex, optimistic.size())), task);
            JSONObject tasks = state.optJSONObject("tasks");
            if (tasks != null) {
                for (int i = 0; i < optimistic.size(); i++) {
                    JSONObject o = tasks.optJSONObject(optimistic.get(i).id);
                    if (o != null) o.put("order", i + 1);
                }
                DaymarkWorkspaceClient.prependLine(state, task.id, marker);
            }
            return null;
        });
        Toast.makeText(this, "Moving to position " + (targetIndex + 1) + "\u2026", Toast.LENGTH_SHORT).show();
        final List<DaymarkWorkspaceClient.TaskInfo> ordered = new ArrayList<>(todos);
        ordered.sort((a, b) -> Double.compare(a.order, b.order));
        ordered.remove(task);
        ordered.add(Math.max(0, Math.min(targetIndex, ordered.size())), task);
        final List<String> ordIds = new ArrayList<>();
        final List<Integer> ordVals = new ArrayList<>();
        for (int i = 0; i < ordered.size(); i++) {
            ordIds.add(ordered.get(i).id);
            ordVals.add(i + 1);
        }
        networkExecutor.execute(() -> {
            // DIRECT VOLLEY FIRST (<1s): every affected card PATCHes in parallel.
            boolean directOk = false;
            if (syncKey != null && !syncKey.isEmpty()) {
                try {
                    directOk = DaymarkWorkspaceClient.patchOrdersParallel(syncKey, ordIds, ordVals);
                } catch (Exception error) {
                    Log.w("DaymarkAi", "direct order volley failed: " + error.getMessage());
                }
                // HONEST SUCCESS: the volley "landing" is not enough — re-fetch
                // the moved task and confirm the SERVER stored the chosen
                // position. Server order is the single truth.
                if (directOk) {
                    directOk = verifyServerOrder(syncKey, task.id, targetIndex + 1);
                    if (!directOk) {
                        Log.w("DaymarkAi", "order volley applied but server order mismatch - bridge marker retry");
                    }
                }
            }
            if (directOk) {
                mainHandler.post(() -> {
                    Toast.makeText(this, "Order applied", Toast.LENGTH_SHORT).show();
                    refreshNow();
                });
                return;
            }
            // ONE auto-retry through the bridge marker channel (the marker
            // write is read-back verified inside prependJournalLine); after
            // that, an honest failure — never a fake "applied".
            boolean markerOk = false;
            try {
                DaymarkWorkspaceClient.prependJournalLine(
                        syncKey == null ? "" : syncKey, task.id, marker);
                markerOk = true;
            } catch (Exception error) {
                Log.w("DaymarkAi", "reorder marker retry failed: " + error.getMessage());
            }
            final boolean orderedOk = markerOk;
            mainHandler.post(() -> {
                if (orderedOk) {
                    Toast.makeText(this, "Order sent via bridge \u2014 applying", Toast.LENGTH_SHORT).show();
                    refreshNow();
                } else {
                    Toast.makeText(this,
                            "Could not apply the order \u00b7 try again", Toast.LENGTH_LONG).show();
                }
            });
        });
    }

    /** TRUE only when the server's stored order for the task equals the chosen position. */
    private boolean verifyServerOrder(String key, String taskId, int wantedOrder) {
        try {
            JSONObject raw = new JSONObject(DaymarkWorkspaceClient.fetchTaskRaw(key, taskId));
            double serverOrder = raw.optDouble("order", Double.NaN);
            boolean match = !Double.isNaN(serverOrder)
                    && Math.abs(serverOrder - wantedOrder) < 0.01;
            if (!match) {
                Log.w("DaymarkAi", "order verify: wanted " + wantedOrder
                        + ", server has " + serverOrder);
            }
            return match;
        } catch (Exception error) {
            Log.w("DaymarkAi", "order verify fetch failed: " + error.getMessage());
            return false;
        }
    }
    /**
     * HAND (user law, absolute): under TWO SECONDS the task is moved to To do —
     * the optimistic mutate writes the section change and the hand ORDER marker
     * in ONE push, and the bridge's stop-on-finish terminates the session tree
     * within seconds. The park timestamp blocks AUTO from re-running it for
     * 2 minutes; it stays in To do until the user (or AUTO after the hold)
     * sends it back to In Progress, where it continues from the ledger.
     */
    private void handParkTask(final DaymarkWorkspaceClient.TaskInfo task) {
        final String stamp = DaymarkWorkspaceClient.nowHHMM();
        mutate("Handed \u00b7 parked to To do", state -> {
            DaymarkWorkspaceClient.moveTaskToTodoSection(state, task.id);
            // prependLine is a PURE state edit: the section move + the hand
            // marker land in ONE push, which is what makes the park instant.
            DaymarkWorkspaceClient.prependLine(state, task.id,
                    "\u2014 ORDER " + stamp + " \u2014 hand: parked to To do by the user; run /handoff and save the handoff before any further work");
            return null;
        });
        markAutoParked(task.id);
        Toast.makeText(this, task.content + " handed \u2192 To do", Toast.LENGTH_SHORT).show();
    }

    /** AUTO hold: tasks handed to To do are not auto-restarted for 2 minutes. */
    private void markAutoParked(String taskId) {
        getSharedPreferences("daymark", MODE_PRIVATE).edit()
                .putString("auto_park_" + taskId, String.valueOf(System.currentTimeMillis()))
                .apply();
    }

    private boolean autoParkedRecently(String taskId) {
        String raw = getSharedPreferences("daymark", MODE_PRIVATE)
                .getString("auto_park_" + taskId, null);
        if (raw == null) return false;
        long parkedAt;
        try { parkedAt = Long.parseLong(raw); } catch (NumberFormatException e) { return false; }
        return System.currentTimeMillis() - parkedAt < 120_000L;
    }

    private DaymarkWorkspaceClient.TaskInfo findTaskByTitle(String title) {
        if (snapshot == null || title == null) return null;
        for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
            if (title.equals(task.content)) return task;
        }
        return null;
    }

    private DaymarkWorkspaceClient.TaskInfo findTask(String taskId) {
        if (snapshot == null) return null;
        for (DaymarkWorkspaceClient.TaskInfo task : snapshot.tasks) {
            if (task.id.equals(taskId)) return task;
        }
        return null;
    }

    /**
     * Clears pills once a newer agent update/heartbeat lands; sends the 90s
     * "— ORDER — unanswered message nudge" (max 2 per message) otherwise.
     */
    private void checkPendingMessages() {
        if (snapshot == null || pendingMessages.isEmpty()) return;
        List<String> nudgeIds = new ArrayList<>();
        boolean changed = false;
        long now = System.currentTimeMillis();
        synchronized (pendingMessages) {
            Iterator<Map.Entry<String, PendingMessage>> it = pendingMessages.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, PendingMessage> entry = it.next();
                DaymarkWorkspaceClient.TaskInfo task = findTask(entry.getKey());
                if (task == null || task.completed) {
                    it.remove();
                    changed = true;
                    continue;
                }
                SessionUpdateParser.Result journal = SessionUpdateParser.parse(
                        task.description, task.updatedAtMillis);
                if (journal.latestAgent != null
                        && journal.latestAgent.timeMillis > entry.getValue().sentAt) {
                    // The agent answered; the guaranteed channel is clear.
                    it.remove();
                    changed = true;
                    continue;
                }
                PendingMessage pending = entry.getValue();
                if (pending.nudges < MAX_NUDGES
                        && now - pending.sentAt >= NUDGE_AFTER_MS * (pending.nudges + 1)) {
                    pending.nudges += 1;
                    nudgeIds.add(entry.getKey());
                }
            }
        }
        for (final String taskId : nudgeIds) {
            String line = "\u2014 ORDER " + DaymarkWorkspaceClient.nowHHMM()
                    + " \u2014 unanswered message nudge: reply to the message above now";
            networkExecutor.execute(() -> {
                try {
                    DaymarkWorkspaceClient.prependJournalLine(syncKey, taskId, line);
                    refreshNow();
                } catch (Exception error) {
                    Log.w("DaymarkAi", "message nudge failed: " + error.getMessage());
                }
            });
        }
        if (changed && adapter != null) adapter.notifyDataSetChanged();
    }

    // ---- Dialog helpers ----

    private View wrapScroll(LinearLayout form) {
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(form);
        return scroll;
    }

    /** Small dim helper line under a dialog input. */
    private void helperText(LinearLayout parent, String text) {
        TextView helper = new TextView(this);
        helper.setText(text);
        helper.setTextColor(withAlpha(COLOR_TEXT_DIM, 0xCC));
        helper.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        helper.setPadding(dp(2), dp(3), dp(2), dp(2));
        parent.addView(helper);
    }

    /** Modern rounded dark surface behind every dialog; call before show(). */
    private void chromeDialogSurface(AlertDialog dialog) {
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(roundedBg(COLOR_SURFACE, (int) RADIUS_FLOAT, COLOR_STROKE, 1));
        }
    }

    /** Quiet text buttons: accent confirm, dim dismiss. No fills. */
    private void styleDialogButtons(AlertDialog dialog) {
        android.widget.Button positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
        if (positive != null) {
            positive.setBackground(rippleRounded(Color.TRANSPARENT, 999, 0, 0, COLOR_ACCENT));
            positive.setTextColor(COLOR_ACCENT);
            positive.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            positive.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            positive.setAllCaps(false);
            positive.setPadding(dp(18), dp(8), dp(18), dp(8));
        }
        android.widget.Button negative = dialog.getButton(AlertDialog.BUTTON_NEGATIVE);
        if (negative != null) {
            negative.setBackground(rippleRounded(
                    Color.TRANSPARENT, 999, 0, 0, COLOR_TEXT_DIM));
            negative.setTextColor(COLOR_TEXT_DIM);
            negative.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            negative.setAllCaps(false);
            negative.setPadding(dp(16), dp(8), dp(16), dp(8));
        }
    }

    private void labelField(LinearLayout parent, String label) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextColor(COLOR_TEXT_DIM);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        view.setPadding(0, dp(12), 0, dp(4));
        parent.addView(view);
    }

    private EditText labeledField(LinearLayout parent, String label) {
        labelField(parent, label);
        EditText field = new EditText(this);
        field.setTextColor(COLOR_TEXT);
        field.setHintTextColor(COLOR_TEXT_DIM);
        field.setBackground(roundedBg(COLOR_SURFACE, (int) RADIUS_INNER, COLOR_STROKE, 1));
        field.setPadding(dp(10), dp(8), dp(10), dp(8));
        field.setSingleLine(true);
        parent.addView(field);
        return field;
    }

    private EditText labeledMultilineField(LinearLayout parent, String label) {
        labelField(parent, label);
        EditText field = new EditText(this);
        field.setTextColor(COLOR_TEXT);
        field.setHintTextColor(COLOR_TEXT_DIM);
        field.setBackground(roundedBg(COLOR_SURFACE, (int) RADIUS_INNER, COLOR_STROKE, 1));
        field.setPadding(dp(10), dp(8), dp(10), dp(8));
        field.setMinLines(2);
        field.setMaxLines(8);
        field.setGravity(Gravity.TOP);
        parent.addView(field);
        return field;
    }

    private Spinner choiceSpinner(LinearLayout parent, String label, List<String> values, int selection) {
        labelField(parent, label);
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapterView = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, values);
        adapterView.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapterView);
        if (selection >= 0) spinner.setSelection(selection);
        parent.addView(spinner);
        return spinner;
    }

    /** Spinner whose tag holds the [id, name] rows so selections map back to business ids. */
    private Spinner sectionSpinner(LinearLayout parent, String projectId, String selectedSectionId) {
        labelField(parent, "Section");
        Spinner spinner = new Spinner(this);
        parent.addView(spinner);
        populateSectionSpinner(lastState, spinner, projectId, selectedSectionId, new boolean[] {false});
        return spinner;
    }

    private String selectedId(Spinner spinner) {
        Object tag = spinner.getTag();
        if (!(tag instanceof List) || ((List<?>) tag).isEmpty()) return null;
        int position = Math.max(0, spinner.getSelectedItemPosition());
        List<?> choices = (List<?>) tag;
        if (position >= choices.size()) return null;
        Object choice = choices.get(position);
        if (choice instanceof String[]) {
            return ((String[]) choice)[0];
        }
        return null;
    }

    private void populateSectionSpinner(JSONObject state, Spinner spinner, String projectId,
            String selectedSectionId, boolean[] suppress) {
        List<String[]> choices = new ArrayList<>();
        choices.add(new String[] {null, "(no section)"});
        if (state != null) {
            JSONObject sections = state.optJSONObject("sections");
            if (sections != null) {
                List<Object[]> rows = new ArrayList<>();
                java.util.Iterator<String> keys = sections.keys();
                while (keys.hasNext()) {
                    JSONObject section = sections.optJSONObject(keys.next());
                    if (section != null && projectId.equals(section.optString("projectId", ""))) {
                        rows.add(new Object[] {section.optString("id"), section.optString("name", ""),
                                section.optDouble("order", 0d)});
                    }
                }
                Collections.sort(rows, (left, right) -> Double.compare((Double) left[2], (Double) right[2]));
                for (Object[] row : rows) {
                    choices.add(new String[] {(String) row[0], (String) row[1]});
                }
            }
        }
        List<String> names = new ArrayList<>();
        for (String[] choice : choices) names.add(choice[1]);
        ArrayAdapter<String> adapterView = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, names);
        adapterView.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        suppress[0] = true;
        spinner.setAdapter(adapterView);
        spinner.setTag(choices);
        int selection = 0;
        for (int index = 0; index < choices.size(); index += 1) {
            if (TextUtils.equals(choices.get(index)[0], selectedSectionId)) selection = index;
        }
        spinner.setSelection(selection);
        spinner.post(() -> suppress[0] = false);
    }

    private Spinner prioritySpinner(LinearLayout parent, int selectedPriority) {
        List<String> values = new ArrayList<>();
        for (int priority = 1; priority <= 4; priority += 1) {
            values.add("P" + priority + " " + priorityLabel(priority));
        }
        return choiceSpinner(parent, "Priority", values, Math.max(0, selectedPriority - 1));
    }

    private int priorityOf(Spinner spinner) {
        return spinner.getSelectedItemPosition() + 1;
    }

    private String defaultCreateSectionId() {
        if (!todoSectionIds.isEmpty()) return todoSectionIds.get(0);
        if (!progressSectionIds.isEmpty()) return progressSectionIds.get(0);
        if (snapshot != null && !snapshot.sections.isEmpty()) return snapshot.sections.get(0).id;
        return null;
    }

    private List<String[]> collectProjects(JSONObject state) {
        List<String[]> projects = new ArrayList<>();
        JSONObject projectMap = state.optJSONObject("projects");
        if (projectMap == null) return projects;
        List<Object[]> rows = new ArrayList<>();
        java.util.Iterator<String> keys = projectMap.keys();
        while (keys.hasNext()) {
            JSONObject project = projectMap.optJSONObject(keys.next());
            if (project == null || project.optBoolean("isArchived", false)) continue;
            rows.add(new Object[] {project.optString("id"), project.optString("name", ""),
                    project.optBoolean("isArchived", false) ? 1 : 0, project.optDouble("order", 0d)});
        }
        Collections.sort(rows, (left, right) -> Double.compare((Double) left[3], (Double) right[3]));
        for (Object[] row : rows) {
            projects.add(new String[] {(String) row[0], (String) row[1]});
        }
        return projects;
    }

    private List<String> projectNames(List<String[]> projects) {
        List<String> names = new ArrayList<>();
        for (String[] project : projects) names.add(project[1]);
        return names;
    }

    private int indexOfProject(List<String[]> projects, String projectId) {
        for (int index = 0; index < projects.size(); index += 1) {
            if (TextUtils.equals(projects.get(index)[0], projectId)) return index;
        }
        return 0;
    }

    // ---- Adapter ----

    /**
     * Anti-blink adapter: cards are stateful views cached by task id. A refresh
     * rebinds a card ONLY when its content signature changed; unchanged cards
     * return the exact same View instance, so no rebuild, no alpha re-run, no
     * re-wrap — the 4s refresh becomes visually a no-op for stable sessions.
     */
    private final class SessionAdapter extends BaseAdapter {
        /** Bound card views keyed by task id (reused across refreshes). */
        private final Map<String, View> boundCards = new LinkedHashMap<>();
        /** Last-rendered content signature per task id. */
        private final Map<String, String> signatures = new LinkedHashMap<>();
        /** Task ids that already played the enter animation (never replay it). */
        private final Set<String> animatedIds = new HashSet<>();

        /**
         * Cheap per-card signature: everything buildCard renders, plus the
         * coarse wall-clock buckets that drive relative timestamps, waiting
         * countdowns and the ACTIVE_WINDOW running/stalled flip. Buckets tick
         * per minute, so time-sensitive text still refreshes but the 4s
         * polling never rebinds anything.
         */
        private String signature(DaymarkWorkspaceClient.TaskInfo task) {
            long now = System.currentTimeMillis();
            SessionUpdateParser.Result journal = SessionUpdateParser.parse(
                    task.description, task.updatedAtMillis);
            boolean paused = !task.completed && isTaskPaused(task);
            PendingMessage pending = pendingMessages.get(task.id);
            boolean active = journal.latest != null
                    && now - journal.latest.timeMillis < ACTIVE_WINDOW_MS;
            // Minute bucket only for cards whose displayed text is time-derived.
            boolean volatileTime = pending != null
                    || (!task.completed && journal.latest != null);
            long minuteBucket = volatileTime ? now / 60_000L : 0L;
            return task.updatedAtMillis
                    + "|" + task.content.hashCode()
                    + "|" + task.description.hashCode()
                    + "|" + task.sectionId
                    + "|" + task.completed
                    + "|" + task.priority
                    + "|" + task.pinned
                    + "|" + paused
                    + "|" + expandedTaskIds.contains(task.id)
                    + "|" + savingIds.contains(task.id)
                    + "|" + (pending == null ? -1L : pending.sentAt)
                    + "|" + active
                    + "|" + minuteBucket
                    + "|" + ("progress".equals(selectedChip) && paused);
        }

        /** Force a true rebind of every card (manual Refresh / pull-to-refresh). */
        void invalidateBoundCards() {
            boundCards.clear();
            signatures.clear();
        }

        /** Drop cache entries for tasks that left the visible list. */
        void pruneRemoved() {
            Set<String> ids = new HashSet<>(visibleTasks.size());
            for (DaymarkWorkspaceClient.TaskInfo task : visibleTasks) ids.add(task.id);
            boundCards.keySet().retainAll(ids);
            signatures.keySet().retainAll(ids);
        }

        @Override
        public void notifyDataSetChanged() {
            pruneRemoved();
            super.notifyDataSetChanged();
        }

        @Override
        public int getCount() {
            return visibleTasks.size();
        }

        @Override
        public Object getItem(int position) {
            return visibleTasks.get(position);
        }

        @Override
        public long getItemId(int position) {
            return visibleTasks.get(position).id.hashCode();
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            DaymarkWorkspaceClient.TaskInfo task = visibleTasks.get(position);
            String signature = signature(task);
            View cached = boundCards.get(task.id);
            if (cached != null && signature.equals(signatures.get(task.id))) {
                // Unchanged content: hand back the identical view untouched —
                // no rebuild, no animation, no text re-layout. Blink killed.
                return cached;
            }
            View card = buildCard(task);
            card.setTag(task.id);
            card.setLayoutParams(new AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            boundCards.put(task.id, card);
            signatures.put(task.id, signature);
            // Batch enter: alpha 0→1 with an 8dp rise — ONLY for brand-new task
            // ids, never on refresh/rebind of existing ones.
            if (cardAnimWindow > System.currentTimeMillis() && animatedIds.add(task.id)) {
                card.setAlpha(0f);
                card.setTranslationY(dp(8));
                card.animate().alpha(1f).translationY(0f).setDuration(220L)
                        .setInterpolator(new android.view.animation.DecelerateInterpolator())
                        .start();
            }
            return card;
        }
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Builds a human-readable progress message for a running task based on its
     * description journal. Returns null if no meaningful progress can be extracted.
     * Examples: "Compiling Kotlin module board-model — 12/47 files, ETA 18s"
     *           "Waiting for Gradle daemon lock — 3s elapsed"
     *           "Pushing signed APK to GitHub Releases — 4.2 MB / 14.7 MB"
     */
    /**
     * Builds a distinct, fact-rich progress line from LIVE state: model id,
     * provider label, minutes since the last progress line, and whether the
     * description grew since the previous broadcast. Rotates among 6 sentence
     * templates keyed by (minutesSinceLast % 6); the caller regenerates with a
     * shifted variant when a line would repeat the previous one verbatim.
     */
    private String buildProgressMessage(DaymarkWorkspaceClient.TaskInfo task) {
        return buildProgressMessage(task, 0);
    }

    /** The card's OWN model truth: the newest "model: <id>" / "running on model <id>"
     *  journal line wins over the global provider pref — the broadcast must name the
     *  model that is REALLY executing this session (observed: NVIDIA agent cards). */
    private String cardModelTruth(String description) {
        if (description == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(?:model:\s*|running on model\s*)((?:[A-Za-z0-9._-]+/)+[A-Za-z0-9._-]+)")
                .matcher(description);
        if (m.find()) return m.group(1);
        return null;
    }

    private String buildProgressMessage(DaymarkWorkspaceClient.TaskInfo task, int variantShift) {
        String cardModel = cardModelTruth(task.description);
        String model = cardModel != null ? cardModel : currentProviderModelPref();
        String providerLabel = cardModel != null ? cardModel.substring(0, cardModel.indexOf('/'))
                : PROVIDER_LABELS.getOrDefault(currentProviderPref(), currentProviderPref());
        long minutes = Math.max(0L,
                (System.currentTimeMillis() - getLastProgressTime(task.description)) / 60_000L);
        Integer prevLen = lastBroadcastDescLen.get(task.id);
        int growth = task.description == null ? 0
                : task.description.length() - (prevLen == null ? task.description.length() : prevLen);
        String growthPart = growth > 0 ? ("journal grew by " + growth + " chars") : "journal steady";
        String note = latestJournalNote(task);
        int slot = (int) ((minutes + variantShift) % 6);
        switch (slot) {
            case 0: return minutes + " min in, " + growthPart + ", still executing on " + model + " (" + providerLabel + ")";
            case 1: return model + " has been on it " + minutes + " min — " + growthPart + " — via " + providerLabel;
            case 2: return "Still working via " + providerLabel + ": " + minutes + " min elapsed, " + growthPart + ", model " + model;
            case 3: return note != null ? note + " — " + minutes + " min in on " + model + " (" + providerLabel + ")"
                                       : minutes + " min elapsed, " + growthPart + ", executing on " + model;
            case 4: return growthPart.substring(0, 1).toUpperCase(Locale.US) + growthPart.substring(1)
                       + " after " + minutes + " min; session continues on " + model + " via " + providerLabel;
            default: return "Session live on " + model + " — " + minutes + " min in, " + growthPart + " (" + providerLabel + ")";
        }
    }

    /** Extracts the latest human note from the description journal, or null. */
    private static String latestJournalNote(DaymarkWorkspaceClient.TaskInfo task) {
        String description = task.description;
        if (description == null || description.isEmpty()) return null;
        try {
            SessionUpdateParser.Result parsed = SessionUpdateParser.parse(description, task.updatedAtMillis);
            if (parsed.latest == null) return null;
            String latestLine = parsed.latest.message;
            if (latestLine.contains("update")) {
                int idx = latestLine.indexOf("\u2014 update");
                if (idx >= 0) {
                    int after = latestLine.indexOf("\u2014", idx + 1);
                    if (after >= 0) {
                        int noteStart = latestLine.indexOf(" ", after);
                        if (noteStart > after) {
                            String note = latestLine.substring(noteStart + 1).trim();
                            return note.isEmpty() ? null : note;
                        }
                    }
                }
            }
            if (latestLine.contains("ORDER")) {
                int idx = latestLine.indexOf("ORDER");
                int noteStart = latestLine.indexOf("\u2014", idx + 5);
                if (noteStart >= 0) {
                    String note = latestLine.substring(noteStart + 1).trim();
                    return note.isEmpty() ? null : note;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String buildProgressMessageLegacy(DaymarkWorkspaceClient.TaskInfo task) {
        String description = task.description;
        if (description == null || description.isEmpty()) {
            return "Session running…";
        }
        // Parse the latest update line from the journal
        SessionUpdateParser.Result parsed = SessionUpdateParser.parse(description, task.updatedAtMillis);
        if (parsed.latest == null) {
            return "Session running…";
        }
        String latestLine = parsed.latest.message;
        // Extract meaningful progress info from the update line
        if (latestLine.contains("update")) {
            // Extract the note part after "— update HH:MM — "
            int idx = latestLine.indexOf("\u2014 update");
            if (idx >= 0) {
                int after = latestLine.indexOf("\u2014", idx + 1);
                if (after >= 0) {
                    int noteStart = latestLine.indexOf(" ", after);
                    if (noteStart > after) {
                        String note = latestLine.substring(noteStart + 1).trim();
                        // If the note already looks like a progress message, use it
                        if (note.length() > 10 && (note.contains("%") || note.contains("/") || note.contains("ETA") || note.contains("elapsed") || note.contains("files"))) {
                            return note;
                        }
                        // Otherwise prepend a generic but specific prefix based on note content
                        if (note.toLowerCase(Locale.US).contains("compil")) return "Compiling " + note;
                        if (note.toLowerCase(Locale.US).contains("build")) return "Building " + note;
                        if (note.toLowerCase(Locale.US).contains("test")) return "Testing " + note;
                        if (note.toLowerCase(Locale.US).contains("sync") || note.toLowerCase(Locale.US).contains("push")) return "Syncing " + note;
                        if (note.toLowerCase(Locale.US).contains("download")) return "Downloading " + note;
                        if (note.toLowerCase(Locale.US).contains("upload")) return "Uploading " + note;
                        if (note.toLowerCase(Locale.US).contains("install")) return "Installing " + note;
                        if (note.toLowerCase(Locale.US).contains("deploy")) return "Deploying " + note;
                        if (note.toLowerCase(Locale.US).contains("run")) return "Running " + note;
                        if (note.toLowerCase(Locale.US).contains("wait")) return "Waiting " + note;
                        return "Working: " + note;
                    }
                }
            }
        }
        // Fallback: check for ORDER lines which indicate active work
        if (latestLine.contains("ORDER")) {
            int idx = latestLine.indexOf("ORDER");
            if (idx >= 0) {
                int noteStart = latestLine.indexOf("\u2014", idx + 5);
                if (noteStart >= 0) {
                    String note = latestLine.substring(noteStart + 1).trim();
                    return "Executing: " + note;
                }
            }
        }
        // Default fallback
        return "Session active — " + latestLine.substring(0, Math.min(80, latestLine.length()));
    }
}
// ANDROID:UI-DONE
