export const QUICK_ORDER_LANES = [
  ["now", "Do now"],
  ["later", "Later"],
  ["after", "After"],
] as const;

export interface QuickProject {
  id: string;
  name: string;
}

export interface QuickSection {
  id: string;
  name: string;
  projectId: string;
}

export interface QuickTaskSource {
  content: string;
  description?: string | null;
  due?: {
    date?: string | null;
    time?: string | null;
  } | null;
  id: string;
  priority?: number | null;
  projectId: string;
  sectionId?: string | null;
  updatedAt?: string | null;
}

export interface QuickOrderSource {
  details?: string | null;
  id: string;
  lane: string;
  priority?: number | null;
  relationId?: string | null;
  title: string;
  updatedAt?: string | null;
}

export interface QuickTaskDraft {
  date: string;
  details: string;
  priority: number;
  projectId: string;
  sectionId: string;
  time: string;
  title: string;
}

export interface QuickOrderDraft {
  details: string;
  lane: string;
  priority: number;
  relationId: string;
  title: string;
}

export interface QuickConversionState {
  from: "order" | "task";
  sourceId: string;
}

export type QuickSaveAction =
  | "convert-order-to-task"
  | "convert-task-to-order"
  | "save-order"
  | "save-task";

export interface QuickSearchEntry {
  details: string;
  id: string;
  kind: "order" | "task";
  searchText: string;
  subtitle: string;
  title: string;
  updatedAt: string;
}

export function createQuickSearchEntries({
  orderItems,
  projects,
  sections,
  tasks,
}: {
  orderItems: QuickOrderSource[];
  projects: QuickProject[];
  sections: QuickSection[];
  tasks: QuickTaskSource[];
}): QuickSearchEntry[] {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const sectionNames = new Map(sections.map((section) => [section.id, section.name]));
  const orderTitles = new Map(orderItems.map((item) => [item.id, item.title]));

  return [
    ...tasks.map((task) => {
      const projectName = projectNames.get(task.projectId) ?? "Inbox";
      const sectionName = task.sectionId ? sectionNames.get(task.sectionId) : "";
      const due = task.due?.date
        ? `${task.due.date}${task.due.time ? ` at ${task.due.time}` : ""}`
        : "No date";
      const subtitle = [projectName, sectionName, due].filter(Boolean).join(" - ");
      return createEntry("task", task.id, task.content, task.description ?? "", subtitle, task.updatedAt);
    }),
    ...orderItems.map((item) => {
      const lane = QUICK_ORDER_LANES.find(([value]) => value === item.lane)?.[1] ?? item.lane;
      const afterTitle = item.lane === "after" && item.relationId
        ? orderTitles.get(item.relationId) ?? "Choose an item"
        : "";
      const subtitle = ["Order", lane, afterTitle].filter(Boolean).join(" - ");
      return createEntry("order", item.id, item.title, item.details ?? "", subtitle, item.updatedAt);
    }),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
}

export function findQuickMatches(
  entries: QuickSearchEntry[],
  query: string,
  limit = 8,
): QuickSearchEntry[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return entries.slice(0, limit);
  const tokens = normalizedQuery.split(" ").filter(Boolean);

  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: getMatchScore(entry, tokens),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((candidate) => candidate.entry);
}

export function applyClipboardToDraft<T extends Pick<QuickTaskDraft, "details" | "title">>(
  draft: T,
  clipboardText: string,
): T {
  const text = clipboardText.replace(/\r\n?/g, "\n").trim();
  if (!text) return draft;

  if (draft.title.trim()) {
    return {
      ...draft,
      details: appendDetails(draft.details, text),
    };
  }

  const [title, ...detailLines] = text.split("\n");
  return {
    ...draft,
    title: title.trim(),
    details: appendDetails(draft.details, detailLines.join("\n").trim()),
  };
}

export function buildQuickTaskInput(draft: QuickTaskDraft) {
  return {
    content: draft.title,
    description: draft.details,
    due: draft.date
      ? {
          date: draft.date,
          recurrence: null,
          time: draft.time || null,
          timezone: null,
        }
      : null,
    priority: Number(draft.priority),
    projectId: draft.projectId,
    sectionId: draft.sectionId || null,
  };
}

export function buildQuickOrderInput(draft: QuickOrderDraft) {
  return {
    details: draft.details,
    lane: draft.lane,
    priority: Number(draft.priority),
    relationId: draft.lane === "after" ? draft.relationId || null : null,
    title: draft.title,
  };
}

export function createQuickOrderDraftFromTask(task: Pick<QuickTaskDraft, "details" | "priority" | "title">): QuickOrderDraft {
  return {
    details: task.details,
    lane: "now",
    priority: task.priority,
    relationId: "",
    title: task.title,
  };
}

export function createQuickTaskDraftFromOrder(
  order: Pick<QuickOrderDraft, "details" | "priority" | "title">,
  projectId: string,
): QuickTaskDraft {
  return {
    date: "",
    details: order.details,
    priority: order.priority,
    projectId,
    sectionId: "",
    time: "",
    title: order.title,
  };
}

export function getQuickSaveAction(
  kind: "order" | "task",
  conversion: QuickConversionState | null,
): QuickSaveAction {
  if (conversion?.from === "task" && kind === "order") return "convert-task-to-order";
  if (conversion?.from === "order" && kind === "task") return "convert-order-to-task";
  return kind === "task" ? "save-task" : "save-order";
}

export function resolveSectionForProject(
  projectId: string,
  rememberedSectionId: string | undefined,
  sections: QuickSection[],
): string {
  return sections.some((section) => section.id === rememberedSectionId && section.projectId === projectId)
    ? rememberedSectionId ?? ""
    : "";
}

function appendDetails(existing: string, next: string): string {
  if (!next) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n\n${next}` : next;
}

function createEntry(
  kind: QuickSearchEntry["kind"],
  id: string,
  title: string,
  details: string,
  subtitle: string,
  updatedAt: string | null | undefined,
): QuickSearchEntry {
  return {
    details,
    id,
    kind,
    searchText: normalizeSearchText(`${title} ${details} ${subtitle}`),
    subtitle,
    title,
    updatedAt: updatedAt ?? "",
  };
}

function getMatchScore(entry: QuickSearchEntry, tokens: string[]): number {
  if (!tokens.every((token) => entry.searchText.includes(token))) return -1;
  const normalizedTitle = normalizeSearchText(entry.title);
  return tokens.reduce(
    (score, token) => score + (normalizedTitle.startsWith(token) ? 5 : normalizedTitle.includes(token) ? 3 : 1),
    0,
  );
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
