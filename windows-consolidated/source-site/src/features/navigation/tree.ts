import type {
  NavigationDestination,
  NavigationFilter,
  NavigationLabel,
  NavigationProject,
  NavigationRowDescriptor,
} from './types'

export interface VisibleProject extends NavigationProject {
  depth: number
  rowId: string
}

const byOrder = <T extends { order?: number }>(left: T, right: T) =>
  (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)

export const destinationEquals = (
  left: NavigationDestination | null | undefined,
  right: NavigationDestination | null | undefined,
) => Boolean(left && right && left.kind === right.kind && left.id === right.id)

export const destinationRowId = (destination: NavigationDestination) =>
  `${destination.kind}:${destination.id}`

export const getVisibleProjects = (
  projects: readonly NavigationProject[],
  expandedProjectIds: ReadonlySet<string>,
) => {
  const activeProjects = projects.filter((project) => !project.archived)
  const childrenByParent = new Map<string | null, NavigationProject[]>()

  for (const project of activeProjects) {
    const parentId = project.parentId ?? null
    const children = childrenByParent.get(parentId) ?? []
    children.push(project)
    childrenByParent.set(parentId, children)
  }

  for (const children of childrenByParent.values()) {
    children.sort(byOrder)
  }

  const visible: VisibleProject[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const project of childrenByParent.get(parentId) ?? []) {
      visible.push({
        ...project,
        depth,
        rowId: `project:${project.id}`,
      })

      if (expandedProjectIds.has(project.id)) {
        visit(project.id, depth + 1)
      }
    }
  }

  visit(null, 0)
  return visible
}

export const hasProjectChildren = (
  projects: readonly NavigationProject[],
  projectId: string,
) => projects.some((project) => !project.archived && project.parentId === projectId)

export const getProjectParentId = (
  projects: readonly NavigationProject[],
  projectId: string,
) => projects.find((project) => project.id === projectId)?.parentId ?? null

export const getFavoriteRows = (
  projects: readonly NavigationProject[],
  labels: readonly NavigationLabel[],
  filters: readonly NavigationFilter[],
) => ({
  projects: projects
    .filter((project) => project.favorite && !project.archived)
    .sort(byOrder),
  labels: labels.filter((label) => label.favorite).sort(byOrder),
  filters: filters.filter((filter) => filter.favorite).sort(byOrder),
})

export const getNavigationRows = ({
  views,
  projects,
  labels,
  filters,
  visibleProjects,
  expandedGroups,
  expandedProjectIds,
}: {
  views: readonly { id: string; label: string; count?: number }[]
  projects: readonly NavigationProject[]
  labels: readonly NavigationLabel[]
  filters: readonly NavigationFilter[]
  visibleProjects: readonly VisibleProject[]
  expandedGroups: Readonly<Record<string, boolean>>
  expandedProjectIds: ReadonlySet<string>
}) => {
  const rows: NavigationRowDescriptor[] = views.map((view) => ({
    rowId: `view:${view.id}`,
    label: view.label,
    kind: 'view',
    destination: { kind: 'view', id: view.id },
    count: view.count,
  }))

  const favorites = getFavoriteRows(projects, labels, filters)
  if (favorites.projects.length || favorites.labels.length || favorites.filters.length) {
    rows.push({
      rowId: 'group:favorites',
      label: 'Favorites',
      kind: 'group',
      expanded: expandedGroups.favorites,
    })

    if (expandedGroups.favorites) {
      for (const project of favorites.projects) {
        rows.push({
          rowId: `favorite:project:${project.id}`,
          label: project.name,
          kind: 'project',
          destination: { kind: 'project', id: project.id },
          parentRowId: 'group:favorites',
          depth: 0,
          count: project.count,
          color: project.color,
        })
      }

      for (const label of favorites.labels) {
        rows.push({
          rowId: `favorite:label:${label.id}`,
          label: label.name,
          kind: 'label',
          destination: { kind: 'label', id: label.id },
          parentRowId: 'group:favorites',
          count: label.count,
          color: label.color,
        })
      }

      for (const filter of favorites.filters) {
        rows.push({
          rowId: `favorite:filter:${filter.id}`,
          label: filter.name,
          kind: 'filter',
          destination: { kind: 'filter', id: filter.id },
          parentRowId: 'group:favorites',
          count: filter.count,
          color: filter.color,
        })
      }
    }
  }

  rows.push({
    rowId: 'group:projects',
    label: 'Projects',
    kind: 'group',
    expanded: expandedGroups.projects,
  })

  if (expandedGroups.projects) {
    for (const project of visibleProjects) {
      const parentId = project.parentId ? `project:${project.parentId}` : 'group:projects'
      rows.push({
        rowId: project.rowId,
        label: project.name,
        kind: 'project',
        destination: { kind: 'project', id: project.id },
        parentRowId: parentId,
        depth: project.depth,
        count: project.count,
        color: project.color,
        expanded: expandedProjectIds.has(project.id),
      })
    }
  }

  rows.push({
    rowId: 'group:filters',
    label: 'Filters',
    kind: 'group',
    expanded: expandedGroups.filters,
  })

  if (expandedGroups.filters) {
    for (const filter of filters.filter((item) => !item.favorite).sort(byOrder)) {
      rows.push({
        rowId: `filter:${filter.id}`,
        label: filter.name,
        kind: 'filter',
        destination: { kind: 'filter', id: filter.id },
        parentRowId: 'group:filters',
        count: filter.count,
        color: filter.color,
      })
    }
  }

  rows.push({
    rowId: 'group:labels',
    label: 'Labels',
    kind: 'group',
    expanded: expandedGroups.labels,
  })

  if (expandedGroups.labels) {
    for (const label of labels.filter((item) => !item.favorite).sort(byOrder)) {
      rows.push({
        rowId: `label:${label.id}`,
        label: label.name,
        kind: 'label',
        destination: { kind: 'label', id: label.id },
        parentRowId: 'group:labels',
        count: label.count,
        color: label.color,
      })
    }
  }

  return rows
}
