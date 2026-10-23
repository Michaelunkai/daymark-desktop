package com.michaelunkai.daymark;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Native diary: one entry per calendar date with body, mood, highlights,
 * gratitude, and tomorrow-plan fields. Local-first (DiaryStore SQLite);
 * autosaves two seconds after the last keystroke and on exit. Supports
 * prev/next day navigation, a date picker, and a searchable past-entry list.
 */
public final class DiaryActivity extends Activity {

    private static final String EXTRA_DATE = "date";
    private static final long AUTOSAVE_DELAY_MS = 2_000L;
    private static final String[] MOODS = {
            "\uD83D\uDE04", "\uD83D\uDE42", "\uD83D\uDE10",
            "\uD83D\uDE41", "\uD83D\uDE22", "\uD83D\uDE24",
            "\uD83D\uDE34", "\uD83E\uDD75", "\uD83D\uDE0E"};

    // Vanta-black palette matching AiWorkspaceActivity.
    private static final int COLOR_BACKGROUND = Color.BLACK;
    private static final int COLOR_CARD = 0xFF0E0E14;
    private static final int COLOR_CARD_STROKE = 0xFF21212C;
    private static final int COLOR_TEXT = 0xFFF4F4F8;
    private static final int COLOR_TEXT_DIM = 0xFF9A9AA8;
    private static final int COLOR_GREEN = 0xFF34D399;
    private static final int COLOR_GREEN_DIM = 0x1F34D399;
    private static final int COLOR_BLUE = 0xFF60A5FA;
    private static final int COLOR_BLUE_DIM = 0x1F60A5FA;
    private static final int COLOR_GRAY = 0xFF8E8E9C;
    private static final int COLOR_GRAY_DIM = 0x1F8E8E9C;
    private static final int COLOR_AMBER = 0xFFFBBF24;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService io =
            java.util.concurrent.Executors.newSingleThreadExecutor();

    private TextView dateLabel;
    private TextView savedLabel;
    private TextView moodValue;
    private final LinearLayout[] moodButtons = new LinearLayout[MOODS.length];
    private EditText bodyField;
    private EditText highlightsField;
    private EditText gratitudeField;
    private EditText tomorrowField;
    private TextView emptyHint;
    private boolean loading;
    private boolean dirty;
    private String mood = "";
    private String currentDate;
    private final SimpleDateFormat isoDate =
            new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    private final SimpleDateFormat prettyDate =
            new SimpleDateFormat("EEEE, MMM d, yyyy", Locale.US);

    static Intent intentFor(android.content.Context context, String date) {
        return new Intent(context, DiaryActivity.class).putExtra(EXTRA_DATE, date);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        currentDate = isoDate.format(Calendar.getInstance().getTime());
        if (getIntent().hasExtra(EXTRA_DATE)) {
            String requested = getIntent().getStringExtra(EXTRA_DATE);
            if (requested != null && requested.matches("\\d{4}-\\d{2}-\\d{2}")) {
                currentDate = requested;
            }
        }
        buildUi();
        loadDate(currentDate);
    }

    @Override
    protected void onPause() {
        super.onPause();
        flushSave();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        flushSave();
        io.shutdown();
    }

