import assert from "node:assert/strict";
import test from "node:test";

import {
  dueInstantForTask,
  materializeNextOccurrence,
  occurrenceId,
  zonedDateTimeToInstant,
} from "./recurrence-materializer";

test("resolves DST gaps by rolling forward to the first real local minute", () => {
  assert.equal(
    zonedDateTimeToInstant("2026-03-08", "02:30", "America/New_York")?.toISOString(),
    "2026-03-08T07:00:00.000Z",
  );
});

test("resolves DST folds to the earlier matching instant deterministically", () => {
  assert.equal(
    zonedDateTimeToInstant("2026-11-01", "01:30", "America/New_York")?.toISOString(),
    "2026-11-01T05:30:00.000Z",
  );
});

test("keeps the due wall clock time tied to its assigned timezone", () => {
  assert.equal(
    zonedDateTimeToInstant("2026-08-09", "09:15", "Asia/Jerusalem")?.toISOString(),
    "2026-08-09T06:15:00.000Z",
  );
  assert.equal(
    zonedDateTimeToInstant("2026-08-09", "09:15", "America/New_York")?.toISOString(),
    "2026-08-09T13:15:00.000Z",
  );
});

test("materializes a deterministic occurrence and preserves moved due metadata", () => {
  const task = {
    id: "task-weekly",
    due: {
      date: "2026-08-09",
      recurrence: "every week",
      time: "09:15",
      timezone: "Asia/Jerusalem",
    },
  };

  const next = materializeNextOccurrence(task, "2026-08-09");
  assert.deepEqual(next, {
    id: occurrenceId("task-weekly", "2026-08-16"),
    sourceTaskId: "task-weekly",
    due: { ...task.due, date: "2026-08-16" },
  });
  assert.equal(dueInstantForTask(task.due)?.toISOString(), "2026-08-09T06:15:00.000Z");
});

test("does not materialize invalid or bounded recurrence rules", () => {
  assert.equal(
    materializeNextOccurrence(
      {
        id: "task-ended",
        due: {
          date: "2026-08-02",
          recurrence: "every week",
          time: null,
          timezone: null,
        },
      },
      "2026-08-16",
    )?.due.date,
    "2026-08-23",
  );
  assert.equal(materializeNextOccurrence({ id: "task-no-rule", due: null }, "2026-08-02"), null);
});
