import type {
  TaskEditorDraft,
  TaskEditorField,
  TaskEditorValidationResult,
  TaskPriority,
} from './types';

export const DEFAULT_TASK_EDITOR_DRAFT: TaskEditorDraft = {
  title: '',
  description: '',
  projectId: null,
  sectionId: null,
  priority: 4,
  dueText: '',
  recurrenceText: '',
  reminderText: '',
  orderLane: 'now',
  orderRelationId: null,
};

export function createTaskEditorDraft(
  overrides: Partial<TaskEditorDraft> = {},
): TaskEditorDraft {
  return {
    ...DEFAULT_TASK_EDITOR_DRAFT,
    ...overrides,
  };
}

export function updateTaskEditorDraft<Field extends TaskEditorField>(
  draft: TaskEditorDraft,
  field: Field,
  value: TaskEditorDraft[Field],
): TaskEditorDraft {
  return {
    ...draft,
    [field]: Array.isArray(value) ? [...value] : value,
  } as TaskEditorDraft;
}

export function normalizeTaskEditorDraft(
  draft: TaskEditorDraft,
): TaskEditorDraft {
  const priority = [1, 2, 3, 4].includes(draft.priority)
    ? draft.priority
    : DEFAULT_TASK_EDITOR_DRAFT.priority;

  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    projectId: normalizeOptionalId(draft.projectId),
    sectionId: normalizeOptionalId(draft.sectionId),
    priority: priority as TaskPriority,
    dueText: draft.dueText.trim(),
    recurrenceText: draft.recurrenceText.trim(),
    reminderText: draft.reminderText.trim(),
    orderLane: ['now', 'later', 'after'].includes(draft.orderLane)
      ? draft.orderLane
      : DEFAULT_TASK_EDITOR_DRAFT.orderLane,
    orderRelationId: normalizeOptionalId(draft.orderRelationId),
  };
}

export function validateTaskEditorDraft(
  draft: TaskEditorDraft,
): TaskEditorValidationResult {
  const value = normalizeTaskEditorDraft(draft);
  const errors: TaskEditorValidationResult['errors'] = {};

  if (!value.title) {
    errors.title = 'Add a task title before saving.';
  }

  if (value.sectionId && !value.projectId) {
    errors.sectionId = 'Choose a project before selecting a section.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    value,
    errors,
  };
}

export function getTaskTransferDestinationError(destination: {
  projectId: string | null;
  sectionId: string | null;
}): string {
  if (destination.projectId !== null && !destination.projectId.trim()) {
    return 'Choose Inbox or a project before transferring.';
  }

  if (destination.sectionId !== null && !destination.sectionId.trim()) {
    return 'Choose a section or explicitly choose No section.';
  }

  return '';
}

export function getOrderTransferDestinationError(destination: {
  orderLane: string | null;
  orderRelationId?: string | null;
}): string {
  if (!destination.orderLane) {
    return 'Choose an Order section before transferring.';
  }

  return '';
}

export function isTaskEditorDirty(
  initialDraft: TaskEditorDraft,
  draft: TaskEditorDraft,
): boolean {
  return (
    JSON.stringify(normalizeTaskEditorDraft(initialDraft)) !==
    JSON.stringify(normalizeTaskEditorDraft(draft))
  );
}

function normalizeOptionalId(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}