    // ---- UI ----

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BACKGROUND);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(12), dp(16), dp(96));
        scroll.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Header: back, title, saved indicator.
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = pillButton("\u2190 Workspace", COLOR_GRAY, COLOR_GRAY_DIM);
        back.setOnClickListener(view -> finish());
        header.addView(back);

        TextView title = new TextView(this);
        title.setText("Diary");
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(dp(14), 0, 0, 0);
        header.addView(title, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        savedLabel = new TextView(this);
        savedLabel.setTextColor(COLOR_TEXT_DIM);
        savedLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        savedLabel.setText("");
        header.addView(savedLabel);
        column.addView(header);

        // Date navigation row: prev | date | next | picker | list.
        LinearLayout dateRow = new LinearLayout(this);
        dateRow.setOrientation(LinearLayout.HORIZONTAL);
        dateRow.setGravity(Gravity.CENTER_VERTICAL);
        dateRow.setPadding(0, dp(12), 0, dp(4));

        TextView prev = pillButton("\u2039", COLOR_BLUE, COLOR_BLUE_DIM);
        prev.setOnClickListener(view -> shiftDate(-1));
        dateRow.addView(prev);
        dateLabel = new TextView(this);
        dateLabel.setTextColor(COLOR_TEXT);
        dateLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        dateLabel.setTypeface(Typeface.DEFAULT_BOLD);
        dateLabel.setGravity(Gravity.CENTER);
        dateRow.addView(dateLabel, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView next = pillButton("\u203a", COLOR_BLUE, COLOR_BLUE_DIM);
        next.setOnClickListener(view -> shiftDate(1));
        dateRow.addView(next);
        LinearLayout.LayoutParams navMargin = (LinearLayout.LayoutParams) next.getLayoutParams();
        navMargin.leftMargin = dp(8);

        TextView picker = pillButton("\uD83D\uDCC5", COLOR_GRAY, COLOR_GRAY_DIM);
        picker.setOnClickListener(view -> showDatePicker());
        dateRow.addView(picker, navMarginLayout());
        TextView list = pillButton("Entries", COLOR_GREEN, COLOR_GREEN_DIM);
        list.setOnClickListener(view -> showEntryList());
        dateRow.addView(list, navMarginLayout());
        column.addView(dateRow);

        // Mood picker.
        column.addView(sectionLabel("Mood"));
        LinearLayout moodRow = new LinearLayout(this);
        moodRow.setOrientation(LinearLayout.HORIZONTAL);
        for (int index = 0; index < MOODS.length; index += 1) {
            final int moodIndex = index;
            LinearLayout moodButton = new LinearLayout(this);
            moodButton.setGravity(Gravity.CENTER);
            moodButton.setMinimumHeight(dp(44));
            TextView emoji = new TextView(this);
            emoji.setText(MOODS[index]);
            emoji.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
            emoji.setGravity(Gravity.CENTER);
            moodButton.addView(emoji);
            moodButton.setOnClickListener(view -> selectMood(MOODS[moodIndex]));
            moodButtons[index] = moodButton;
            moodRow.addView(moodButton, moodButtonParams());
        }
        column.addView(moodRow);

        bodyField = addEntryField(column, "What happened today?");
        highlightsField = addEntryField(column, "Highlights");
        gratitudeField = addEntryField(column, "Gratitude");
        tomorrowField = addEntryField(column, "Plan for tomorrow");

        emptyHint = new TextView(this);
        emptyHint.setTextColor(COLOR_TEXT_DIM);
        emptyHint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        emptyHint.setPadding(dp(4), dp(14), dp(4), 0);
        emptyHint.setGravity(Gravity.CENTER);
        column.addView(emptyHint);

        setContentView(root);
    }

    private LinearLayout.LayoutParams navMarginLayout() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.leftMargin = dp(8);
        return params;
    }

    private LinearLayout.LayoutParams moodButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.rightMargin = dp(6);
        return params;
    }

    private TextView sectionLabel(String label) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextColor(COLOR_TEXT_DIM);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        view.setPadding(dp(4), dp(16), 0, dp(6));
        return view;
    }

    private EditText addEntryField(LinearLayout parent, String label) {
        parent.addView(sectionLabel(label));
        EditText field = new EditText(this);
        field.setTextColor(COLOR_TEXT);
        field.setHintTextColor(0xFF55555F);
        field.setHint("Write here\u2026");
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        field.setMinLines(label.startsWith("What") ? 4 : 2);
        field.setMaxLines(Integer.MAX_VALUE);
        field.setGravity(Gravity.TOP);
        field.setVerticalScrollBarEnabled(true);
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(12));
        background.setColor(COLOR_CARD);
        background.setStroke(dp(1), COLOR_CARD_STROKE);
        field.setBackground(background);
        field.setPadding(dp(12), dp(10), dp(12), dp(10));
        parent.addView(field, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(Editable s) {
                if (loading) return;
                dirty = true;
                savedLabel.setText("saving\u2026");
                handler.removeCallbacks(autosaveRunnable);
                handler.postDelayed(autosaveRunnable, AUTOSAVE_DELAY_MS);
            }
        });
        return field;
    }

    private final Runnable autosaveRunnable = this::saveNow;

    private void selectMood(String emoji) {
        mood = emoji.equals(mood) ? "" : emoji;
        highlightMood();
        dirty = true;
        savedLabel.setText("saving\u2026");
        handler.removeCallbacks(autosaveRunnable);
        handler.postDelayed(autosaveRunnable, AUTOSAVE_DELAY_MS);
    }

    private void highlightMood() {
        for (int index = 0; index < moodButtons.length; index += 1) {
            LinearLayout button = moodButtons[index];
            GradientDrawable background = new GradientDrawable();
            background.setCornerRadius(dp(12));
            if (MOODS[index].equals(mood)) {
                background.setColor(COLOR_GREEN_DIM);
                background.setStroke(dp(2), COLOR_GREEN);
            } else {
                background.setColor(COLOR_CARD);
                background.setStroke(dp(1), COLOR_CARD_STROKE);
            }
            button.setBackground(background);
        }
    }

    // ---- Data flow ----

    private void shiftDate(int days) {
        flushSave();
        try {
            Calendar calendar = Calendar.getInstance();
            calendar.setTime(isoDate.parse(currentDate));
            calendar.add(Calendar.DAY_OF_MONTH, days);
            loadDate(isoDate.format(calendar.getTime()));
        } catch (Exception ignored) {
        }
    }

    private void showDatePicker() {
        flushSave();
        Calendar calendar = Calendar.getInstance();
        try {
            calendar.setTime(isoDate.parse(currentDate));
        } catch (Exception ignored) {
        }
        new DatePickerDialog(this, (picker, year, month, day) -> {
            Calendar chosen = Calendar.getInstance();
            chosen.set(year, month, day);
            loadDate(isoDate.format(chosen.getTime()));
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH),
                calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private void loadDate(String date) {
        handler.removeCallbacks(autosaveRunnable);
        currentDate = date;
        dateLabel.setText(prettyLabel(date));
        loading = true;
        io.execute(() -> {
            DiaryStore.Entry entry = DiaryStore.get(this, date);
            handler.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                loading = true; // stay suppressed through field assignment
                bodyField.setText(entry == null ? "" : entry.body);
                highlightsField.setText(entry == null ? "" : entry.highlights);
                gratitudeField.setText(entry == null ? "" : entry.gratitude);
                tomorrowField.setText(entry == null ? "" : entry.tomorrow);
                mood = entry == null ? "" : entry.mood;
                highlightMood();
                dirty = false;
                loading = false;
                boolean exists = entry != null && !entry.isEmpty();
                savedLabel.setText(exists ? "saved" : "");
                emptyHint.setText(exists || entry != null ? ""
                        : "Nothing written for this day yet.\nHow did it go?");
            });
        });
    }

    private String prettyLabel(String date) {
        try {
            return prettyDate.format(isoDate.parse(date))
                    + (date.equals(isoDate.format(Calendar.getInstance().getTime()))
                            ? "  \u00b7 today" : "");
        } catch (Exception error) {
            return date;
        }
    }

    private void flushSave() {
        handler.removeCallbacks(autosaveRunnable);
        if (dirty) saveNow();
    }

    private void saveNow() {
        if (isFinishing() || isDestroyed()) return;
        final String date = currentDate;
        final String body = bodyField.getText().toString();
        final String moodValueLocal = mood;
        final String highlights = highlightsField.getText().toString();
        final String gratitude = gratitudeField.getText().toString();
        final String tomorrow = tomorrowField.getText().toString();
        io.execute(() -> {
            DiaryStore.Entry saved = DiaryStore.upsert(this, date, body,
                    moodValueLocal, highlights, gratitude, tomorrow);
            handler.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (!date.equals(currentDate)) return;
                dirty = false;
                savedLabel.setText("saved " + shortTime(saved.updatedAt));
                emptyHint.setText("");
            });
        });
    }

    private String shortTime(String isoUpdatedAt) {
        try {
            return new SimpleDateFormat("HH:mm", Locale.US)
                    .format(new SimpleDateFormat(
                            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).parse(isoUpdatedAt));
        } catch (Exception ignored) {
            return "";
        }
    }

    // ---- Entry list (search + open) ----

    private void showEntryList() {
        flushSave();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(12), dp(20), 0);
        EditText search = new EditText(this);
        search.setHint("Search entries\u2026");
        search.setSingleLine(true);
        search.setTextColor(COLOR_TEXT);
        search.setHintTextColor(0xFF55555F);
        panel.addView(search);

        ListView listView = new ListView(this);
        panel.addView(listView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(420)));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Past entries")
                .setView(wrapDark(panel))
                .setNegativeButton("Close", null)
                .show();

        EntryAdapter adapter = new EntryAdapter();
        listView.setAdapter(adapter);
        Runnable[] reload = new Runnable[1];
        reload[0] = () -> io.execute(() -> {
            List<DiaryStore.Entry> entries = DiaryStore.list(
                    DiaryActivity.this, search.getText().toString());
            handler.post(() -> adapter.replace(entries));
        });
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(Editable s) {
                handler.removeCallbacks(reload[0]);
                handler.postDelayed(reload[0], 250L);
            }
        });
        reload[0].run();
        listView.setOnItemClickListener((parent, view, position, id) -> {
            dialog.dismiss();
            loadDate(adapter.entries.get(position).date);
        });
    }

    private View wrapDark(LinearLayout panel) {
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setBackgroundColor(COLOR_BACKGROUND);
        wrapper.addView(panel);
        return wrapper;
    }

    private final class EntryAdapter extends BaseAdapter {
        final List<DiaryStore.Entry> entries = new java.util.ArrayList<>();

        void replace(List<DiaryStore.Entry> next) {
            entries.clear();
            entries.addAll(next);
            notifyDataSetChanged();
        }

        @Override public int getCount() { return entries.size(); }
        @Override public Object getItem(int position) { return entries.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            DiaryStore.Entry entry = entries.get(position);
            LinearLayout card = new LinearLayout(DiaryActivity.this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(10), dp(14), dp(10));
            GradientDrawable background = new GradientDrawable();
            background.setCornerRadius(dp(14));
            background.setColor(COLOR_CARD);
            background.setStroke(dp(1), COLOR_CARD_STROKE);
            card.setBackground(background);

            TextView date = new TextView(DiaryActivity.this);
            date.setText(prettyLabel(entry.date)
                    + (entry.mood.isEmpty() ? "" : "  " + entry.mood));
            date.setTextColor(COLOR_GREEN);
            date.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            date.setTypeface(Typeface.DEFAULT_BOLD);
            card.addView(date);

            TextView preview = new TextView(DiaryActivity.this);
            preview.setText(entry.isEmpty() ? "(empty entry)" : entry.preview());
            preview.setTextColor(entry.isEmpty() ? COLOR_TEXT_DIM : COLOR_TEXT);
            preview.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            preview.setMaxLines(2);
            card.addView(preview);

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = dp(8);
            card.setLayoutParams(params);
            return card;
        }
    }

    // ---- Shared styling helpers (mirror AiWorkspaceActivity) ----

    private TextView pillButton(String label, int color, int dimColor) {
        TextView pill = new TextView(this);
        pill.setText(label);
        pill.setTextColor(color);
        pill.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        pill.setGravity(Gravity.CENTER);
        pill.setMinimumHeight(dp(44));
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(16));
        background.setColor(dimColor);
        background.setStroke(dp(1), (color & 0x00FFFFFF) | (0x55 << 24));
        pill.setBackground(background);
        pill.setPadding(dp(12), dp(6), dp(12), dp(6));
        return pill;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
