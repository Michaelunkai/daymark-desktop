import {
  parseDateExpression,
  parseRecurrence,
  type LocalDate,
} from '../../core/dates';
import type {
  Project,
  OrderItemInput,
  Section,
  Task,
  TaskDue,
  TaskInput,
  TaskPatch,
} from '../../core/types';

import {
  getOrderTransferDestinationError,
  normalizeTaskEditorDraft,
  validateTaskEditorDraft,
} from './form-state';
import type {
  TaskEditorDraft,
  TaskEditorErrors,
  TaskEditorOption,
} from './types';

export type TaskEditorAdapterContext = {
  today?: LocalDate;
  inboxProjectId?: string;
};

export type TaskEditorAdapterResult<Value> =
  | {
      ok: true;
      value: Value;
    }
  | {
      ok: false;
      errors: TaskEditorErrors;
    };

export function taskToTaskEditorDraft(task: Task): TaskEditorDraft {
  return {
    title: task.content,
    description: task.description,
    projectId: task.projectId,
    sectionId: task.sectionId,
    priority: task.priority,
    dueText: task.due ? formatDueText(task.due) : '',
    recurrenceText: task.due?.recurrence ?? '',
    reminderText: '',
    orderLane: 'now',
    orderRelationId: null,
  };
}

export function taskEditorDraftToTaskInput(
  draft: TaskEditorDraft,
  context: TaskEditorAdapterContext = {},
): TaskEditorAdapterResult<TaskInput> {
  const normalized = validateAndSchedule(draft, context);
  if (!normalized.ok) {
    return normalized;
  }

  const input: TaskInput = {
    content: normalized.value.title,
    description: normalized.value.description,
    sectionId: normalized.value.sectionId,
    priority: normalized.value.priority,
    due: normalized.value.due,
  };

  const projectId = normalized.value.projectId ?? context.inboxProjectId;
  if (projectId) {
    input.projectId = projectId;
  }

  return { ok: true, value: input };
}

export function taskEditorDraftToTaskPatch(
  draft: TaskEditorDraft,
  context: TaskEditorAdapterContext = {},
): TaskEditorAdapterResult<TaskPatch> {
  const normalized = validateAndSchedule(draft, context);
  if (!normalized.ok) {
    return normalized;
  }

  const patch: TaskPatch = {
    content: normalized.value.title,
    description: normalized.value.description,
    sectionId: normalized.value.sectionId,
    priority: normalized.value.priority,
    due: normalized.value.due,
  };

  const projectId = normalized.value.projectId ?? context.inboxProjectId;
  if (projectId) {
    patch.projectId = projectId;
  }

  return { ok: true, value: patch };
}

export function taskEditorDraftToOrderItemInput(
  draft: TaskEditorDraft,
): TaskEditorAdapterResult<OrderItemInput> {
  const value = normalizeTaskEditorDraft(draft);
  if (!value.title) {
    return {
      ok: false,
      errors: { title: 'Add a task title before transferring.' },
    };
  }

  const destinationError = getOrderTransferDestinationError(value);
  if (destinationError) {
    return {
      ok: false,
      errors: { form: destinationError },
    };
  }

  return {
    ok: true,
    value: {
      title: value.title,
      details: value.description,
      lane: value.orderLane,
      relationId: null,
      priority: value.priority,
      status: 'open',
    },
  };
}

export function toTaskEditorProjectOptions(
  projects: readonly Project[],
): TaskEditorOption[] {
  return projects
    .filter((project) => !project.isArchived)
    .sort((left, right) => left.order - right.order)
    .map((project) => ({
      id: project.id,
      label: project.name,
      color: project.color,
    }));
}

export function toTaskEditorSectionOptions(
  sections: readonly Section[],
  projectId?: string | null,
): TaskEditorOption[] {
  if (projectId === null) {
    return [];
  }

  return sections
    .filter((section) => projectId === undefined || section.projectId === projectId)
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      id: section.id,
      label: section.name,
      ...(projectId === undefined ? { projectId: section.projectId } : {}),
    }));
}

function validateAndSchedule(
  draft: TaskEditorDraft,
  context: TaskEditorAdapterContext,
): TaskEditorAdapterResult<
  TaskEditorDraft & {
    due: TaskDue | null;
  }
> {
  const base = validateTaskEditorDraft(draft);
  if (!base.valid) {
    return { ok: false, errors: base.errors };
  }

  const today = context.today ?? getToday();
  const schedule = parseSchedule(base.value, today);
  if (!schedule.ok) {
    return schedule;
  }

  return {
    ok: true,
    value: {
      ...normalizeTaskEditorDraft(base.value),
      due: schedule.value,
    },
  };
}

function parseSchedule(
  draft: TaskEditorDraft,
  today: LocalDate,
): TaskEditorAdapterResult<TaskDue | null> {
  const dueInput = draft.dueText.trim();
  const recurrenceInput = draft.recurrenceText.trim();
  const parsedDue = dueInput
    ? parseDateExpression(dueInput, today)
    : undefined;
  const explicitRecurrence = recurrenceInput
    ? parseRecurrence(recurrenceInput)
    : undefined;

  if (dueInput && !parsedDue) {
    return {
      ok: false,
      errors: {
        dueText: 'Use a supported date such as tomorrow or 2026-08-15.',
      },
    };
  }

  if (recurrenceInput && !explicitRecurrence) {
    return {
      ok: false,
      errors: {
        recurrenceText: 'Use a recurrence such as every week or every! 2 days.',
      },
    };
  }

  const inlineRecurrence = parsedDue?.recurrence;
  const recurrence = explicitRecurrence ?? inlineRecurrence;
  const date = parsedDue?.date ?? (recurrence ? today : undefined);

  if (!date) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      date,
      time: parsedDue?.time ?? null,
      timezone: null,
      recurrence: recurrence?.text ?? null,
    },
  };
}

function formatDueText(due: TaskDue): string {
  if (!due.time) {
    return due.date;
  }

  const [hourText, minuteText = '00'] = due.time.split(':');
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return due.date;
  }

  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 || 12;
  return `${due.date} at ${hour12}:${minuteText} ${suffix}`;
}

function getToday(): LocalDate {
  return new Date().toISOString().slice(0, 10);
}
