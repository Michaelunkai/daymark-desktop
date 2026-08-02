import type { MouseEvent, ReactNode } from 'react'

export type NavigationDestinationKind =
  | 'view'
  | 'project'
  | 'label'
  | 'filter'

export type NavigationGroupId =
  | 'favorites'
  | 'projects'
  | 'filters'
  | 'labels'

export interface NavigationDestination {
  kind: NavigationDestinationKind
  id: string
}

export interface NavigationView {
  id: string
  label: string
  icon?: NavigationIconName
  count?: number
  shortcut?: string
}

export interface NavigationProject {
  id: string
  name: string
  parentId?: string | null
  color?: string
  count?: number
  favorite?: boolean
  archived?: boolean
  order?: number
}

export interface NavigationLabel {
  id: string
  name: string
  color?: string
  count?: number
  favorite?: boolean
  order?: number
}

export interface NavigationFilter {
  id: string
  name: string
  color?: string
  count?: number
  favorite?: boolean
  order?: number
}

export type NavigationIconName =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'layers'
  | 'search'
  | 'command'
  | 'folder'
  | 'tag'
  | 'filter'
  | 'star'
  | 'plus'
  | 'chevron'
  | 'more'
  | 'spark'

export interface NavigationRowDescriptor {
  rowId: string
  label: string
  kind: NavigationDestinationKind | 'group'
  destination?: NavigationDestination
  parentRowId?: string
  depth?: number
  count?: number
  color?: string
  expanded?: boolean
}

export interface SidebarProps {
  views: readonly NavigationView[]
  projects: readonly NavigationProject[]
  labels?: readonly NavigationLabel[]
  filters?: readonly NavigationFilter[]
  selectedDestination?: NavigationDestination | null
  defaultExpandedGroups?: Partial<Record<NavigationGroupId, boolean>>
  defaultExpandedProjectIds?: readonly string[]
  expandedGroups?: Partial<Record<NavigationGroupId, boolean>>
  expandedProjectIds?: readonly string[]
  title?: string
  subtitle?: string
  className?: string
  footer?: ReactNode
  onSelect: (destination: NavigationDestination) => void
  onToggleGroup?: (group: NavigationGroupId, expanded: boolean) => void
  onToggleProject?: (projectId: string, expanded: boolean) => void
  onAdd?: (group: Extract<NavigationGroupId, 'projects' | 'filters' | 'labels'>) => void
  onContextMenu?: (
    destination: NavigationDestination,
    event: MouseEvent<HTMLDivElement>,
  ) => void
  onOpenMenu?: (
    destination: NavigationDestination,
    event: MouseEvent<HTMLButtonElement>,
  ) => void
  onSearch?: () => void
  onQuickFind?: () => void
  onQuickAdd?: () => void
  onToggleSidebar?: () => void
}
