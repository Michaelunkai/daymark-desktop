import assert from "node:assert/strict";
import test from "node:test";
import { boardHealth, updateAgeState } from "./health";

function atTime(hour: number, minute: number): number {
  return new Date(2026, 9, 20, hour, minute).getTime();
}

test("updateAgeState classifies freshness against the five-minute law", () => {
  const now = atTime(10, 0);
  const fresh = updateAgeState("\u2014 update 09:57 \u2014 working", now);
  assert.equal(fresh.state, "fresh");
  assert.match(fresh.label, /updated 3m/);

  const due = updateAgeState("\u2014 update 09:53 \u2014 working", now);
  assert.equal(due.state, "due");
  assert.match(due.label, /due/);

  const late = updateAgeState("\u2014 update 09:48 \u2014 working", now);
  assert.equal(late.state, "late");
  assert.match(late.label, /overdue 12m/);
});

test("updateAgeState handles missing, malformed, and future-stamped lines", () => {
  const now = atTime(10, 0);
  assert.deepEqual(updateAgeState(null, now), { label: "no updates yet", state: "none", ageMin: -1 });
  assert.equal(updateAgeState("plain body text", now).state, "none");
  // A stamp seconds ahead is truncation skew, not tomorrow.
  const skew = updateAgeState("\u2014 update 10:01 \u2014 written at 10:00:59", now);
  assert.equal(skew.state, "fresh");
  assert.equal(skew.ageMin, 0);
});

test("updateAgeState wraps journal lines from before midnight", () => {
  const now = atTime(0, 10);
  const wrapped = updateAgeState("\u2014 update 23:55 \u2014 late shift", now);
  assert.equal(wrapped.ageMin, 15);
  assert.equal(wrapped.state, "late");
});

test("boardHealth counts on-time cards among watched cards", () => {
  const now = atTime(10, 0);
  const health = boardHealth(
    [
      "\u2014 update 09:58 \u2014 on time",
      "\u2014 update 09:40 \u2014 overdue",
      "no journal yet",
      "\u2014 PAUSED 09:59 \u2014",
    ],
    now,
  );
  assert.deepEqual(health, { onTime: 2, watched: 3, oldestMin: 20 });
});

// SLICE-DONE: test-engineer
