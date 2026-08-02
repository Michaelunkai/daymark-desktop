import type { SavedFilter } from "../../core/types";
import { filterSearchRecords, parseSearchQuery, type SearchQuery } from "./query-parser";
import type { SearchRecord } from "./search-index";

export interface SavedFilterMatch {
  filter: SavedFilter;
  query: SearchQuery;
  records: SearchRecord[];
}

export function parseSavedFilter(filter: Pick<SavedFilter, "query">): SearchQuery {
  return parseSearchQuery(filter.query);
}

export function applySavedFilter(
  records: readonly SearchRecord[],
  filter: Pick<SavedFilter, "query">,
  today?: string,
): SearchRecord[] {
  return filterSearchRecords(records, filter.query, today);
}

export function resolveSavedFilters(
  records: readonly SearchRecord[],
  filters: readonly SavedFilter[],
  today?: string,
): SavedFilterMatch[] {
  return filters
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((filter) => ({
      filter,
      query: parseSavedFilter(filter),
      records: applySavedFilter(records, filter, today),
    }));
}
