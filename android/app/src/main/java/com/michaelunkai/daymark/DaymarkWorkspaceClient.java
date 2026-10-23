package com.michaelunkai.daymark;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Minimal Daymark workspace client for the native AI workspace panel.
 * Speaks the same /api/sync wire protocol as the web client: the 22-character
 * sync key travels in the URL path, reads return {revision, state} envelopes,
 * writes send {expectedRevision, state} and answer 409 with the current state
 * on conflicts. Server wire fields such as projectId stay untouched.
 */
final class DaymarkWorkspaceClient {

    // Sync backend: the user's PC ("Daymark local server", scripts/daymark-local-server.mjs)
    // reached over Tailscale. Works from any network (LAN, mobile data, remote WiFi)
    // with zero cloud dependency — no Codex / ChatGPT account, ever.
    private static final String START_BASE =
            "http://100.76.198.53:18780";
    private static final String PREFS_NAME = "daymark";
    private static final String SYNC_KEY_PREF = "sync_key";
    private static final int CONNECT_TIMEOUT_MS = 30_000;       // Increased from 10s
    private static final int READ_TIMEOUT_MS = 60_000;          // Increased from 15s
    private static final int CHANGE_STREAM_TIMEOUT_MS = 120_000; // Increased from 35s to 2min
    private static final int LONG_POLL_TIMEOUT_MS = 180_000;    // 3min for long-poll
    private static final int AGENT_API_TIMEOUT_MS = 60_000;     // 1min for agent API
    private static final int ATTACHMENT_TIMEOUT_MS = 120_000;   // 2min for attachments

    // Retry configuration
    private static final int MAX_SYNC_RETRIES = 10;
    private static final long BASE_RETRY_DELAY_MS = 1000;
    private static final long MAX_RETRY_DELAY_MS = 30_000;
    private static final double RETRY_MULTIPLIER = 2.0;

    static final long NO_TIME = -1L;
    private static final String TAG = "DaymarkAi";
    /** Literal first-line marker that pins a task to the top of its column. */
    static final String PINNED_MARKER = "\u2014 pinned \u2014";

