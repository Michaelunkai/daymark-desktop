import {
  flattenSearchGroups,
  rankSearchRecords,
  type SearchRecord,
} from "./search-index.ts";
import { filterSearchRecords, parseSearchQuery } from "./query-parser.ts";
import { applySavedFilter, parseSavedFilter } from "./saved-filters.ts";

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

const detailedTask: SearchRecord = {
  id: "task-roadmap",
  type: "task",
  title: "Publish roadmap",
  subtitle: "Share the next quarter plan",
  facets: {
    project: "Work",
    section: "Planning",
    labels: ["Focus", "Launch"],
    priority: 1,
    dueDate: "2026-08-02",
    recurrence: "every week",
    completed: false,
    assignee: "Sam",
    comments: ["Legal approved the copy."],
  },
};

const parsed = parseSearchQuery('roadmap project:"Work" label:focus priority:p1 due:today recurring:true assigned:sam comment:legal -completed:true');
assert(parsed.text === "roadmap", "The parser should preserve text terms.");
assert(parsed.terms.length === 8, "The parser should extract all supported filter terms.");
assert(
  filterSearchRecords([detailedTask], 'project:"Work" section:planning label:launch priority:1 due:today recurring:true assigned:sam comment:legal -completed:true', "2026-08-02").length === 1,
  "Facet filters should match task project, section, label, priority, due date, recurrence, assignment, comments, and completion.",
);

const savedQuery = parseSavedFilter({ query: "priority:1 label:focus" });
assert(savedQuery.terms.length === 2, "Saved filter queries should use the shared parser.");
assert(
  applySavedFilter([detailedTask], { query: "priority:1 label:focus" }).length === 1,
  "Saved filters should return matching records.",
);

console.log("SEARCH_FEATURE_TESTS_OK");
