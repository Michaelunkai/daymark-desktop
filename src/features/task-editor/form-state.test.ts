import assert from 'node:assert/strict';
import test from 'node:test';

import type { Task } from '../../core/types';

import {
  createTaskEditorDraft,
  isTaskEditorDirty,
  normalizeTaskEditorDraft,
  updateTaskEditorDraft,
  validateTaskEditorDraft,
} from './form-state';
import {
  taskEditorDraftToTaskInput,
  taskEditorDraftToTaskPatch,
  taskToTaskEditorDraft,
  toTaskEditorSectionOptions,
} from './adapters';

test('normalizes editor text and de-duplicates labels', () => {
  const draft = createTaskEditorDraft({
    title: '  Plan the handoff  ',
    description: '  Include links  ',
    labelIds: ['label-focus', 'label-focus', 'label-next'],
  });

  assert.deepEqual(normalizeTaskEditorDraft(draft), {
    title: 'Plan the handoff',
    description: 'Include links',
    projectId: null,
    sectionId: null,
    labelIds: ['label-focus', 'label-next'],
    priority: 4,
    dueText: '',
    recurrenceText: '',
    reminderText: '',
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
    labelIds: ['label-admin'],
    priority: 2,
    dueText: '2026-08-03 at 4:30 pm',
    recurrenceText: 'every week',
    reminderText: '',
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
