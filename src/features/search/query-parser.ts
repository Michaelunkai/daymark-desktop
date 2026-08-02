import { normalizeSearchText, type SearchRecord } from "./search-index";

export type SearchFilterField =
  | "project"
  | "section"
  | "label"
  | "priority"
  | "due"
  | "recurring"
  | "completed"
  | "assigned"
  | "comment";

export interface SearchFilterTerm {
  field: SearchFilterField;
  value: string;
  negated: boolean;
}

export interface SearchQuery {
  text: string;
  terms: readonly SearchFilterTerm[];
}

const FIELD_ALIASES: Record<string, SearchFilterField> = {
  project: "project",
  section: "section",
  label: "label",
  priority: "priority",
  p: "priority",
  due: "due",
  recurring: "recurring",
  recurrence: "recurring",
  completed: "completed",
  complete: "completed",
  assigned: "assigned",
  assignee: "assigned",
  comment: "comment",
  comments: "comment",
};

export function parseSearchQuery(value: string): SearchQuery {
  const text: string[] = [];
  const terms: SearchFilterTerm[] = [];

  for (const rawToken of tokenize(value)) {
    const negated = rawToken.startsWith("-");
    const token = negated ? rawToken.slice(1) : rawToken;
    const separator = token.indexOf(":");
    if (separator <= 0) {
      text.push(rawToken);
      continue;
    }

    const field = FIELD_ALIASES[normalizeSearchText(token.slice(0, separator))];
    const termValue = unquote(token.slice(separator + 1)).trim();
    if (!field || !termValue) {
      text.push(rawToken);
      continue;
    }

    terms.push({ field, value: termValue, negated });
  }

  return { text: text.join(" ").trim(), terms };
}

export function matchesSearchQuery(record: SearchRecord, query: SearchQuery, today = localToday()): boolean {
  if (query.text && !matchesFreeText(record, query.text)) {
    return false;
  }

  return query.terms.every((term) => {
    const matched = matchesTerm(record, term, today);
    return term.negated ? !matched : matched;
  });
}

export function filterSearchRecords(
  records: readonly SearchRecord[],
  queryText: string,
  today?: string,
): SearchRecord[] {
  const query = parseSearchQuery(queryText);
  return records.filter((record) => matchesSearchQuery(record, query, today));
}

function matchesFreeText(record: SearchRecord, text: string): boolean {
  const haystack = [
    record.title,
    record.subtitle ?? "",
    ...(record.keywords ?? []),
    record.facets?.project ?? "",
    record.facets?.section ?? "",
    ...(record.facets?.labels ?? []),
    record.facets?.assignee ?? "",
    ...(record.facets?.comments ?? []),
  ]
    .map(normalizeSearchText)
    .join("\n");

  return tokenize(text).every((token) => haystack.includes(normalizeSearchText(unquote(token))));
}

function matchesTerm(record: SearchRecord, term: SearchFilterTerm, today: string): boolean {
  const facets = record.facets;
  const expected = normalizeSearchText(term.value);
  switch (term.field) {
    case "project":
      return sameText(facets?.project, expected);
    case "section":
      return sameText(facets?.section, expected);
    case "label":
      return (facets?.labels ?? []).some((label) => sameText(label, expected));
    case "priority":
      return priorityMatches(facets?.priority, expected);
    case "due":
      return dueMatches(facets?.dueDate, expected, today);
    case "recurring":
      return booleanMatches(Boolean(facets?.recurrence), expected);
    case "completed":
      return booleanMatches(Boolean(facets?.completed ?? record.isCompleted), expected);
    case "assigned":
      return sameText(facets?.assignee, expected);
    case "comment":
      return (facets?.comments ?? []).some((comment) => normalizeSearchText(comment).includes(expected));
  }
}

function tokenize(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function sameText(value: string | null | undefined, expected: string): boolean {
  return normalizeSearchText(value ?? "").includes(expected);
}

function priorityMatches(priority: number | undefined, expected: string): boolean {
  const normalized = expected.replace(/^p/, "");
  return priority === Number(normalized);
}

function dueMatches(date: string | null | undefined, expected: string, today: string): boolean {
  if (expected === "none" || expected === "unscheduled") {
    return !date;
  }
  if (!date) {
    return false;
  }
  if (expected === "today") {
    return date === today;
  }
  if (expected === "overdue") {
    return date < today;
  }
  if (expected === "upcoming") {
    return date >= today;
  }
  return date === expected;
}

function booleanMatches(value: boolean, expected: string): boolean {
  return ["true", "yes", "1"].includes(expected) ? value : ["false", "no", "0"].includes(expected) ? !value : value;
}

function localToday(): string {
  return new Date().toISOString().slice(0, 10);
}
