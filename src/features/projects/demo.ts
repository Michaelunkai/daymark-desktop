import type { Label, Project, Section } from "../../core/types";
import type { ProjectTask } from "./types";

const CREATED_AT = "2026-08-02T14:00:00.000Z";

export const demoProject: Project = {
  id: "project-studio-refresh",
  name: "Studio refresh",
  description: "A small project for making the workspace calmer and easier to scan.",
  color: "#c45b4a",
  parentId: null,
  layout: "list",
  order: 0,
  isFavorite: true,
  isArchived: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const demoSections: Section[] = [
  {
    id: "section-plan",
    projectId: demoProject.id,
    name: "Plan",
    order: 0,
    isCollapsed: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: "section-build",
    projectId: demoProject.id,
    name: "Build",
    order: 1,
    isCollapsed: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
];

export const demoLabels: Label[] = [
  {
    id: "label-focus",
    name: "focus",
    color: "#4e75bf",
    order: 0,
    isFavorite: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: "label-review",
    name: "review",
    color: "#c17b37",
    order: 1,
    isFavorite: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
];

export const demoTasks: ProjectTask[] = [
  {
    id: "task-map-flow",
    content: "Map the first-run flow",
    description: "",
    projectId: demoProject.id,
    sectionId: "section-plan",
    parentId: null,
    labelIds: ["label-focus"],
    priority: 2,
    due: {
      date: "2026-08-02",
      time: "10:00",
      timezone: null,
      recurrence: null,
    },
    completedAt: null,
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    dueLabel: "Today",
    dueTone: "today",
  },
  {
    id: "task-choose-layout",
    content: "Choose a layout for the project",
    description: "",
    projectId: demoProject.id,
    sectionId: "section-plan",
    parentId: null,
    labelIds: ["label-review"],
    priority: 3,
    due: null,
    completedAt: null,
    order: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: "task-ship-shell",
    content: "Ship the first usable shell",
    description: "",
    projectId: demoProject.id,
    sectionId: "section-build",
    parentId: null,
    labelIds: [],
    priority: 4,
    due: {
      date: "2026-08-03",
      time: null,
      timezone: null,
      recurrence: null,
    },
    completedAt: null,
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    dueLabel: "Tomorrow",
    dueTone: "tomorrow",
  },
];

export const demoProjectView = {
  project: demoProject,
  sections: demoSections,
  labels: demoLabels,
  tasks: demoTasks,
} as const;
