package com.michaelunkai.daymark;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONObject;

/**
 * Local-first diary persistence. The Daymark server diary API (/diary) only
 * accepts agent tokens (scopes diary:read/diary:write) and the Android client
 * authenticates with a workspace sync key, so entries live in a private raw
 * SQLite database here. Full CRUD, ordered by date, with substring search.
 *
 * Wire shape mirrors the server entry contract ({date, body, highlights,
 * reflection, tomorrow, updatedAt}) plus two client-only columns (mood,
 * gratitude) so a future agent-token sync can PUT entries as-is.
 */
final class DiaryStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "daymark-diary.db";
    private static final int DB_VERSION = 1;

    static final class Entry {
        final String date;        // ISO yyyy-MM-dd, primary key
        final String body;
        final String mood;        // emoji
        final String highlights;
        final String gratitude;
        final String tomorrow;
        final String updatedAt;   // ISO timestamp

        Entry(String date, String body, String mood, String highlights,
                String gratitude, String tomorrow, String updatedAt) {
            this.date = date;
            this.body = body == null ? "" : body;
            this.mood = mood == null ? "" : mood;
            this.highlights = highlights == null ? "" : highlights;
            this.gratitude = gratitude == null ? "" : gratitude;
            this.tomorrow = tomorrow == null ? "" : tomorrow;
            this.updatedAt = updatedAt == null ? "" : updatedAt;
        }

        boolean isEmpty() {
            return body.trim().isEmpty()
                    && highlights.trim().isEmpty()
                    && gratitude.trim().isEmpty()
                    && tomorrow.trim().isEmpty();
        }

        String preview() {
            String source = !body.trim().isEmpty() ? body.trim()
                    : !highlights.trim().isEmpty() ? highlights.trim()
                    : tomorrow.trim();
            return source.length() > 120 ? source.substring(0, 120) + "\u2026" : source;
        }

        JSONObject toJson() {
            JSONObject json = new JSONObject();
            try {
                json.put("date", date);
                json.put("body", body);
                json.put("mood", mood);
                json.put("highlights", highlights);
                json.put("gratitude", gratitude);
                json.put("tomorrow", tomorrow);
                json.put("updatedAt", updatedAt);
            } catch (Exception ignored) {
            }
            return json;
        }
    }

    DiaryStore(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE entries ("
                + "date TEXT PRIMARY KEY NOT NULL,"
                + "body TEXT NOT NULL DEFAULT '',"
                + "mood TEXT NOT NULL DEFAULT '',"
                + "highlights TEXT NOT NULL DEFAULT '',"
                + "gratitude TEXT NOT NULL DEFAULT '',"
                + "tomorrow TEXT NOT NULL DEFAULT '',"
                + "updatedAt TEXT NOT NULL DEFAULT '')");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Version 1 only; future migrations go here.
    }

    /** Inserts or replaces the entry for date; returns the stored row. */
    static Entry upsert(Context context, String date, String body, String mood,
            String highlights, String gratitude, String tomorrow) {
        String updatedAt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).format(
                new java.util.Date());
        DiaryStore store = new DiaryStore(context);
        try (SQLiteDatabase db = store.getWritableDatabase()) {
            ContentValues values = new ContentValues();
            values.put("date", date);
            values.put("body", body == null ? "" : body);
            values.put("mood", mood == null ? "" : mood);
            values.put("highlights", highlights == null ? "" : highlights);
            values.put("gratitude", gratitude == null ? "" : gratitude);
            values.put("tomorrow", tomorrow == null ? "" : tomorrow);
            values.put("updatedAt", updatedAt);
            db.insertWithOnConflict("entries", null, values,
                    SQLiteDatabase.CONFLICT_REPLACE);
        }
        return get(context, date);
    }

    static Entry get(Context context, String date) {
        DiaryStore store = new DiaryStore(context);
        try (SQLiteDatabase db = store.getReadableDatabase();
                Cursor cursor = db.query("entries", null,
                        "date = ?", new String[]{date}, null, null, null)) {
            return cursor.moveToFirst() ? fromCursor(cursor) : null;
        }
    }

    /** All entries, newest date first; query filters on any text column. */
    static java.util.List<Entry> list(Context context, String query) {
        java.util.List<Entry> entries = new java.util.ArrayList<>();
        String selection = null;
        String[] args = null;
        if (query != null && !query.trim().isEmpty()) {
            String like = "%" + query.trim() + "%";
            selection = "body LIKE ? OR highlights LIKE ? OR gratitude LIKE ? "
                    + "OR tomorrow LIKE ? OR date LIKE ?";
            args = new String[]{like, like, like, like, like};
        }
        DiaryStore store = new DiaryStore(context);
        try (SQLiteDatabase db = store.getReadableDatabase();
                Cursor cursor = db.query("entries", null, selection, args,
                        null, null, "date DESC")) {
            while (cursor.moveToNext()) {
                entries.add(fromCursor(cursor));
            }
        }
        return entries;
    }

    /** Returns true when a row was deleted. */
    static boolean delete(Context context, String date) {
        DiaryStore store = new DiaryStore(context);
        try (SQLiteDatabase db = store.getWritableDatabase()) {
            return db.delete("entries", "date = ?", new String[]{date}) > 0;
        }
    }

    private static Entry fromCursor(Cursor cursor) {
        return new Entry(
                cursor.getString(cursor.getColumnIndexOrThrow("date")),
                cursor.getString(cursor.getColumnIndexOrThrow("body")),
                cursor.getString(cursor.getColumnIndexOrThrow("mood")),
                cursor.getString(cursor.getColumnIndexOrThrow("highlights")),
                cursor.getString(cursor.getColumnIndexOrThrow("gratitude")),
                cursor.getString(cursor.getColumnIndexOrThrow("tomorrow")),
                cursor.getString(cursor.getColumnIndexOrThrow("updatedAt")));
    }
}
