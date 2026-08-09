import { CURRENT_SCHEMA_VERSION, type AppState, type EntityId } from "./types";

export const INBOX_PROJECT_ID = "project-inbox";

export function createSampleState(
  now = new Date().toISOString(),
  clientId: EntityId = createId("client"),
): AppState {
  const inbox = {
    id: INBOX_PROJECT_ID,
    name: "Inbox",
    description: "A quick place to capture work before organizing it.",
    color: "charcoal",
    parentId: null,
    layout: "list" as const,
    order: 0,
    isFavorite: true,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  const personal = {
    id: "project-personal",
    name: "Personal",
    description: "Small things worth keeping visible.",
    color: "teal",
    parentId: null,
    layout: "list" as const,
    order: 1,
    isFavorite: false,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  const next = {
    id: "section-next",
    projectId: personal.id,
    name: "Next",
    order: 0,
    isCollapsed: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    clientId,
    updatedAt: now,
    projects: { [inbox.id]: inbox, [personal.id]: personal },
    sections: { [next.id]: next },
    filters: {
      "filter-priority": {
        id: "filter-priority",
        name: "Priority",
        color: "red",
        query: "p1 | p2",
        order: 0,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    tasks: {
      "task-welcome": {
        id: "task-welcome",
        content: "Make this workspace your own",
        description: "Add a task, update its details, and complete it when ready.",
        projectId: personal.id,
        sectionId: next.id,
        parentId: null,
        priority: 2,
        due: null,
        completedAt: null,
        completionContext: null,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
    orderItems: {
      "order-welcome": {
        id: "order-welcome",
        title: "Choose the next useful step",
        details: "Keep this list small enough to act on.",
        lane: "now",
        relationId: null,
        priority: 2,
        status: "open",
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
    notes: {},
    diaryEntries: {},
    preferences: {
      inboxProjectId: inbox.id,
      activeProjectId: inbox.id,
      onboardingDismissed: false,
      theme: "system",
      showCompleted: false,
    },
    undoStack: [],
    syncTombstones: {},
  };
}

export function createId(prefix: string): EntityId {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
