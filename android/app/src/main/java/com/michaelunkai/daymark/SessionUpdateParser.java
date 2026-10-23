package com.michaelunkai.daymark;

import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses the AI session journal that agents prepend to task descriptions.
 * Entries look like "— update 14:32 — shipped the parser", "— heartbeat 09:07 —",
 * and "— REOPENED 18:40 — user correction". Newest entries are always prepended,
 * so the first marker line in the description is the latest update.
 */
final class SessionUpdateParser {

    /** One journal entry extracted from a description. */
    static final class Entry {
        final String kind;
        final String stamp;
        final String message;
        final long timeMillis;
        /** Machine-written line (watchdog heartbeat/nudge/escalation): shown as
         *  muted system activity, never as the card's hero status. */
        final boolean machine;

        Entry(String kind, String stamp, String message, long timeMillis, boolean machine) {
            this.kind = kind;
            this.stamp = stamp;
            this.message = message;
            this.timeMillis = timeMillis;
            this.machine = machine;
        }
    }

    /** Parse outcome for one description. */
    static final class Result {
        final Entry latest;
        final int markerCount;
        final String plainBody;
        /** Newest update/heartbeat entry (agent liveness); null when none exists. */
        final Entry latestAgent;
        /** Newest SESSION-authored line (update/ack/reopened) — the card's hero;
         *  machine watchdog lines never hold this slot. Null when none exists. */
        final Entry latestSession;
        /** Sub-agents currently running, from the newest agent-authored line that
         * states a count ("created N agents", "N agents running", "\u2014 agents N \u2014").
         * Falls back to 0 when the newest count mention is stale (agents finished
         * and nothing newer re-stated the count). Null when no line ever mentioned one. */
        final Integer agentsCount;

        Result(Entry latest, int markerCount, String plainBody,
                Entry latestAgent, Entry latestSession, Integer agentsCount) {
            this.latest = latest;
            this.markerCount = markerCount;
            this.plainBody = plainBody;
            this.latestAgent = latestAgent;
            this.latestSession = latestSession;
            this.agentsCount = agentsCount;
        }
    }

    private static final Pattern MARKER = Pattern.compile(
            "^\\s*[-\u2014\u2013]{1,2}\\s*(reopened|heartbeat|update|paused|resumed|message|order|ack)\\s+([01]?\\d|2[0-3]):([0-5]\\d)\\s*[-\u2014\u2013]{1,2}\\s*(.*)\\s*$",
            Pattern.CASE_INSENSITIVE);

    /** Machine-authored watchdog text: relay/bridge nudges, escalations, live-quotes. */
    private static final Pattern MACHINE_TEXT = Pattern.compile(
            "^(watchdog escalation|REPLY NOW|unanswered message nudge|ack-now|live: \"|watchdog: task)",
            Pattern.CASE_INSENSITIVE);

    /** "\u2014 agents 3 \u2014" (any whitespace): the agent declared N sub-agents. */
    private static final Pattern AGENTS_LINE = Pattern.compile(
            "^\\s*[-\u2014\u2013]{1,2}\\s*agents\\s+(\\d+)\\s*[-\u2014\u2013]{1,2}\\s*$",
            Pattern.CASE_INSENSITIVE);

    /** Inline sub-agent counts, e.g. "created 4 agents" or "created exactly 4 sub-agents". */
    private static final Pattern CREATED_AGENTS = Pattern.compile(
            "created\\s+(?:exactly\\s+)?(\\d+)\\s+(?:sub-?\\s*)?agents", Pattern.CASE_INSENSITIVE);

    /** Inline sub-agent state, e.g. "3 agents running" or "2 sub-agents created". */
    private static final Pattern AGENTS_STATE = Pattern.compile(
            "(\\d+)\\s+(?:sub-?\\s*)?agents\\s+(?:created|running)", Pattern.CASE_INSENSITIVE);

    /** All agents finished, e.g. "all 3 agents done/finished/completed": count resets to 0. */
    private static final Pattern DONE_AGENTS = Pattern.compile(
            "(?:all\\s+)?(\\d+)\\s+(?:sub-?\\s*)?agents\\s+(?:are\\s+)?(?:all\\s+)?(?:done|finished|completed)",
            Pattern.CASE_INSENSITIVE);

    /** Parenthetical finished tally inside a running line, e.g. "3 agents running (1 done, 2 streaming)". */
    private static final Pattern DONE_TALLY = Pattern.compile(
            "\\((\\d+)\\s+done", Pattern.CASE_INSENSITIVE);

    private SessionUpdateParser() {
    }

