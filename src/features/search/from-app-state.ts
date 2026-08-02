import type { AppState } from "../../core/types";
import type { SearchRecord } from "./search-index";

export function buildSearchRecords(state: AppState): SearchRecord[] {
  const projectNames = new Map(
    Object.values(state.projects).map((project) => [project.id, project.name]),
  );
  const sectionNames = new Map(
    Object.values(state.sections).map((section) => [section.id, section.name]),
  );
  const labelNames = new Map(
    Object.values(state.labels).map((label) => [label.id, label.name]),
  );

  const views: SearchRecord[] = [
    { id: "view-inbox", type: "view", title: "Inbox", keywords: ["capture"], route: "inbox" },
    { id: "view-today", type: "view", title: "Today", keywords: ["agenda"], route: "today" },
    { id: "view-upcoming", type: "view", title: "Upcoming", keywords: ["calendar", "schedule"], route: "upcoming" },
    { id: "view-filters-labels", type: "view", title: "Filters & Labels", keywords: ["manage"] },
  ];

  const projects = Object.values(state.projects)
    .filter((project) => !project.isArchived)
    .map<SearchRecord>((project) => ({
      id: project.id,
      type: "project",
      title: project.name,
      subtitle: project.description || undefined,
      keywords: [project.color],
      recentRank: project.id === state.preferences.activeProjectId ? 0 : project.order + 10,
      route: `project:${project.id}`,
    }));

  const sections = Object.values(state.sections).map<SearchRecord>((section) => ({
    id: section.id,
    type: "section",
    title: section.name,
    subtitle: projectNames.get(section.projectId),
  }));

  const labels = Object.values(state.labels).map<SearchRecord>((label) => ({
    id: label.id,
    type: "label",
    title: label.name,
    keywords: [label.color],
    route: `label:${label.id}`,
  }));

  const filters = Object.values(state.filters).map<SearchRecord>((filter) => ({
    id: filter.id,
    type: "filter",
    title: filter.name,
    subtitle: filter.query,
    keywords: [filter.color],
    route: `filter:${filter.id}`,
  }));

  const tasks = Object.values(state.tasks).map<SearchRecord>((task) => ({
    id: task.id,
    type: "task",
    title: task.content,
    subtitle: task.description || projectNames.get(task.projectId),
    keywords: [
      projectNames.get(task.projectId) ?? "",
      task.sectionId ? sectionNames.get(task.sectionId) ?? "" : "",
      ...task.labelIds.map((labelId) => labelNames.get(labelId) ?? ""),
      `p${task.priority}`,
      task.completedAt ? "completed" : "active",
    ],
    isCompleted: task.completedAt !== null,
    recentRank: task.order + (task.completedAt ? 100 : 0),
  }));

  return [...views, ...projects, ...sections, ...labels, ...filters, ...tasks];
}
