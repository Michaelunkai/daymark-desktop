import {
  flattenSearchGroups,
  rankSearchRecords,
  type SearchRecord,
} from "./search-index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const records: SearchRecord[] = [
  { id: "task-plan", type: "task", title: "Plan release", recentRank: 2 },
  { id: "project-release", type: "project", title: "Release plan" },
  { id: "label-planning", type: "label", title: "Planning" },
  { id: "task-completed", type: "task", title: "Plan archive", isCompleted: true, recentRank: 105 },
];

const ranked = rankSearchRecords(records, "plan");
assert(ranked[0]?.type === "task", "Task matches should group before project matches.");
assert(ranked[0]?.results[0]?.id === "task-plan", "A title prefix should rank before a title substring.");
assert(flattenSearchGroups(ranked).length === 4, "Matching records should flatten in rendered keyboard order.");

const limited = rankSearchRecords(records, "plan", 1);
assert(limited.find((group) => group.type === "task")?.results.length === 1, "Group limits should be enforced.");

const emptyQuery = rankSearchRecords(records, "");
assert(emptyQuery[0]?.results[0]?.id === "task-plan", "Recent records should lead an empty search.");

console.log("SEARCH_FEATURE_TESTS_OK");
