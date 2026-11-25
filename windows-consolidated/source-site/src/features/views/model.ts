import type { ProjectSection, ProjectTask } from "../projects/types";

export interface SectionTaskBucket {
  section: ProjectSection;
  tasks: ProjectTask[];
}

export function sortSections(sections: readonly ProjectSection[]) {
  return [...sections].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function groupTasksBySection(
  sections: readonly ProjectSection[],
  tasks: readonly ProjectTask[],
  showCompleted = true,
) {
  const orderedSections = sortSections(sections);
  const buckets = new Map<string, SectionTaskBucket>();

  for (const section of orderedSections) {
    buckets.set(section.id, { section, tasks: [] });
  }

  const unsectioned: ProjectTask[] = [];
  for (const task of tasks) {
    if (!showCompleted && task.completedAt !== null) {
      continue;
    }

    const bucket = task.sectionId ? buckets.get(task.sectionId) : undefined;
    if (bucket) {
      bucket.tasks.push(task);
    } else {
      unsectioned.push(task);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.tasks.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }
  unsectioned.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return {
    buckets: orderedSections.map((section) => buckets.get(section.id) as SectionTaskBucket),
    unsectioned,
  };
}

export function countOpenTasks(tasks: readonly ProjectTask[]) {
  return tasks.reduce((count, task) => count + (task.completedAt === null ? 1 : 0), 0);
}
