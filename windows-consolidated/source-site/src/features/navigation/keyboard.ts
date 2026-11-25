import type {
  NavigationDestination,
  NavigationProject,
  NavigationRowDescriptor,
} from './types'
import { getProjectParentId, hasProjectChildren } from './tree'

export type NavigationKeyboardAction =
  | { type: 'select'; destination: NavigationDestination }
  | { type: 'focus'; rowId: string }
  | { type: 'toggle-group'; groupId: string }
  | { type: 'toggle-project'; projectId: string }
  | { type: 'toggle-sidebar' }
  | { type: 'none' }

interface NavigationKeyboardInput {
  key: string
  row: NavigationRowDescriptor
  rows: readonly NavigationRowDescriptor[]
  projects: readonly NavigationProject[]
  editableTarget?: boolean
}

export const getNavigationKeyboardAction = ({
  key,
  row,
  rows,
  projects,
  editableTarget = false,
}: NavigationKeyboardInput): NavigationKeyboardAction => {
  if (editableTarget) return { type: 'none' }

  if (key === 'Enter' || key === ' ') {
    if (row.kind === 'group') {
      return {
        type: 'toggle-group',
        groupId: row.rowId.replace('group:', ''),
      }
    }
    return row.destination
      ? { type: 'select', destination: row.destination }
      : { type: 'none' }
  }

  const currentIndex = rows.findIndex((item) => item.rowId === row.rowId)
  if (currentIndex < 0) return { type: 'none' }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const direction = key === 'ArrowDown' ? 1 : -1
    const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + direction))
    return { type: 'focus', rowId: rows[nextIndex].rowId }
  }

  if (key === 'Home') return { type: 'focus', rowId: rows[0].rowId }
  if (key === 'End') return { type: 'focus', rowId: rows[rows.length - 1].rowId }

  if (key === 'ArrowRight') {
    if (row.kind === 'group' && row.expanded === false) {
      return {
        type: 'toggle-group',
        groupId: row.rowId.replace('group:', ''),
      }
    }
    if (
      row.kind === 'project' &&
      row.destination &&
      row.expanded === false &&
      hasProjectChildren(projects, row.destination.id)
    ) {
      return { type: 'toggle-project', projectId: row.destination.id }
    }
    return { type: 'none' }
  }

  if (key === 'ArrowLeft') {
    if (row.kind === 'group' && row.expanded) {
      return {
        type: 'toggle-group',
        groupId: row.rowId.replace('group:', ''),
      }
    }

    if (row.kind === 'project' && row.destination) {
      const parentId = getProjectParentId(projects, row.destination.id)
      if (row.expanded) {
        return { type: 'toggle-project', projectId: row.destination.id }
      }
      return {
        type: 'focus',
        rowId: parentId ? `project:${parentId}` : 'group:projects',
      }
    }
  }

  return { type: 'none' }
}

export const getNavigationGlobalKeyAction = (
  key: string,
  editableTarget = false,
): NavigationKeyboardAction =>
  !editableTarget && key.toLowerCase() === 'm'
    ? { type: 'toggle-sidebar' }
    : { type: 'none' }