    /** True when the task description's first non-empty line is the pinned marker. */
    static boolean isPinnedDescription(String description) {
        if (description == null) return false;
        for (String line : description.split("\n", -1)) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            return PINNED_MARKER.equals(trimmed);
        }
        return false;
    }

    /** Builds a full task record with a stable id (used for optimistic creates). */
    static JSONObject buildTask(String projectId, String sectionId,
            String content, String description, int priority) throws JSONException {
        JSONObject task = new JSONObject();
        task.put("id", "tsk-" + UUID.randomUUID());
        task.put("content", content);
        task.put("description", description == null ? "" : description);
        task.put("projectId", projectId);
        task.put("sectionId", sectionId == null ? JSONObject.NULL : sectionId);
        task.put("parentId", JSONObject.NULL);
        task.put("priority", priority);
        task.put("due", JSONObject.NULL);
        task.put("completedAt", JSONObject.NULL);
        task.put("completionContext", JSONObject.NULL);
        task.put("order", 0d);
        String now = nowIso();
        task.put("createdAt", now);
        task.put("updatedAt", now);
        return task;
    }

    static void patchTaskJson(JSONObject task, String content, String description,
            Integer priority, String sectionId) throws JSONException {
        if (content != null) task.put("content", content);
        if (description != null) task.put("description", description);
        if (priority != null) task.put("priority", priority);
        if (sectionId != null) task.put("sectionId", sectionId.isEmpty() ? JSONObject.NULL : sectionId);
        task.put("updatedAt", nowIso());
    }

    static void setCompletedJson(JSONObject task, boolean complete) throws JSONException {
        if (complete) {
            task.put("completedAt", nowIso());
            JSONObject context = new JSONObject();
            context.put("projectId", task.optString("projectId", ""));
            context.put("sectionId", task.isNull("sectionId") ? JSONObject.NULL : task.get("sectionId"));
            context.put("order", task.optDouble("order", 0d));
            task.put("completionContext", context);
        } else {
            task.put("completedAt", JSONObject.NULL);
            task.put("completionContext", JSONObject.NULL);
        }
        task.put("updatedAt", nowIso());
    }

    static void moveTaskJson(JSONObject task, String projectId, String sectionId) throws JSONException {
        task.put("projectId", projectId);
        task.put("sectionId", sectionId == null ? JSONObject.NULL : sectionId);
        task.put("updatedAt", nowIso());
    }

    static void logUpdateJson(JSONObject task, String note) throws JSONException {
        String existing = task.optString("description", "");
        String line = "— update " + nowHHMM() + " — " + note.trim();
        // Keep any "— pinned —" marker as the FIRST line: the PC-side session bridge
        // detects assignment by finding the pinned marker within the first lines.
        task.put("description", prependToDescription(existing, line));
        task.put("updatedAt", nowIso());
    }

    /** One fetched workspace revision. */
    static final class Envelope {
        final long revision;
        final JSONObject state;

        Envelope(long revision, JSONObject state) {
            this.revision = revision;
            this.state = state;
        }
    }

    /** Raised when a push loses the optimistic-concurrency race. */
    static final class ConflictException extends IOException {
        final Envelope current;

        ConflictException(Envelope current) {
            super("Daymark sync conflict.");
            this.current = current;
        }
    }

    /** Section display model. */
    static final class SectionInfo {
        final String id;
        final String name;
        final double order;

        SectionInfo(String id, String name, double order) {
            this.id = id;
            this.name = name;
            this.order = order;
        }
    }

    /** Task display model; raw keeps the untouched server record for mutations. */
    static final class TaskInfo {
        final String id;
        final JSONObject raw;
        final String content;
        final String description;
        final String projectId;
        final String sectionId;
        final int priority;
        final boolean completed;
        final long updatedAtMillis;
        final long completedAtMillis;
        final double order;
        final boolean pinned;
        final JSONArray attachments;

        TaskInfo(JSONObject raw) throws JSONException {
            this.raw = raw;
            this.id = raw.getString("id");
            this.content = raw.optString("content", "");
            this.description = raw.optString("description", "");
            this.projectId = raw.optString("projectId", "");
            this.sectionId = raw.isNull("sectionId") ? null : raw.optString("sectionId", null);
            this.priority = raw.optInt("priority", 4);
            this.completed = !raw.isNull("completedAt");
            this.updatedAtMillis = parseIsoMillis(raw.optString("updatedAt", null));
            this.completedAtMillis = completed
                    ? parseIsoMillis(raw.optString("completedAt", null))
                    : NO_TIME;
            this.order = raw.optDouble("order", 0d);
            this.pinned = isPinnedDescription(this.description);
            this.attachments = raw.optJSONArray("attachments");
        }

        /** Attachment metadata row; absent field means the task carries none. */
        static final class Attachment {
            final String id;
            final String name;
            final String mimeType;
            final long size;

            Attachment(JSONObject raw) {
                this.id = raw.optString("id", "");
                this.name = raw.optString("name", "file");
                this.mimeType = raw.optString("mimeType", "application/octet-stream");
                this.size = raw.optLong("size", NO_TIME);
            }

            boolean isImage() {
                return mimeType != null && mimeType.toLowerCase(Locale.US).startsWith("image/");
            }
        }

        static List<Attachment> attachmentsOf(JSONArray array) {
            List<Attachment> result = new ArrayList<>();
            if (array == null) return result;
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject row = array.optJSONObject(index);
                if (row != null && !row.optString("id", "").isEmpty()) {
                    result.add(new Attachment(row));
                }
            }
            return result;
        }
    }

    /** Everything the panel renders for one revision. */
    static final class WorkspaceSnapshot {
        final long revision;
        final String projectId;
        final String projectName;
        final List<SectionInfo> sections;
        final List<TaskInfo> tasks;

        WorkspaceSnapshot(long revision, String projectId, String projectName,
                List<SectionInfo> sections, List<TaskInfo> tasks) {
            this.revision = revision;
            this.projectId = projectId;
            this.projectName = projectName;
            this.sections = sections;
            this.tasks = tasks;
        }
    }

    private DaymarkWorkspaceClient() {
    }

    static String readSyncKey(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String key = preferences.getString(SYNC_KEY_PREF, null);
        return isSyncKeyShape(key) ? key : null;
    }

    static void writeSyncKey(Context context, String key) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(SYNC_KEY_PREF, key)
                .apply();
    }

    static boolean isSyncKeyShape(String key) {
        return key != null && key.matches("[A-Za-z0-9_-]{22}");
    }

    static Envelope pull(String syncKey) throws IOException, JSONException {
        return pullWithRetry(syncKey, MAX_SYNC_RETRIES);
    }

    static Envelope pullWithRetry(String syncKey, int maxRetries) throws IOException, JSONException {
        IOException lastException = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                HttpURLConnection connection = openWithTimeout(START_BASE + "/api/sync/" + syncKey,
                        "GET", CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
                try {
                    int status = connection.getResponseCode();
                    if (status == 404) return null;
                    if (status == 429) throw new IOException("Rate limited");
                    if (status != 200) throw new IOException("Daymark sync read failed (" + status + ").");
                    JSONObject payload = new JSONObject(readBody(connection));
                    return new Envelope(payload.getLong("revision"), payload.getJSONObject("state"));
                } finally {
                    connection.disconnect();
                }
            } catch (IOException e) {
                lastException = e;
                if (attempt < maxRetries) {
                    long delay = Math.min(BASE_RETRY_DELAY_MS * (long) Math.pow(RETRY_MULTIPLIER, attempt), MAX_RETRY_DELAY_MS);
                    Log.w(TAG, "Pull attempt " + (attempt + 1) + " failed: " + e.getMessage() + ", retrying in " + delay + "ms");
                    sleepQuietly(delay);
                } else {
                    Log.e(TAG, "All pull attempts failed after " + (maxRetries + 1) + " attempts");
                    throw lastException;
                }
            }
        }
        throw lastException;
    }

    /**
     * Downloads one attachment's raw bytes via the sync-key attachment endpoint.
     * The contract endpoint answers {name,mimeType,dataBase64}; a legacy raw-bytes
     * path is tried as fallback. Returns null on 404 from both (attachment is
     * gone) so callers can hide the entry; other failures throw IOException.
     */
    static byte[] fetchAttachment(Context context, String attachmentId)
            throws IOException {
        String syncKey = readSyncKey(context);
        if (syncKey == null || attachmentId == null || attachmentId.isEmpty()) {
            throw new IOException("Attachment fetch requires a paired sync key.");
        }
        byte[] fromContract = fetchAttachmentContract(syncKey, attachmentId);
        if (fromContract != null) {
            Log.i(TAG, "attachment " + attachmentId + " fetched ("
                    + fromContract.length + " bytes, contract endpoint)");
            return fromContract;
        }
        byte[] legacy = fetchAttachmentLegacy(syncKey, attachmentId);
        Log.i(TAG, "attachment " + attachmentId + (legacy == null
                ? " missing on both endpoints (404)"
                : " fetched (" + legacy.length + " bytes, legacy endpoint)"));
        return legacy;
    }

    /** Set once the contract endpoint answers 404 so we log it only once. */
    private static volatile boolean contractEndpointKnownMissing;

    private static byte[] fetchAttachmentContract(String syncKey, String attachmentId)
            throws IOException {
        HttpURLConnection connection = open(START_BASE
                + "/api/sync/attachment/" + attachmentId, "GET", 30_000);
        try {
            connection.setRequestProperty("Authorization", "Bearer " + syncKey);
            connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
            int status = connection.getResponseCode();
            if (status == 404) {
                contractEndpointKnownMissing = true;
                return null;
            }
            if (status != 200) return null; // fall through to the legacy path
            String body = readBody(connection);
            String trimmed = body == null ? "" : body.trim();
            if (!trimmed.startsWith("{")) {
                return body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
            }
            try {
                JSONObject payload = new JSONObject(trimmed);
                String base64 = payload.optString("dataBase64", "");
                if (base64.isEmpty()) return new byte[0];
                return android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            } catch (JSONException error) {
                throw new IOException("Attachment payload was not readable.", error);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] fetchAttachmentLegacy(String syncKey, String attachmentId)
            throws IOException {
        HttpURLConnection connection = open(START_BASE + "/api/sync/" + syncKey
                + "/attachments/" + attachmentId, "GET", 30_000);
        try {
            int status = connection.getResponseCode();
            if (status == 404) return null;
            if (status != 200) throw new IOException("Attachment download failed (" + status + ").");
            InputStream input = connection.getInputStream();
            try (InputStream source = input) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = source.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                return output.toByteArray();
            }
        } finally {
            connection.disconnect();
        }
    }

    /** File extensions treated as inline-viewable attachments in descriptions. */
    private static final String[] ATTACHMENT_EXTENSIONS = {
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
            ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv"};

    /**
     * True when the text contains an http(s) URL whose path ends in an
     * image/pdf/doc extension — i.e. something worth downloading for inline
     * display in a task description.
     */
    public static boolean isAttachmentUrl(String s) {
        if (s == null || s.isEmpty()) return false;
        for (String rawToken : s.split("\\s+")) {
            String token = rawToken.toLowerCase(Locale.US);
            if (!token.contains("http://") && !token.contains("https://")) continue;
            int cut = token.indexOf('?');
            if (cut >= 0) token = token.substring(0, cut);
            int cut2 = token.indexOf('#');
            if (cut2 >= 0) token = token.substring(0, cut2);
            while (token.length() > 0 && "\"')].,;:!?".indexOf(token.charAt(token.length() - 1)) >= 0) {
                token = token.substring(0, token.length() - 1);
            }
            for (String extension : ATTACHMENT_EXTENSIONS) {
                if (token.endsWith(extension)) return true;
            }
        }
        return false;
    }

    /**
     * Downloads the bytes at an attachment URL on the same origin (plain GET
     * through the shared HTTP setup; the sync key travels as a Bearer header so
     * authenticated attachment endpoints work too) and returns a data URI ready
     * for display. Throws with the HTTP status on any non-200 answer.
     */
    public static String fetchAttachment(String url) throws Exception {
        if (url == null || url.isEmpty()) {
            throw new IOException("Attachment URL is empty.");
        }
        HttpURLConnection connection = open(url, "GET", 30_000);
        try {
            connection.setRequestProperty("Accept", "*/*");
            int status = connection.getResponseCode();
            if (status != 200) {
                throw new IOException("Attachment download failed (" + status + ").");
            }
            String mime = connection.getContentType();
            if (mime == null || mime.isEmpty() || "application/octet-stream".equals(mime)) {
                mime = guessMimeFromUrl(url);
            }
            int semicolon = mime.indexOf(';');
            if (semicolon >= 0) mime = mime.substring(0, semicolon);
            InputStream input = connection.getInputStream();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream source = input) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = source.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
            String base64 = android.util.Base64.encodeToString(
                    output.toByteArray(), android.util.Base64.NO_WRAP);
            Log.i(TAG, "attachment fetched (" + output.size() + " bytes, " + mime + ")");
            return "data:" + mime + ";base64," + base64;
        } finally {
            connection.disconnect();
        }
    }

    /** Best-effort MIME type from the URL's file extension. */
    private static String guessMimeFromUrl(String url) {
        String lower = url.toLowerCase(Locale.US);
        int cut = lower.indexOf('?');
        if (cut >= 0) lower = lower.substring(0, cut);
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) {
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) {
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        }
        return "application/octet-stream";
    }

    /** Long-polls one change; returns null when the server answered 204 (no change yet). */
    static Envelope waitForChange(String syncKey, long afterRevision) throws IOException, JSONException {
        HttpURLConnection connection = openWithTimeout(START_BASE + "/api/sync/" + syncKey
                + "/changes?after=" + afterRevision, "GET", CONNECT_TIMEOUT_MS, LONG_POLL_TIMEOUT_MS);
        try {
            int status = connection.getResponseCode();
            if (status == 204) return null;
            if (status != 200) throw new IOException("Daymark change stream failed (" + status + ").");
            JSONObject payload = new JSONObject(readBody(connection));
            return new Envelope(payload.getLong("revision"), payload.getJSONObject("state"));
        } finally {
            connection.disconnect();
        }
    }

    static Envelope push(String syncKey, JSONObject state, long expectedRevision)
            throws IOException, JSONException {
        return pushWithRetry(syncKey, state, expectedRevision, MAX_SYNC_RETRIES);
    }

    static Envelope pushWithRetry(String syncKey, JSONObject state, long expectedRevision, int maxRetries)
            throws IOException, JSONException {
        IOException lastException = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            HttpURLConnection connection = openWithTimeout(START_BASE + "/api/sync/" + syncKey,
                    "PUT", CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
            long startedAt = SystemClock.elapsedRealtime();
            int status;
            try {
                JSONObject body = new JSONObject();
                body.put("expectedRevision", expectedRevision);
                body.put("state", state);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
                status = connection.getResponseCode();
                Log.i(TAG, "push confirmed in " + (SystemClock.elapsedRealtime() - startedAt)
                        + "ms status=" + status + " expectedRevision=" + expectedRevision);
                if (status == 409) {
                    JSONObject conflict = new JSONObject(readErrorBody(connection));
                    JSONObject conflictState = conflict.isNull("state") ? null : conflict.getJSONObject("state");
                    throw new ConflictException(new Envelope(
                            conflict.optLong("revision", expectedRevision + 1), conflictState));
                }
                if (status == 429) throw new IOException("Rate limited");
                if (status != 200 && status != 201) throw new IOException("Daymark sync write failed (" + status + ").");
                JSONObject payload = new JSONObject(readBody(connection));
                return new Envelope(payload.getLong("revision"), payload.getJSONObject("state"));
            } catch (IOException e) {
                if (attempt < maxRetries) {
                    long delay = Math.min(BASE_RETRY_DELAY_MS * (long) Math.pow(RETRY_MULTIPLIER, attempt), MAX_RETRY_DELAY_MS);
                    Log.w(TAG, "Push attempt " + (attempt + 1) + " failed: " + e.getMessage() + ", retrying in " + delay + "ms");
                    sleepQuietly(delay);
                } else {
                    throw e;
                }
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("All push attempts failed");
    }

    // ---- Self-contained workspace operations: pull -> mutate -> push with conflict retry. ----

    private interface StateEdit {
        void apply(JSONObject state) throws IOException, JSONException;
    }

    private static void applyWithRetry(String syncKey, StateEdit edit)
            throws IOException, JSONException {
        applyWithVerification(syncKey, edit, null, "workspace edit");
    }

    /** Read-back check: returns true when the stored state shows the edit took effect. */
    private interface EditVerifier {
        boolean verify(JSONObject storedState) throws JSONException;
    }

    /**
     * Pull -> edit -> push, then READS BACK the stored state and verifies the edit
     * actually persisted. On conflict or verification mismatch it re-pulls and
     * retries up to 5 attempts with a short backoff, then fails with IOException so
     * the caller can surface a visible "failed to send" error. A push that returns
     * 200 but leaves the stored description unchanged is treated as a failure, not
     * a success.
     */
    private static void applyWithVerification(String syncKey, StateEdit edit,
            EditVerifier verifier, String what) throws IOException, JSONException {
        if (syncKey == null || syncKey.isEmpty()) {
            throw new IOException("This panel is not paired with a workspace yet.");
        }
        Envelope envelope = pull(syncKey);
        if (envelope == null) throw new IOException("Workspace is not connected.");
        IOException lastFailure = null;
        for (int attempt = 0; attempt < 12; attempt += 1) {
            if (attempt > 0) {
                sleepQuietly(Math.min(8000L, 400L * attempt * attempt));
                try {
                    Envelope fresh = pull(syncKey);
                    if (fresh == null) throw new IOException("Workspace is not connected.");
                    envelope = fresh;
                } catch (IOException networkError) {
                    lastFailure = networkError;
                    continue;
                }
            }
            JSONObject working = new JSONObject(envelope.state.toString());
            edit.apply(working);
            Envelope after;
            try {
                after = push(syncKey, working, envelope.revision);
            } catch (ConflictException conflict) {
                if (conflict.current == null || conflict.current.state == null) throw conflict;
                envelope = conflict.current;
                lastFailure = new IOException(what + " lost a conflict race; retrying.");
                continue;
            }
            JSONObject stored = after != null && after.state != null ? after.state : null;
            boolean ok = stored != null && (verifier == null || verifier.verify(stored));
            if (!ok) {
                // Authoritative read-back straight from the server.
                try {
                    Envelope reread = pull(syncKey);
                    if (reread != null) stored = reread.state;
                } catch (IOException ignored) {
                    // Verification falls back to the push response body.
                }
                ok = stored != null && (verifier == null || verifier.verify(stored));
            }
            if (ok) return;
            lastFailure = new IOException(what + " was acknowledged but did not persist.");
            if (after != null && after.state != null) envelope = after;
        }
        throw lastFailure != null
                ? lastFailure
                : new IOException(what + " failed to send.");
    }

    /** The task's description in the given state, or null when the task is missing. */
    private static String taskDescription(JSONObject state, String taskId) {
        JSONObject tasks = state.optJSONObject("tasks");
        JSONObject task = tasks == null ? null : tasks.optJSONObject(taskId);
        return task == null ? null : task.optString("description", "");
    }

    /**
     * True when the description's first (or, below a "— pinned —" marker, second)
     * non-empty line equals {@code line} — i.e. the line is at the top of the journal.
     */
    static boolean descriptionStartsWithLine(String description, String line) {
        if (description == null) return false;
        int seen = 0;
        for (String raw : description.split("\n", -1)) {
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) continue;
            if (seen == 0 && PINNED_MARKER.equals(trimmed)) {
                seen = 1;
                continue;
            }
            return line.equals(trimmed);
        }
        return false;
    }

    /**
     * Removes one task from the shared sync state, mirroring the PC delete flow.
     * Hard delete (the sync state carries no tombstones; removal from "tasks" IS
     * the delete). 409 conflicts go through the standard 5-attempt retry; before
     * returning, the stored state is READ BACK and the task's absence is
     * verified. Throws with the last failure status/message when it finally
     * could not be confirmed.
     */
    /**
     * Uploads a file for a task (images, PDFs, docs - any type) through the
     * agent attachment endpoint authenticated by the sync key, and returns the
     * attachment id. The session reads it back via GET /api/agent/v1/attachments/<id>.
     */
    public static String uploadAttachment(String syncKey, String taskId, String name,
            String mimeType, byte[] data) throws IOException, JSONException {
        if (syncKey == null || syncKey.isEmpty()) {
            throw new IOException("This panel is not paired with a workspace yet.");
        }
        if (data == null || data.length == 0) throw new IOException("Empty file.");
        if (data.length > 5 * 1024 * 1024) throw new IOException("File too large (max 5 MB).");
        String base64 = Base64.encodeToString(data, Base64.NO_WRAP);
        JSONObject body = new JSONObject();
        body.put("name", name == null ? "attachment" : name);
        body.put("mimeType", mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
        body.put("dataBase64", base64);
        HttpURLConnection connection = openWithTimeout(START_BASE
                + "/api/agent/v1/tasks/" + taskId + "/attachments", "POST", CONNECT_TIMEOUT_MS, ATTACHMENT_TIMEOUT_MS);
        String uploadBearer = bearer();
        connection.setRequestProperty("Authorization", "Bearer " + (uploadBearer.isEmpty() ? syncKey : uploadBearer));
        connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Idempotency-Key", java.util.UUID.randomUUID().toString());
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        String responseBody = status >= 400 ? readErrorBody(connection) : readBody(connection);
        if (status < 200 || status >= 300) {
            throw new IOException("Attachment upload failed: HTTP " + status
                    + (responseBody == null ? "" : " " + responseBody.substring(0, Math.min(200, responseBody.length()))));
        }
        JSONObject payload = new JSONObject(responseBody == null ? "{}" : responseBody);
        JSONObject attachment = payload.optJSONObject("attachment");
        String id = attachment == null ? payload.optString("id") : attachment.optString("id");
        Log.i(TAG, "attachment uploaded: " + id + " (" + name + ", " + data.length + " bytes)");
        return id;
    }
    /**
     * DIRECT AGENT PATCH (user law: <1s actions): the phone is authorized for
     * the agent API with its sync key (same as attachment upload). A tiny
     * per-task PATCH lands in one round trip (~200-400ms) - no full-state PUT,
     * no revision race, no waiting for the PC bridge.
     */
    /** Raw task JSON from the agent API (for diffing a mutation before PATCH). */
    public static String fetchTaskRaw(String syncKey, String taskId) throws Exception {
        HttpURLConnection connection = openWithTimeout(START_BASE
                + "/api/agent/v1/tasks/" + taskId, "GET", CONNECT_TIMEOUT_MS, AGENT_API_TIMEOUT_MS);
        // bearer applied by existing header line below (patched in fix-authtoken2 if needed)
        String rawBearer = bearer();
        connection.setRequestProperty("Authorization", "Bearer " + (rawBearer.isEmpty() ? syncKey : rawBearer));
        connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
        int status = connection.getResponseCode();
        String responseBody = status >= 400 ? readErrorBody(connection) : readBody(connection);
        if (status < 200 || status >= 300) throw new IOException("task fetch failed: HTTP " + status);
        JSONObject payload = new JSONObject(responseBody == null ? "{}" : responseBody);
        JSONObject task = payload.optJSONObject("task");
        return task != null ? task.toString() : "{}";
    }

    // ---- AGENT TOKEN (root-cause fix 2026-10-22) ----
    // The agent API authorizes ONLY minted agent keys (sha256-hashed in
    // daymark_agent_keys). The raw sync key as Bearer is PERMANENTLY 401 —
    // every phone write silently failed while reads via /api/sync worked,
    // so actions "worked for a second" (optimistic) then bounced back.
    // Fix: mint a dedicated agent key once (POST /keys accepts the sync
    // key), cache it, use it as Bearer for every agent call, and re-mint
    // + retry once on any 401.
    private static volatile String sAgentToken;
    private static final Object sMintLock = new Object();

    public static void setAgentToken(String token) { sAgentToken = token; }

    public static String cachedAgentToken() { return sAgentToken; }

    /** Mints (or returns the cached) agent token. prefs may be null (memory-only). */
    public static String ensureAgentToken(String syncKey, android.content.SharedPreferences prefs) throws Exception {
        String cached = sAgentToken;
        if (cached != null) return cached;
        if (prefs != null) {
            String stored = prefs.getString("agent_token", null);
            if (stored != null) { sAgentToken = stored; return stored; }
        }
        synchronized (sMintLock) {
            if (sAgentToken != null) return sAgentToken;
            String token = java.util.UUID.randomUUID().toString().replace("-", "")
                    + java.util.UUID.randomUUID().toString().replace("-", "");
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(token.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b));
            JSONObject body = new JSONObject();
            body.put("name", "android-companion");
            body.put("tokenHash", hex.toString());
            org.json.JSONArray scopes = new org.json.JSONArray();
            for (String s : new String[]{"projects:read", "projects:write", "sections:read", "sections:write",
                    "labels:read", "labels:write", "filters:read", "filters:write", "tasks:read", "tasks:write",
                    "notes:read", "notes:write", "order:read", "order:write", "preferences:read",
                    "preferences:write", "search:read", "undo:write"}) scopes.put(s);
            body.put("scopes", scopes);
            HttpURLConnection connection = open(START_BASE + "/api/agent/v1/keys", "POST", 20_000);
            connection.setRequestProperty("Authorization", "Bearer " + syncKey);
            connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            String resp = status >= 200 && status < 300 ? readBody(connection) : readErrorBody(connection);
            connection.disconnect();
            if (status < 200 || status >= 300) {
                throw new IOException("agent key mint failed: HTTP " + status
                        + (resp == null ? "" : " " + resp.substring(0, Math.min(160, resp.length()))));
            }
            JSONObject key = new JSONObject(resp).optJSONObject("key");
            if (key == null) throw new IOException("agent key mint returned no key");
            sAgentToken = token;
            if (prefs != null) prefs.edit().putString("agent_token", token).apply();
            return token;
        }
    }

    private static String bearer() {
        String t = sAgentToken;
        return t != null ? t : "";
    }

    public static void patchTask(String syncKey, String taskId, JSONObject body) throws Exception {
        // The agent API mutates one whole-workspace D1 document with
        // optimistic concurrency: while the PC bridge writes every second,
        // any PATCH can land on a stale revision -> HTTP 409 "conflict",
        // retryable. Retry here with exponential backoff and a FRESH
        // idempotency key per attempt (sendAgentPatch mints one per call).
        int status = sendAgentPatch(syncKey, taskId, body);
        for (int attempt = 0; status == 409 && attempt < 5; attempt++) {
            try { Thread.sleep(400L << attempt); }
            catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            status = sendAgentPatch(syncKey, taskId, body);
        }
        if (status == 401) {
            // 401: token stale/absent — re-mint once and retry a single time.
            synchronized (sMintLock) { sAgentToken = null; }
            ensureAgentToken(syncKey, null);
            status = sendAgentPatch(syncKey, taskId, body);
            if (status == 401) throw new IOException("Agent PATCH failed: HTTP 401 after remint");
        }
        if (status == 429) {
            // Rate limited - wait and retry
            throw new IOException("Rate limited (429)");
        }
        if (status < 200 || status >= 300) throw new IOException("Agent PATCH failed: HTTP " + status);
    }

    private static int sendAgentPatch(String syncKey, String taskId, JSONObject body) throws Exception {
        HttpURLConnection connection = openWithTimeout(START_BASE
                + "/api/agent/v1/tasks/" + taskId, "PATCH", CONNECT_TIMEOUT_MS, AGENT_API_TIMEOUT_MS);
        String bearer = bearer();
        connection.setRequestProperty("Authorization", "Bearer " + (bearer.isEmpty() ? syncKey : bearer));
        connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        // The worker reads the idempotency key ONLY from the Idempotency-Key
        // header (UUID pattern enforced); a body-only key is a hard HTTP 400.
        String idempotencyKey = java.util.UUID.randomUUID().toString();
        connection.setRequestProperty("Idempotency-Key", idempotencyKey); // header ONLY — body field is ignored and can 400
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            return status; // caller decides: 401 remints, anything else fails
        }
        connection.disconnect();
        return status;
    }

    /**
     * COMPLETION ENDPOINT: the agent API forbids PATCHing completedAt or
     * completionContext (permanent 409 "conflict") — completion flips ONLY
     * through POST /tasks/<id>/complete|reopen. Verified against the live
     * worker schema 2026-10-22.
     */
    public static void toggleCompletionApi(String syncKey, String taskId, boolean complete) throws Exception {
        HttpURLConnection connection = openWithTimeout(START_BASE
                + "/api/agent/v1/tasks/" + taskId + (complete ? "/complete" : "/reopen"), "POST", CONNECT_TIMEOUT_MS, AGENT_API_TIMEOUT_MS);
        String completionBearer = bearer();
        connection.setRequestProperty("Authorization", "Bearer " + (completionBearer.isEmpty() ? syncKey : completionBearer));
        connection.setRequestProperty("X-Daymark-Sync-Key", syncKey);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        connection.setRequestProperty("Idempotency-Key", java.util.UUID.randomUUID().toString());
        JSONObject body = new JSONObject();
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            String err = readErrorBody(connection);
            throw new IOException("Agent completion failed: HTTP " + status
                    + (err == null ? "" : " " + err.substring(0, Math.min(200, err.length()))));
        }
    }

    /**
     * ZERO-DELAY COMPLETE: one PATCH moves the card out of In Progress on the
     * server in well under a second; the PC bridge terminates the session tree
     * on its next 3s poll. The ORDER line makes the intent explicit for the
     * bridge and any live session.
     */
    public static void forceComplete(String syncKey, String taskId, String finishedSectionId,
            String stamp) throws Exception {
        JSONObject body = new JSONObject();
        if (finishedSectionId != null) body.put("sectionId", finishedSectionId);
        patchTask(syncKey, taskId, body);
        try {
            JSONObject stop = new JSONObject();
            stop.put("description", "\u2014 ORDER " + stamp
                    + " \u2014 complete: force-stop the session and finish now");
            patchTask(syncKey, taskId, stop);
        } catch (Exception e) {
            Log.w(TAG, "complete marker failed (section move already landed): " + e.getMessage());
        }
    }

    /**
     * INSTANT REORDER (user law: <1s, ALWAYS correct): every To-do card's new
     * position PATCHes with small concurrency so the server never sees a write
     * storm; each PATCH retries once, and ANY failure fails the whole call so
     * the caller falls back to the bridge marker instead of lying "applied".
     * Returns true only when EVERY card's order landed.
     */
    public static boolean patchOrdersParallel(String syncKey, java.util.List<String> ids,
            java.util.List<Integer> orders) throws InterruptedException {
        final java.util.concurrent.atomic.AtomicInteger failures =
                new java.util.concurrent.atomic.AtomicInteger(0);
        final java.util.concurrent.ExecutorService pool =
                java.util.concurrent.Executors.newFixedThreadPool(3);
        final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(ids.size());
        for (int i = 0; i < ids.size(); i++) {
            final String id = ids.get(i);
            final int order = orders.get(i);
            pool.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("order", order);
                    boolean landed = false;
                    for (int attempt = 0; attempt < 3 && !landed; attempt++) {
                        try {
                            patchTask(syncKey, id, body);
                            landed = true;
                        } catch (Exception e) {
                            Log.w(TAG, "order patch " + id + " attempt " + (attempt + 1) + ": " + e.getMessage());
                            if (attempt < 2) try { Thread.sleep(250L * (attempt + 1)); } catch (InterruptedException ie) { }
                        }
                    }
                    if (!landed) failures.incrementAndGet();
                } catch (Exception outer) {
                    failures.incrementAndGet();
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await(12, java.util.concurrent.TimeUnit.SECONDS);
        pool.shutdown();
        return failures.get() == 0;
    }

    public static void deleteTask(String syncKey, String taskId) throws Exception {
        applyWithVerification(syncKey, state -> {
            JSONObject tasks = state.optJSONObject("tasks");
            if (tasks == null) throw new JSONException("Workspace state has no tasks object.");
            tasks.remove(taskId);
        }, stored -> {
            JSONObject tasks = stored == null ? null : stored.optJSONObject("tasks");
            return tasks == null || tasks.optJSONObject(taskId) == null;
        }, "task delete");
    }

    /**
     * Prepends a journal line and VERIFIES it landed first in the stored
     * description; retries with backoff on conflict or silent persistence loss.
     */
    static void prependJournalLine(String syncKey, String taskId, String line)
            throws IOException, JSONException {
        applyWithVerification(syncKey, state -> prependLine(state, taskId, line),
                stored -> {
                    String description = taskDescription(stored, taskId);
                    return description != null && descriptionStartsWithLine(description, line);
                },
                "journal line");
    }

    /**
     * Prepends a PROGRESS journal line (for live session streaming) and VERIFIES
     * it landed first in the stored description; retries with backoff on conflict
     * or silent persistence loss. This is used by the 60-second progress broadcaster
     * to emit human-readable updates like "Compiling Kotlin module X — 12/47 files, ETA 18s".
     */
    static void prependProgressLine(String syncKey, String taskId, String progressNote)
            throws IOException, JSONException {
        String line = "\u2014 progress " + nowHHMM() + " \u2014 " + progressNote.trim();
        applyWithVerification(syncKey, state -> prependLine(state, taskId, line),
                stored -> {
                    String description = taskDescription(stored, taskId);
                    return description != null && descriptionStartsWithLine(description, line);
                },
                "progress line");
    }

    /**
     * Guaranteed message channel: optionally reopens a finished session (un-complete
     * + move to a populated In Progress section + REOPENED line), then prepends the
     * "— message HH:MM — <text>" line. Read-back verified with up to 5 attempts so a
     * silently-dropped push is reported to the user instead of vanishing.
     */
    static void sendMessage(String syncKey, String taskId, String text,
            boolean reopenIfFinished, String stamp) throws IOException, JSONException {
        String expectedLine = "\u2014 message " + stamp + " \u2014 " + text;
        applyWithVerification(syncKey, state -> {
            if (reopenIfFinished) {
                setTaskCompleted(state, taskId, false);
                moveTaskToProgressSection(state, taskId);
                prependLine(state, taskId,
                        "\u2014 REOPENED " + stamp + " \u2014 continued by user message");
            }
            prependLine(state, taskId, expectedLine);
        }, stored -> {
            String description = taskDescription(stored, taskId);
            return description != null && description.contains(expectedLine);
        }, "message");
    }

    /**
     * Canonical "\u2014 ORDER HH:MM \u2014" journal line for the Agents and Add-step
     * buttons: kind "agents" carries the sub-agent choice, kind "step" (default)
     * carries the step order with the resume clause.
     */
    public static String buildOrderLine(String kind, String payload) {
        if ("agents".equals(kind)) {
            return "\u2014 ORDER " + nowHHMM() + " \u2014 sub-agents: " + payload;
        }
        if ("hand".equals(kind)) {
            return "\u2014 ORDER " + nowHHMM() + " \u2014 hand: stop now and run /handoff immediately: save the handoff, prepend \"/hand <handoff name>\" as this card's very first line, move this card to To do, and stop - all within 5 minutes";
        }
        return "\u2014 ORDER " + nowHHMM() + " \u2014 do this now: " + payload
                + "; when finished continue exactly where you left off";
    }

    /**
     * Guaranteed order channel for the Agents and Add-step buttons: mirrors
     * sendMessage (reopen-if-finished + prepend below any "\u2014 pinned \u2014"
     * marker + read-back verification with up to 5 attempts) but takes the FULL
     * pre-built journal line, e.g. from buildOrderLine. A silently-dropped push
     * is reported to the caller instead of vanishing.
     */
    public static void sendVerifiedOrder(String syncKey, String taskId, String orderLine,
            boolean reopenIfFinished, String stamp) throws Exception {
        applyWithVerification(syncKey, state -> {
            if (reopenIfFinished) {
                setTaskCompleted(state, taskId, false);
                moveTaskToProgressSection(state, taskId);
                prependLine(state, taskId,
                        "\u2014 REOPENED " + stamp + " \u2014 continued by user order");
            }
            prependLine(state, taskId, orderLine);
        }, stored -> {
            String description = taskDescription(stored, taskId);
            return description != null && description.contains(orderLine);
        }, "order");
    }

    /**
     * One-call retry for finished tasks: un-completes the task, moves it to the
     * In Progress section, re-assigns a session (pin to top), and — when a
     * prompt is given — prepends the "— ORDER HH:MM — do this now: <prompt>;
     * when finished continue exactly where you left off" line. Each step runs
     * inside the existing verified pull-edit-push helper (5 attempts on
     * conflict/silent loss), with a read-back verify of completion + journal
     * line at the end.
     */
    public static void reassignWithPrompt(String syncKey, String taskId, String prompt)
            throws Exception {
        String stamp = nowHHMM();
        String trimmed = prompt == null ? "" : prompt.trim();
        boolean hasPrompt = !trimmed.isEmpty();
        String orderLine = "\u2014 ORDER " + stamp + " \u2014 do this now: " + trimmed
                + "; when finished continue exactly where you left off";
        applyWithVerification(syncKey, state -> {
            setTaskCompleted(state, taskId, false);
            moveTaskToProgressSection(state, taskId);
            assignSession(state, taskId);
            if (hasPrompt) {
                prependLine(state, taskId, orderLine);
            }
        }, stored -> {
            JSONObject tasks = stored == null ? null : stored.optJSONObject("tasks");
            JSONObject task = tasks == null ? null : tasks.optJSONObject(taskId);
            if (task == null) return false;
            if (!task.isNull("completedAt")) return false;
            if (!hasPrompt) return true;
            String description = task.optString("description", "");
            return description.contains(orderLine);
        }, "reassign");
    }

    /** Returns {@code existing} with {@code line} prepended below any pinned marker. */
    static String prependToDescription(String existing, String line) {
        String pinned = "\u2014 pinned \u2014";
        if (existing.equals(pinned)) {
            return pinned + "\n" + line;
        }
        if (existing.startsWith(pinned + "\n")) {
            // Keep "— pinned —" as the first line; the journal marker goes below it.
            return pinned + "\n" + line + "\n" + existing.substring(pinned.length() + 1);
        }
        return existing.isEmpty() ? line : line + "\n" + existing;
    }

    /**
     * State-level journal prepend for the panel's mutate() queue: prepends the
     * line below any "\u2014 pinned \u2014" marker and bumps updatedAt.
     */
    static void prependLine(JSONObject state, String taskId, String line) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        task.put("description", prependToDescription(task.optString("description", ""), line));
        task.put("updatedAt", nowIso());
    }

    /**
     * Finds the In Progress section of a project, tolerating duplicate same-named
     * sections: among matching sections, prefer one that actually CONTAINS tasks;
     * otherwise take the first by creation order (lowest order value).
     */
    static String findProgressSectionId(JSONObject state, String projectId) {
        List<String[]> candidates = findSectionsByBucket(state, projectId, "progress");
        if (candidates.isEmpty()) return null;
        // Prefer a section that holds at least one task.
        for (String[] candidate : candidates) {
            if (sectionHasTasks(state, candidate[0])) return candidate[0];
        }
        return candidates.get(0)[0];
    }

    /** True when any live task currently sits in the section. */
    private static boolean sectionHasTasks(JSONObject state, String sectionId) {
        JSONObject tasks = state.optJSONObject("tasks");
        if (tasks == null || sectionId == null) return false;
        java.util.Iterator<String> keys = tasks.keys();
        while (keys.hasNext()) {
            JSONObject task = tasks.optJSONObject(keys.next());
            if (task == null || task.optBoolean("isArchived", false)) continue;
            String own = task.isNull("sectionId") ? null : task.optString("sectionId", null);
            if (sectionId.equals(own)) return true;
        }
        return false;
    }

    /** Section ids+names whose normalized name contains the bucket token, in creation order. */
    private static List<String[]> findSectionsByBucket(JSONObject state, String projectId,
            String bucketToken) {
        List<String[]> result = new ArrayList<>();
        JSONObject sections = state.optJSONObject("sections");
        if (sections == null) return result;
        List<Object[]> rows = new ArrayList<>();
        java.util.Iterator<String> keys = sections.keys();
        while (keys.hasNext()) {
            JSONObject section = sections.optJSONObject(keys.next());
            if (section == null || !projectId.equals(section.optString("projectId", ""))) continue;
            String normalized = section.optString("name", "")
                    .replaceAll("[\\s_-]", "").toLowerCase(Locale.US);
            if (!normalized.contains(bucketToken)) continue;
            rows.add(new Object[] {section.optString("id"), section.optDouble("order", 0d)});
        }
        rows.sort(Comparator.comparingDouble(row -> (Double) row[1]));
        for (Object[] row : rows) result.add(new String[] {(String) row[0]});
        return result;
    }

    /**
     * Resolves a possibly-duplicate section id to the right one: when another
     * same-named section in the same project holds tasks and the chosen one does
     * not, the populated one wins. Prevents "task location invalid" on servers
     * that validate section membership. Returns the input when unambiguous.
     */
    static String resolveDuplicateSection(JSONObject state, String projectId, String sectionId) {
        if (sectionId == null || sectionId.isEmpty() || state == null) return sectionId;
        JSONObject chosen = sectionById(state, sectionId);
        if (chosen == null) return sectionId;
        String name = chosen.optString("name", "");
        if (sectionHasTasks(state, sectionId)) return sectionId;
        JSONObject sections = state.optJSONObject("sections");
        if (sections == null) return sectionId;
        String best = sectionId;
        double bestOrder = Double.MAX_VALUE;
        java.util.Iterator<String> keys = sections.keys();
        while (keys.hasNext()) {
            JSONObject section = sections.optJSONObject(keys.next());
            if (section == null || !projectId.equals(section.optString("projectId", ""))) continue;
            if (!name.equals(section.optString("name", ""))) continue;
            String id = section.optString("id");
            if (id.equals(sectionId)) continue;
            if (sectionHasTasks(state, id)) return id;
            double order = section.optDouble("order", 0d);
            if (order < bestOrder) {
                bestOrder = order;
                best = id;
            }
        }
        return best;
    }

    private static JSONObject sectionById(JSONObject state, String sectionId) {
        JSONObject sections = state.optJSONObject("sections");
        return sections == null ? null : sections.optJSONObject(sectionId);
    }

    /**
     * Moves a task into its project's In Progress section without pinning or
     * journaling; used by the guaranteed message channel's reopen path.
     */
    /** Moves a task to the project's To do section (the Hand instant-park path). */
    static void moveTaskToTodoSection(JSONObject state, String taskId) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        String projectId = task.optString("projectId", "");
        String todoSectionId = findSectionIdByName(state, projectId, "To do");
        if (todoSectionId == null) throw new JSONException("No To do section exists for this project.");
        task.put("sectionId", todoSectionId);
        task.put("updatedAt", nowIso());
    }

    static String findSectionIdByName(JSONObject state, String projectId, String name) throws JSONException {
        JSONObject sections = state.optJSONObject("sections");
        if (sections == null) return null;
        java.util.Iterator<String> keys = sections.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject section = sections.optJSONObject(id);
            if (section == null) continue;
            if (name.equalsIgnoreCase(section.optString("name", ""))
                    && (projectId.isEmpty() || projectId.equals(section.optString("projectId", "")))) {
                return id;
            }
        }
        return null;
    }

    static void moveTaskToProgressSection(JSONObject state, String taskId) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        String projectId = task.optString("projectId", "");
        String progressSectionId = findProgressSectionId(state, projectId);
        if (progressSectionId == null) {
            throw new JSONException("No In Progress section exists for this project.");
        }
        task.put("sectionId", progressSectionId);
        task.put("updatedAt", nowIso());
    }

    /** True when the project name or description identifies it as the AI workspace. */
    private static boolean isAiWorkspaceProject(JSONObject project) {
        String normalized = project.optString("name", "")
                .replaceAll("[\\s_-]", "").toLowerCase(Locale.US);
        if ("aicontrolpanel".equals(normalized) || "aiworkspace".equals(normalized)) return true;
        return project.optString("description", "").trim().toLowerCase(Locale.US)
                .startsWith("workspace");
    }

    /** Counts live tasks that belong to the given project. */
    private static int taskCountForProject(JSONObject state, String projectId) {
        int count = 0;
        JSONObject tasks = state.optJSONObject("tasks");
        if (tasks == null) return 0;
        java.util.Iterator<String> keys = tasks.keys();
        while (keys.hasNext()) {
            JSONObject task = tasks.optJSONObject(keys.next());
            if (task != null && projectId.equals(task.optString("projectId", ""))
                    && !task.optBoolean("isArchived", false)) {
                count += 1;
            }
        }
        return count;
    }

    /**
     * Finds the ACTIVE AIControlPanel workspace project. Duplicates happen (an old
     * empty project plus the live one share a name), so among candidates the one
     * with the MOST TASKS wins; ties break on the most recently updated, then on
     * not being archived. Returns null when no candidate exists at all.
     */
    static String findAiWorkspaceProjectId(JSONObject state) throws JSONException {
        JSONObject projects = state.optJSONObject("projects");
        if (projects == null) return null;
        String bestId = null;
        int bestTasks = -1;
        long bestUpdated = Long.MIN_VALUE;
        boolean bestArchived = true;
        java.util.Iterator<String> keys = projects.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject project = projects.optJSONObject(id);
            if (project == null || !isAiWorkspaceProject(project)) continue;
            int tasks = taskCountForProject(state, id);
            long updated = parseIsoMillis(project.optString("updatedAt", null));
            boolean archived = project.optBoolean("isArchived", false);
            boolean better;
            if (bestId == null) {
                better = true;
            } else if (bestArchived != archived) {
                better = !archived;
            } else if (tasks != bestTasks) {
                better = tasks > bestTasks;
            } else {
                better = updated > bestUpdated;
            }
            if (better) {
                bestId = id;
                bestTasks = tasks;
                bestUpdated = updated;
                bestArchived = archived;
            }
        }
        return bestId;
    }

    static WorkspaceSnapshot snapshot(Envelope envelope) throws JSONException {
        JSONObject state = envelope.state;
        String projectId = findAiWorkspaceProjectId(state);
        List<SectionInfo> sections = new ArrayList<>();
        List<TaskInfo> tasks = new ArrayList<>();
        if (projectId == null) {
            return new WorkspaceSnapshot(envelope.revision, null, null, sections, tasks);
        }
        JSONObject project = state.optJSONObject("projects") == null
                ? null
                : state.optJSONObject("projects").optJSONObject(projectId);
        String projectName = project == null ? "AIControlPanel" : project.optString("name", "AIControlPanel");
        JSONObject allSections = state.optJSONObject("sections");
        if (allSections != null) {
            java.util.Iterator<String> sectionKeys = allSections.keys();
            List<JSONObject> rows = new ArrayList<>();
            while (sectionKeys.hasNext()) {
                JSONObject section = allSections.optJSONObject(sectionKeys.next());
                if (section != null && projectId.equals(section.optString("projectId", ""))) {
                    rows.add(section);
                }
            }
            Collections.sort(rows, Comparator.comparingDouble(row -> row.optDouble("order", 0d)));
            for (JSONObject section : rows) {
                sections.add(new SectionInfo(
                        section.getString("id"),
                        section.optString("name", ""),
                        section.optDouble("order", 0d)));
            }
        }
        JSONObject allTasks = state.optJSONObject("tasks");
        if (allTasks != null) {
            java.util.Iterator<String> taskKeys = allTasks.keys();
            while (taskKeys.hasNext()) {
                JSONObject task = allTasks.optJSONObject(taskKeys.next());
                if (task != null && projectId.equals(task.optString("projectId", ""))
                        && !task.optBoolean("isArchived", false)) {
                    tasks.add(new TaskInfo(task));
                }
            }
        }
        Collections.sort(tasks, (left, right) -> {
            if (left.completed != right.completed) return left.completed ? 1 : -1;
            if (!left.completed && left.pinned != right.pinned) return left.pinned ? -1 : 1;
            int bySection = sectionOrder(sections, left.sectionId) - sectionOrder(sections, right.sectionId);
            if (bySection != 0) return bySection;
            // Pinned tasks surface first; a low order value is the first tiebreak.
            int byOrder = Double.compare(left.order, right.order);
            return byOrder != 0 ? byOrder : Long.compare(right.updatedAtMillis, left.updatedAtMillis);
        });
        return new WorkspaceSnapshot(envelope.revision, projectId, projectName, sections, tasks);
    }

    private static int sectionOrder(List<SectionInfo> sections, String sectionId) {
        if (sectionId == null) return Integer.MAX_VALUE;
        for (int index = 0; index < sections.size(); index += 1) {
            if (sectionId.equals(sections.get(index).id)) return index;
        }
        return Integer.MAX_VALUE - 1;
    }

    // ---- Mutations. Each edits the state JSON in place; callers push it back. ----

    static String createTask(JSONObject state, String projectId, String sectionId,
            String content, String description, int priority) throws JSONException {
        JSONObject task = new JSONObject();
        task.put("id", "tsk-" + UUID.randomUUID());
        task.put("content", content);
        task.put("description", description == null ? "" : description);
        task.put("projectId", projectId);
        task.put("sectionId", sectionId == null ? JSONObject.NULL : sectionId);
        task.put("parentId", JSONObject.NULL);
        task.put("priority", priority);
        task.put("due", JSONObject.NULL);
        task.put("completedAt", JSONObject.NULL);
        task.put("completionContext", JSONObject.NULL);
        task.put("order", nextTaskOrder(state, projectId));
        String now = nowIso();
        task.put("createdAt", now);
        task.put("updatedAt", now);
        state.getJSONObject("tasks").put(task.getString("id"), task);
        return task.getString("id");
    }

    static void patchTask(JSONObject state, String taskId, String content,
            String description, Integer priority, String sectionId) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        if (content != null) task.put("content", content);
        if (description != null) task.put("description", description);
        if (priority != null) task.put("priority", priority);
        if (sectionId != null) task.put("sectionId", sectionId.isEmpty() ? JSONObject.NULL : sectionId);
        task.put("updatedAt", nowIso());
    }

    static void setTaskCompleted(JSONObject state, String taskId, boolean complete) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        if (complete) {
            task.put("completedAt", nowIso());
            JSONObject context = new JSONObject();
            context.put("projectId", task.optString("projectId", ""));
            context.put("sectionId", task.isNull("sectionId") ? JSONObject.NULL : task.get("sectionId"));
            context.put("order", task.optDouble("order", 0d));
            task.put("completionContext", context);
        } else {
            task.put("completedAt", JSONObject.NULL);
            task.put("completionContext", JSONObject.NULL);
        }
        task.put("updatedAt", nowIso());
    }

    static void moveTask(JSONObject state, String taskId, String projectId, String sectionId) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        task.put("projectId", projectId);
        task.put("sectionId", sectionId == null ? JSONObject.NULL : sectionId);
        task.put("order", nextTaskOrder(state, projectId));
        task.put("updatedAt", nowIso());
    }

    /**
     * Assigns a session from the phone, matching the PC assign handler: the task
     * moves into its project's In Progress section, is pinned to the very top
     * (— pinned — first line + order below every existing card), and carries the
     * canonical "session assigned" journal update line.
     */
    static void assignSession(JSONObject state, String taskId) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        String projectId = task.optString("projectId", "");
        String progressSectionId = findProgressSectionId(state, projectId);
        if (progressSectionId == null) {
            throw new JSONException("No In Progress section exists for this project.");
        }
        double minOrder = 0d;
        boolean seen = false;
        JSONObject tasks = state.optJSONObject("tasks");
        if (tasks != null) {
            java.util.Iterator<String> keys = tasks.keys();
            while (keys.hasNext()) {
                JSONObject candidate = tasks.optJSONObject(keys.next());
                if (candidate == null
                        || !progressSectionId.equals(candidate.isNull("sectionId")
                                ? null : candidate.optString("sectionId", null))) continue;
                double order = candidate.optDouble("order", 0d);
                if (!seen || order < minOrder) {
                    minOrder = order;
                    seen = true;
                }
            }
        }
        task.put("sectionId", progressSectionId);
        // Pin the card to the TOP of In Progress. The agent API REJECTS negative
        // orders (normalizeOrder requires >= 0) — a minOrder-1000 pin made every
        // assign PATCH fail with "does not match the documented schema" and the
        // card snapped back to To do seconds later (observed live on refresh2).
        task.put("order", seen && minOrder > 0d ? minOrder - 1d : 0d);
        String line = PINNED_MARKER + "\n\u2014 update " + nowHHMM()
                + " \u2014 session assigned and pinned for this task";
        String existing = task.optString("description", "");
        task.put("description", existing.isEmpty() ? line : line + "\n" + existing);
        task.put("updatedAt", nowIso());
    }

    /** Prepends a "— update HH:MM — note" journal line, matching the agent convention. */
    static void logUpdate(JSONObject state, String taskId, String note) throws JSONException {
        JSONObject task = requireTask(state, taskId);
        String existing = task.optString("description", "");
        String line = "\u2014 update " + nowHHMM() + " \u2014 " + note.trim();
        task.put("description", existing.isEmpty() ? line : line + "\n\n" + existing);
        task.put("updatedAt", nowIso());
    }

    static void touchWorkspace(JSONObject state, long expectedRevision) throws JSONException {
        state.put("revision", expectedRevision);
        state.put("updatedAt", nowIso());
    }

    private static JSONObject requireTask(JSONObject state, String taskId) throws JSONException {
        JSONObject task = state.optJSONObject("tasks") == null
                ? null
                : state.optJSONObject("tasks").optJSONObject(taskId);
        if (task == null) throw new JSONException("Task is missing from the workspace: " + taskId);
        return task;
    }

    private static double nextTaskOrder(JSONObject state, String projectId) throws JSONException {
        double highest = 0d;
        JSONObject tasks = state.optJSONObject("tasks");
        if (tasks != null) {
            java.util.Iterator<String> keys = tasks.keys();
            while (keys.hasNext()) {
                JSONObject task = tasks.optJSONObject(keys.next());
                if (task == null || !projectId.equals(task.optString("projectId", ""))) continue;
                highest = Math.max(highest, task.optDouble("order", 0d));
            }
        }
        return highest + 1d;
    }

    static String nowIso() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    static String nowHHMM() {
        Calendar now = Calendar.getInstance();
        return String.format(Locale.US, "%02d:%02d",
                now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE));
    }

    static long parseIsoMillis(String value) {
        if (value == null || value.isEmpty()) return NO_TIME;
        String normalized = value.endsWith("Z") ? value.substring(0, value.length() - 1) + "+00:00" : value;
        for (String pattern : new String[] {
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss"}) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                format.setTimeZone(TimeZone.getTimeZone("UTC"));
                return format.parse(normalized).getTime();
            } catch (ParseException ignored) {
                // Try the next layout the workspace may emit.
            }
        }
        return NO_TIME;
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private static HttpURLConnection open(String url, String method, int readTimeoutMs) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(readTimeoutMs);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Connection", "keep-alive");
        connection.setRequestProperty("Keep-Alive", "timeout=300, max=1000");
        connection.setInstanceFollowRedirects(true);
        return connection;
    }

    private static HttpURLConnection openWithTimeout(String url, String method, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(connectTimeoutMs);
        connection.setReadTimeout(readTimeoutMs);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Connection", "keep-alive");
        connection.setRequestProperty("Keep-Alive", "timeout=300, max=1000");
        connection.setInstanceFollowRedirects(true);
        return connection;
    }

    private static String readBody(HttpURLConnection connection) throws IOException {
        return readStream(connection.getInputStream());
    }

    private static String readErrorBody(HttpURLConnection connection) throws IOException {
        return readStream(connection.getErrorStream());
    }

    private static String readStream(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream input = stream) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}

