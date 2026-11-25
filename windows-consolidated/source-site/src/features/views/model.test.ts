import assert from "node:assert/strict";
import test from "node:test";

import { demoSections, demoTasks } from "../projects/demo.ts";
import { countOpenTasks, groupTasksBySection, sortSections } from "./model.ts";

test("sorts sections without mutating the source array", () => {
  const input = [demoSections[1], demoSections[0]];
  const sorted = sortSections(input);

  assert.deepEqual(
    sorted.map((section) => section.id),
    ["section-plan", "section-build"],
  );
  assert.deepEqual(
    input.map((section) => section.id),
    ["section-build", "section-plan"],
  );
});

test("groups tasks by section and preserves an unsectioned bucket", () => {
  const orphan = {
    ...demoTasks[0],
    id: "task-orphan",
    sectionId: "missing-section",
    order: -1,
  };
  const result = groupTasksBySection(demoSections, [...demoTasks, orphan]);

  assert.deepEqual(
    result.buckets.map((bucket) => bucket.tasks.map((task) => task.id)),
    [["task-map-flow", "task-choose-layout"], ["task-ship-shell"]],
  );
  assert.deepEqual(result.unsectioned.map((task) => task.id), ["task-orphan"]);
});

test("filters completed tasks for display without changing the source", () => {
  const completed = {
    ...demoTasks[0],
    id: "task-completed",
    completedAt: "2026-08-02T15:00:00.000Z",
  };
  const result = groupTasksBySection(demoSections, [...demoTasks, completed], false);

  assert.equal(result.buckets[0].tasks.some((task) => task.id === completed.id), false);
  assert.equal(completed.completedAt, "2026-08-02T15:00:00.000Z");
});

test("counts open tasks from the core completion field", () => {
  const completed = { ...demoTasks[0], completedAt: "2026-08-02T15:00:00.000Z" };

  assert.equal(countOpenTasks([...demoTasks, completed]), 3);
});
