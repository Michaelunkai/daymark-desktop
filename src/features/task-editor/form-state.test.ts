import assert from 'node:assert/strict';
import test from 'node:test';

import type { Task } from '../../core/types';

import {
  createTaskEditorDraft,
  getOrderTransferDestinationError,
  getTaskTransferDestinationError,
  isTaskEditorDirty,
  normalizeTaskEditorDraft,
  updateTaskEditorDraft,
  validateTaskEditorDraft,
} from './form-state';
import {
  taskEditorDraftToOrderItemInput,
  taskEditorDraftToTaskInput,
  taskEditorDraftToTaskPatch,
  taskToTaskEditorDraft,
  toTaskEditorSectionOptions,
} from './adapters';

test('normalizes editor text', () => {
  const draft = createTaskEditorDraft({
    title: '  Plan the handoff  ',
    description: '  Include links  ',
  });

  assert.deepEqual(normalizeTaskEditorDraft(draft), {
    title: 'Plan the handoff',
    description: 'Include links',
    projectId: null,
    sectionId: null,
    priority: 4,
    dueText: '',
    recurrenceText: '',
    reminderText: '',
    orderLane: 'now',
    orderRelationId: null,
  });
});

test('requires a title and rejects a section without a project', () => {
  const result = validateTaskEditorDraft(
    createTaskEditorDraft({ sectionId: 'section-focus' }),
  );

  assert.equal(result.valid, false);
  assert.equal(result.errors.title, 'Add a task title before saving.');
  assert.equal(
    result.errors.sectionId,
    'Choose a project before selecting a section.',
  );
});

test('tracks meaningful draft changes after normalization', () => {
  const initial = createTaskEditorDraft({ title: 'Read brief' });
  const next = updateTaskEditorDraft(initial, 'title', '  Read brief  ');

  assert.equal(isTaskEditorDirty(initial, next), false);
  assert.equal(
    isTaskEditorDirty(initial, updateTaskEditorDraft(initial, 'priority', 1)),
    true,
  );
});

test('maps a core task to a parser-compatible editor draft', () => {
  const task: Task = {
    id: 'task-1',
    content: 'Send invoice',
    description: 'Attach the final receipt.',
    projectId: 'project-work',
    sectionId: 'section-finance',
    parentId: null,
    labelIds: ['label-admin'],
    priority: 2,
    due: {
      date: '2026-08-03',
      time: '16:30',
      timezone: null,
      recurrence: 'every week',
    },
    completedAt: null,
    order: 1,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  };

  assert.deepEqual(taskToTaskEditorDraft(task), {
    title: 'Send invoice',
    description: 'Attach the final receipt.',
    projectId: 'project-work',
    sectionId: 'section-finance',
    priority: 2,
    dueText: '2026-08-03 at 4:30 pm',
    recurrenceText: 'every week',
    reminderText: '',
    orderLane: 'now',
    orderRelationId: null,
  });
});

test('maps a valid draft to TaskInput with parsed date and recurrence', () => {
  const result = taskEditorDraftToTaskInput(
    createTaskEditorDraft({
      title: 'Review launch notes',
      projectId: null,
      dueText: 'tomorrow at 4 pm',
      recurrenceText: 'every! 2 weeks',
    }),
    { today: '2026-08-02', inboxProjectId: 'project-inbox' },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value.due, {
    date: '2026-08-03',
    time: '16:00',
    timezone: null,
    recurrence: 'every! 2 weeks',
  });
  assert.equal(result.value.projectId, 'project-inbox');
});

test('normalizes an Order destination relation for After transfers', () => {
  const draft = normalizeTaskEditorDraft(
    createTaskEditorDraft({
      title: 'Follow the handoff',
      orderLane: 'after',
      orderRelationId: 'order-previous',
    }),
  );

  assert.equal(draft.orderLane, 'after');
  assert.equal(draft.orderRelationId, 'order-previous');
});

test('requires an explicit project and section for every task destination', () => {
  assert.equal(
    getTaskTransferDestinationError({ projectId: '', sectionId: '' }),
    'Choose Inbox or a project before transferring.',
  );
  assert.equal(
    getTaskTransferDestinationError({
      projectId: '__inbox__',
      sectionId: '',
    }),
    'Choose a section or explicitly choose No section.',
  );
  assert.equal(
    getTaskTransferDestinationError({
      projectId: 'project-work',
      sectionId: '__none__',
    }),
    '',
  );
  assert.equal(
    getTaskTransferDestinationError({
      projectId: null,
      sectionId: null,
    }),
    '',
  );
});

test('requires only an explicit Order section for every Order destination', () => {
  assert.equal(
    getOrderTransferDestinationError({
      orderLane: '',
      orderRelationId: '',
    }),
    'Choose an Order section before transferring.',
  );
  assert.equal(
    getOrderTransferDestinationError({
      orderLane: 'after',
      orderRelationId: '',
    }),
    '',
  );
  assert.equal(
    getOrderTransferDestinationError({
      orderLane: 'later',
      orderRelationId: null,
    }),
    '',
  );
  assert.equal(
    getOrderTransferDestinationError({
      orderLane: 'after',
      orderRelationId: 'order-1',
    }),
    '',
  );
});

test('adapts a task for Order without depending on its schedule or task location', () => {
  const result = taskEditorDraftToOrderItemInput(
    createTaskEditorDraft({
      title: '  Sequence the research  ',
      description: '  Keep the useful notes.  ',
      projectId: null,
      sectionId: null,
      dueText: 'not a supported date',
      orderLane: 'later',
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value, {
    title: 'Sequence the research',
    details: 'Keep the useful notes.',
    lane: 'later',
    relationId: null,
    priority: 4,
    status: 'open',
  });
});

test('treats After as an Order section without creating an item relation', () => {
  const result = taskEditorDraftToOrderItemInput(
    createTaskEditorDraft({
      title: 'Continue after the current work',
      orderLane: 'after',
      orderRelationId: 'legacy-order-item',
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.lane, 'after');
  assert.equal(result.value.relationId, null);
});

test('returns field errors for unsupported schedule text', () => {
  const result = taskEditorDraftToTaskPatch(
    createTaskEditorDraft({
      title: 'Schedule review',
      dueText: 'sometime after lunch',
    }),
    { today: '2026-08-02' },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.dueText ?? '', /supported date/);
});

test('scopes section options to the selected project', () => {
  const options = toTaskEditorSectionOptions(
    [
      {
        id: 'section-work',
        projectId: 'project-work',
        name: 'Work',
        order: 2,
        isCollapsed: false,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'section-home',
        projectId: 'project-home',
        name: 'Home',
        order: 1,
        isCollapsed: false,
        createdAt: '',
        updatedAt: '',
      },
    ],
    'project-work',
  );

  assert.deepEqual(options, [{ id: 'section-work', label: 'Work' }]);
});
