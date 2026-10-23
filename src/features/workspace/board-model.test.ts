import assert from "node:assert/strict";
import test from "node:test";
import {
  JOURNAL_LINE_RE,
  finishedDeletableIds,
  handOrderLine,
  isTaskPaused,
  pausedPrefixLine,
  prependJournalLine,
  resumedPrefixLine,
} from "./board-model";

test("isTaskPaused reads the newest journal line, below any pinned marker", () => {
  assert.equal(isTaskPaused("\u2014 PAUSED 04:05 \u2014\nwork log"), true);
  assert.equal(isTaskPaused("\u2014 pinned \u2014\n\u2014 PAUSED 04:05 \u2014\nwork log"), true);
  assert.equal(isTaskPaused("\u2014 pinned \u2014\n\u2014 RESUMED 04:06 \u2014\n\u2014 PAUSED 04:05 \u2014"), false);
  assert.equal(isTaskPaused("\u2014 update 04:05 \u2014 still working"), false);
  assert.equal(isTaskPaused("plain description"), false);
  // A PAUSED marker that is not the newest line is stale, not active.
  assert.equal(isTaskPaused("\u2014 update 04:10 \u2014\n\u2014 PAUSED 04:05 \u2014"), false);
});

test("paused and resumed prefix lines use zero-padded local clock time", () => {
  const fixed = new Date(2026, 9, 20, 4, 5);
  assert.equal(pausedPrefixLine(fixed), "\u2014 PAUSED 04:05 \u2014");
  assert.equal(resumedPrefixLine(fixed), "\u2014 RESUMED 04:05 \u2014");
  const late = new Date(2026, 9, 20, 23, 59);
  assert.equal(pausedPrefixLine(late), "\u2014 PAUSED 23:59 \u2014");
});

test("prependJournalLine preserves every existing character", () => {
  const body = "line one\n\nline three \u2014 trailing spaces kept  ";
  const prepended = prependJournalLine(body, "\u2014 PAUSED 04:05 \u2014");
  assert.equal(prepended, "\u2014 PAUSED 04:05 \u2014\n" + body);
});

test("prependJournalLine keeps the pinned marker as the first line", () => {
  const body = "\u2014 pinned \u2014\n\u2014 update 04:05 \u2014 working";
  const prepended = prependJournalLine(body, "\u2014 PAUSED 04:06 \u2014");
  assert.equal(prepended, "\u2014 pinned \u2014\n\u2014 PAUSED 04:06 \u2014\n\u2014 update 04:05 \u2014 working");
});

test("finishedDeletableIds returns only finished-section ids in order", () => {
  const tasks = [
    { id: "a", sectionId: "sec-finished" },
    { id: "b", sectionId: "sec-progress" },
    { id: "c", sectionId: "sec-finished" },
  ];
  assert.deepEqual(finishedDeletableIds(tasks, "sec-finished"), ["a", "c"]);
  assert.deepEqual(finishedDeletableIds(tasks, "sec-other"), []);
});

test("JOURNAL_LINE_RE accepts all five markers with valid clock times only", () => {
  for (const marker of ["update", "heartbeat", "REOPENED", "PAUSED", "RESUMED"]) {
    assert.match(`\u2014 ${marker} 09:07 \u2014 body`, JOURNAL_LINE_RE);
  }
  assert.doesNotMatch("\u2014 update 24:07 \u2014 impossible hour", JOURNAL_LINE_RE);
  assert.doesNotMatch("\u2014 update 09:61 \u2014 impossible minute", JOURNAL_LINE_RE);
  assert.doesNotMatch("plain text 09:07 no marker", JOURNAL_LINE_RE);
});

test("handOrderLine matches the bridge/relay hand: demand format exactly", () => {
  const fixed = new Date(2026, 9, 20, 4, 5);
  assert.equal(
    handOrderLine(fixed),
    "\u2014 ORDER 04:05 \u2014 hand: stop whatever you are doing right now and run /hand immediately",
  );
});

// SLICE-DONE: test-engineer
