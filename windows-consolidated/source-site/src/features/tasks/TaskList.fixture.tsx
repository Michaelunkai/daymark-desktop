import { useState } from 'react';

import { TaskList, type TaskListSection } from './TaskList';
import type { TaskDueTone, TaskRowLabel, TaskRowTask } from './TaskRow';

export interface TaskListFixtureSourceTask {
  id: string;
  title: string;
  completed?: boolean;
  priority?: 1 | 2 | 3 | 4;
  dueLabel?: string;
  dueTone?: TaskDueTone;
  labels?: readonly string[];
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
}

export function toTaskListRowTask(source: TaskListFixtureSourceTask): TaskRowTask {
  return {
    id: source.id,
    content: source.title,
    completedAt: source.completed ? '2026-08-02T10:00:00.000Z' : null,
    depth: source.depth,
    hasChildren: source.hasChildren,
    isExpanded: source.isExpanded,
    labelIds: source.labels?.map((label) => `fixture-label-${label.toLowerCase()}`) ?? [],
    priority: source.priority ?? 4,
    due: source.dueLabel
      ? {
          date: source.dueLabel,
          recurrence: null,
          time: null,
          timezone: null,
        }
      : null,
  };
}

export function createTaskListFixtureSections(): TaskListSection[] {
  const sourceTasks: readonly TaskListFixtureSourceTask[] = [
    {
      id: 'fixture-report',
      title: 'Finish the quarterly report',
      completed: false,
      dueLabel: 'Today, 10:00 AM',
      dueTone: 'today',
      labels: ['Focus'],
      priority: 1,
    },
    {
      id: 'fixture-milestones',
      title: 'Confirm the release milestones',
      completed: false,
      dueLabel: 'Tomorrow',
      dueTone: 'tomorrow',
      hasChildren: true,
      isExpanded: true,
      labels: ['Launch'],
      priority: 2,
    },
    {
      id: 'fixture-notes',
      title: 'Review handoff notes',
      completed: true,
      dueLabel: 'Aug 8',
      dueTone: 'upcoming',
      depth: 1,
      labels: ['Reference'],
      priority: 4,
    },
    {
      id: 'fixture-groceries',
      title: 'Buy groceries',
      completed: false,
      dueLabel: 'Overdue',
      dueTone: 'overdue',
      labels: ['Home'],
      priority: 3,
    },
  ];

  return [
    {
      id: 'fixture-focus',
      title: 'Focus lane',
      tasks: sourceTasks.slice(0, 3).map(toTaskListRowTask),
    },
    {
      id: 'fixture-other',
      title: 'Other tasks',
      tasks: sourceTasks.slice(3).map(toTaskListRowTask),
    },
  ];
}

const FIXTURE_LABELS: readonly TaskRowLabel[] = [
  { id: 'fixture-label-focus', name: 'Focus', color: '#c44536' },
  { id: 'fixture-label-launch', name: 'Launch', color: '#4f7db8' },
  { id: 'fixture-label-reference', name: 'Reference', color: '#775ea6' },
  { id: 'fixture-label-home', name: 'Home', color: '#c97828' },
];

/**
 * Controlled fixture for the W01 shell. The shell should supply sections and
 * own all callbacks; this local state only makes the fixture interactive.
 */
export function TaskListFixture() {
  const [sections, setSections] = useState(createTaskListFixtureSections);

  const updateTask = (
    taskId: string,
    update: (task: TaskRowTask) => TaskRowTask,
  ) => {
    setSections((current) =>
      current.map((section) => ({
        ...section,
        tasks: section.tasks.map((task) => (task.id === taskId ? update(task) : task)),
      })),
    );
  };

  return (
    <TaskList
      ariaLabel="Task-list component fixture"
      density="compact"
      labels={FIXTURE_LABELS}
      onAddTask={(sectionId) => {
        setSections((current) =>
          current.map((section) =>
            section.id === sectionId
              ? {
                  ...section,
                  tasks: [
                    ...section.tasks,
                    {
                      content: 'New fixture task',
                      completedAt: null,
                      id: `fixture-new-${Date.now()}`,
                      labelIds: [],
                      priority: 4,
                      due: null,
                    },
                  ],
                }
              : section,
          ),
        );
      }}
      onSectionToggle={(sectionId, expanded) => {
        setSections((current) =>
          current.map((section) =>
            section.id === sectionId ? { ...section, isCollapsed: !expanded } : section,
          ),
        );
      }}
      onTaskComplete={(taskId, nextCompleted) => {
        updateTask(taskId, (task) => ({ ...task, completed: nextCompleted }));
      }}
      onTaskMenu={() => undefined}
      onTaskOpen={() => undefined}
      onTaskToggleExpand={(taskId, expanded) => {
        updateTask(taskId, (task) => ({ ...task, isExpanded: expanded }));
      }}
      onTaskReorderStart={() => undefined}
      sections={sections}
    />
  );
}
