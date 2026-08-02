import assert from "node:assert/strict";
import test from "node:test";

import { bulkComplete, bulkMove, bulkReschedule, uniqueTaskIds } from "./bulk-actions";

test("normalizes bulk task selections without mutating callers", () => {
  const selected = ["task-a", "task-a", "", "task-b"];
  assert.deepEqual(uniqueTaskIds(selected), ["task-a", "task-b"]);
  assert.deepEqual(bulkComplete(selected), {
    type: "task.bulk.complete",
    taskIds: ["task-a", "task-b"],
    completed: true,
  });
});

test("creates independent location and due-date payloads", () => {
  const location = { projectId: "project-a", sectionId: "section-a" };
  const due = { date: "2026-08-12", time: "09:00", timezone: "UTC", recurrence: null };
  const move = bulkMove(["task-a"], location);
  const reschedule = bulkReschedule(["task-a"], due);
  location.sectionId = null;
  due.date = "2026-08-13";

  assert.deepEqual(move, {
    type: "task.bulk.move",
    taskIds: ["task-a"],
    location: { projectId: "project-a", sectionId: "section-a" },
  });
  assert.deepEqual(reschedule, {
    type: "task.bulk.reschedule",
    taskIds: ["task-a"],
    due: { date: "2026-08-12", time: "09:00", timezone: "UTC", recurrence: null },
  });
});