    static Result parse(String description, long fallbackTimeMillis) {
        if (description == null || description.isEmpty()) {
            return new Result(null, 0, "", null, null, null);
        }
        Entry latest = null;
        Entry latestAgent = null;
        Entry latestSession = null;
        Integer agentsCount = null;
        int markerCount = 0;
        StringBuilder plainBody = new StringBuilder();
        String[] lines = description.split("\n", -1);
        for (int index = 0; index < lines.length; index += 1) {
            String line = lines[index];
            // Journal lines are prepended newest-first: the first inline count in
            // the top 20 lines is the newest one.
            if (agentsCount == null && index < 20) {
                Integer inline = matchAgentsCount(line);
                if (inline != null) agentsCount = inline;
            }
            Matcher matcher = MARKER.matcher(line);
            if (matcher.matches()) {
                markerCount += 1;
                String stamp = normalizeStamp(matcher.group(2) + ":" + matcher.group(3));
                String kind = matcher.group(1).toLowerCase(Locale.US);
                String message = matcher.group(4).trim();
                boolean machine = "heartbeat".equals(kind)
                        || ("order".equals(kind) && MACHINE_TEXT.matcher(message).lookingAt());
                Entry entry = new Entry(kind, stamp, message,
                        resolveTimeMillis(stamp, fallbackTimeMillis), machine);
                if (latest == null) latest = entry;
                if (latestAgent == null
                        && ("update".equals(kind) || "heartbeat".equals(kind))) {
                    latestAgent = entry;
                }
                if (latestSession == null && !machine
                        && ("update".equals(kind) || "ack".equals(kind) || "reopened".equals(kind) || "progress".equals(kind))) {
                    latestSession = entry;
                }
            } else {
                Matcher agents = AGENTS_LINE.matcher(line);
                if (agents.matches() && agentsCount == null) {
                    try {
                        agentsCount = Integer.parseInt(agents.group(1));
                        markerCount += 1;
                        continue;
                    } catch (NumberFormatException ignored) {
                        // Fall through and treat it as plain body text.
                    }
                }
            }
            if (line.trim().length() > 0) {
                if (plainBody.length() > 0) {
                    plainBody.append('\n');
                }
                plainBody.append(line);
            }
        }
        return new Result(latest, markerCount, plainBody.toString().trim(),
                latestAgent, latestSession, agentsCount);
    }

    /** "just now", "4m ago", "3h ago", "2d ago" for card headers and the refresh label. */
    static String relativeTime(long thenMillis, long nowMillis) {
        long seconds = Math.max(0, (nowMillis - thenMillis) / 1000L);
        if (seconds < 60) return "just now";
        long minutes = seconds / 60;
        if (minutes < 60) return minutes + "m ago";
        long hours = minutes / 60;
        if (hours < 24) return hours + "h ago";
        long days = hours / 24;
        if (days < 7) return days + "d ago";
        return (days / 7) + "w ago";
    }

    private static String normalizeStamp(String raw) {
        int colon = raw.indexOf(':');
        int hour = Integer.parseInt(raw.substring(0, colon));
        int minute = Integer.parseInt(raw.substring(colon + 1));
        return String.format(Locale.US, "%02d:%02d", hour, minute);
    }

    /** Inline sub-agent count for one journal line; null when the line has none. */
    private static Integer matchAgentsCount(String line) {
        Matcher done = DONE_AGENTS.matcher(line);
        if (done.find()) return 0;
        Matcher created = CREATED_AGENTS.matcher(line);
        if (created.find()) return parseCount(created.group(1));
        Matcher state = AGENTS_STATE.matcher(line);
        if (state.find()) {
            Integer count = parseCount(state.group(1));
            if (count == null) return null;
            Matcher tally = DONE_TALLY.matcher(line);
            if (tally.find()) {
                count = Math.max(0, count - parseCount(tally.group(1)));
            }
            return count;
        }
        return null;
    }

    private static Integer parseCount(String raw) {
        try {
            return Integer.valueOf(raw);
        } catch (NumberFormatException ignored) {
            // Not a usable count; treat the line as having none.
            return null;
        }
    }

    /**
     * Journal stamps only carry HH:MM, so the date is recovered from the task's own
     * updated timestamp; a stamp later today is assumed to be yesterday's.
     */
    private static long resolveTimeMillis(String stamp, long fallbackTimeMillis) {
        if (fallbackTimeMillis <= 0L) {
            // No usable task timestamp: anchor the HH:MM stamp to today.
            fallbackTimeMillis = System.currentTimeMillis();
        }
        int colon = stamp.indexOf(':');
        int hour = Integer.parseInt(stamp.substring(0, colon));
        int minute = Integer.parseInt(stamp.substring(colon + 1));
        Calendar resolved = Calendar.getInstance();
        resolved.setTimeInMillis(fallbackTimeMillis);
        Calendar now = Calendar.getInstance();
        resolved.set(Calendar.HOUR_OF_DAY, hour);
        resolved.set(Calendar.MINUTE, minute);
        resolved.set(Calendar.SECOND, 0);
        resolved.set(Calendar.MILLISECOND, 0);
        if (resolved.getTimeInMillis() > now.getTimeInMillis() + 60_000L) {
            resolved.add(Calendar.DAY_OF_YEAR, -1);
        }
        return resolved.getTimeInMillis();
    }
}
