export type SearchRecordType =
  | "task"
  | "project"
  | "section"
  | "label"
  | "filter"
  | "view";

export interface SearchRecord {
  id: string;
  type: SearchRecordType;
  title: string;
  subtitle?: string;
  keywords?: readonly string[];
  recentRank?: number;
  isCompleted?: boolean;
  route?: string;
}

export interface SearchResult extends SearchRecord {
  score: number;
}

export interface SearchResultGroup {
  type: SearchRecordType;
  label: string;
  results: SearchResult[];
}

const GROUP_LABELS: Record<SearchRecordType, string> = {
  task: "Tasks",
  project: "Projects",
  section: "Sections",
  label: "Labels",
  filter: "Filters",
  view: "Views",
};

const TYPE_ORDER: readonly SearchRecordType[] = [
  "task",
  "project",
  "section",
  "label",
  "filter",
  "view",
];

export function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function rankSearchRecords(
  records: readonly SearchRecord[],
  query: string,
  limitPerGroup = 6,
): SearchResultGroup[] {
  const normalizedQuery = normalizeSearchText(query);
  const matchingRecords = records
    .map((record) => ({
      ...record,
      score: scoreRecord(record, normalizedQuery),
    }))
    .filter((record): record is SearchResult => record.score > Number.NEGATIVE_INFINITY)
    .sort(compareResults);

  return TYPE_ORDER.map((type) => {
    const results = matchingRecords
      .filter((record) => record.type === type)
      .slice(0, limitPerGroup);

    return results.length === 0
      ? null
      : { type, label: GROUP_LABELS[type], results };
  }).filter((group): group is SearchResultGroup => group !== null);
}

export function flattenSearchGroups(groups: readonly SearchResultGroup[]): SearchResult[] {
  return groups.flatMap((group) => group.results);
}

function scoreRecord(record: SearchRecord, query: string): number {
  const title = normalizeSearchText(record.title);
  const subtitle = normalizeSearchText(record.subtitle ?? "");
  const keywords = (record.keywords ?? []).map(normalizeSearchText);

  if (query.length === 0) {
    return 100 + Math.max(0, 50 - (record.recentRank ?? 50));
  }

  if (title === query) {
    return 1_000;
  }

  if (title.startsWith(query)) {
    return 800 - title.length;
  }

  if (title.includes(query)) {
    return 600 - title.indexOf(query);
  }

  if (keywords.some((keyword) => keyword.startsWith(query))) {
    return 400;
  }

  if (subtitle.includes(query) || keywords.some((keyword) => keyword.includes(query))) {
    return 200;
  }

  return Number.NEGATIVE_INFINITY;
}

function compareResults(left: SearchResult, right: SearchResult): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (left.isCompleted !== right.isCompleted) {
    return Number(left.isCompleted) - Number(right.isCompleted);
  }

  const titleComparison = left.title.localeCompare(right.title);
  return titleComparison !== 0 ? titleComparison : left.id.localeCompare(right.id);
}
