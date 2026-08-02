import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  NavigationIcon,
  destinationEquals,
  getNavigationGlobalKeyAction,
  getNavigationKeyboardAction,
  getNavigationRows,
  getVisibleProjects,
  hasProjectChildren,
} from '../features/navigation'
import type {
  NavigationDestination,
  NavigationGroupId,
  NavigationProject,
  NavigationRowDescriptor,
  NavigationView,
  SidebarProps,
} from '../features/navigation'

import './Sidebar.css'

type ExpandedGroups = Record<NavigationGroupId, boolean>

const defaultGroups: ExpandedGroups = {
  favorites: true,
  projects: true,
  filters: true,
  labels: true,
}

const viewIcon = (view: NavigationView) => {
  if (view.icon) return view.icon
  if (view.id === 'inbox') return 'inbox'
  if (view.id === 'today') return 'today'
  if (view.id === 'upcoming') return 'upcoming'
  return 'layers'
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

const destinationFromRow = (row: NavigationRowDescriptor) => row.destination ?? null

const mergeClassNames = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(' ')

interface NavigationRowProps {
  row: NavigationRowDescriptor
  selected: boolean
  focused: boolean
  hasChildren?: boolean
  icon?: ReactNode
  onFocus: (rowId: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: NavigationRowDescriptor) => void
  onSelect: (row: NavigationRowDescriptor) => void
  onToggle?: (row: NavigationRowDescriptor) => void
  onOpenMenu?: (
    destination: NavigationDestination,
    event: MouseEvent<HTMLButtonElement>,
  ) => void
  onContextMenu?: (
    destination: NavigationDestination,
    event: MouseEvent<HTMLDivElement>,
  ) => void
}

function NavigationRow({
  row,
  selected,
  focused,
  hasChildren = false,
  icon,
  onFocus,
  onKeyDown,
  onSelect,
  onToggle,
  onOpenMenu,
  onContextMenu,
}: NavigationRowProps) {
  const destination = destinationFromRow(row)
  const isGroup = row.kind === 'group'
  const label = isGroup
    ? row.label
    : destination
      ? `Open ${row.label}`
      : row.label

  return (
    <div
      className={mergeClassNames(
        'app-sidebar__row',
        selected && 'app-sidebar__row--selected',
        focused && 'app-sidebar__row--focused',
        isGroup && 'app-sidebar__row--group',
      )}
      data-navigation-row={row.rowId}
      role="treeitem"
      aria-level={row.depth === undefined ? undefined : row.depth + 1}
      aria-selected={selected || undefined}
      aria-expanded={row.expanded === undefined ? undefined : row.expanded}
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocus(row.rowId)}
      onKeyDown={(event) => onKeyDown(event, row)}
      onClick={() => onSelect(row)}
      onContextMenu={(event) => {
        if (destination && row.kind !== 'view' && onContextMenu) {
          event.preventDefault()
          onContextMenu(destination, event)
        }
      }}
      style={{
        paddingLeft: `${10 + (row.depth ?? 0) * 18}px`,
      }}
    >
      {row.kind === 'group' || hasChildren ? (
        <button
          type="button"
          className="app-sidebar__disclosure"
          tabIndex={-1}
          aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle?.(row)
          }}
        >
          <NavigationIcon
            name="chevron"
            className={mergeClassNames(
              'app-sidebar__chevron',
              row.expanded && 'app-sidebar__chevron--expanded',
            )}
            width={15}
            height={15}
          />
        </button>
      ) : (
        <span className="app-sidebar__disclosure-spacer" aria-hidden="true" />
      )}

      <span className="app-sidebar__row-main">
        {icon ? <span className="app-sidebar__row-icon">{icon}</span> : null}
        {row.color ? (
          <span
            className="app-sidebar__color-dot"
            style={{ backgroundColor: row.color }}
            aria-hidden="true"
          />
        ) : null}
        <span className="app-sidebar__row-label">{row.label}</span>
      </span>

      <span
        className="app-sidebar__count"
        aria-label={typeof row.count === 'number' ? `${row.count} open tasks` : undefined}
        aria-hidden={typeof row.count !== 'number' ? true : undefined}
      >
        {typeof row.count === 'number' ? row.count : ''}
      </span>

      {destination && row.kind !== 'view' ? (
        <button
          type="button"
          className="app-sidebar__more"
          tabIndex={-1}
          aria-label={`Open ${row.label} menu`}
          title={`Open ${row.label} menu`}
          onClick={(event) => {
            event.stopPropagation()
            onOpenMenu?.(destination, event)
          }}
        >
          <NavigationIcon name="more" width={16} height={16} />
        </button>
      ) : null}
    </div>
  )
}

export function Sidebar({
  views,
  projects,
  labels = [],
  filters = [],
  selectedDestination = null,
  defaultExpandedGroups,
  defaultExpandedProjectIds,
  expandedGroups: controlledExpandedGroups,
  expandedProjectIds: controlledExpandedProjectIds,
  title = 'Workspace',
  subtitle,
  className,
  footer,
  onSelect,
  onToggleGroup,
  onToggleProject,
  onAdd,
  onContextMenu,
  onOpenMenu,
  onSearch,
  onQuickFind,
  onQuickAdd,
  onToggleSidebar,
}: SidebarProps) {
  const projectIdsWithChildren = useMemo(
    () =>
      projects
        .filter((project) => hasProjectChildren(projects, project.id))
        .map((project) => project.id),
    [projects],
  )
  const [localExpandedGroups, setLocalExpandedGroups] = useState<ExpandedGroups>({
    ...defaultGroups,
    ...defaultExpandedGroups,
  })
  const [localExpandedProjectIds, setLocalExpandedProjectIds] = useState<Set<string>>(
    () => new Set(defaultExpandedProjectIds ?? projectIdsWithChildren),
  )
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  const expandedGroups: ExpandedGroups = {
    ...defaultGroups,
    ...localExpandedGroups,
    ...controlledExpandedGroups,
  }
  const expandedProjectIds = new Set(
    controlledExpandedProjectIds ?? Array.from(localExpandedProjectIds),
  )
  const visibleProjects = useMemo(
    () => getVisibleProjects(projects, expandedProjectIds),
    [expandedProjectIds, projects],
  )
  const navigationRows = useMemo(
    () =>
      getNavigationRows({
        views,
        projects,
        labels,
        filters,
        visibleProjects,
        expandedGroups,
        expandedProjectIds,
      }),
    [expandedGroups, expandedProjectIds, filters, labels, projects, views, visibleProjects],
  )

  useEffect(() => {
    if (!focusedRowId || navigationRows.some((row) => row.rowId === focusedRowId)) return
    setFocusedRowId(navigationRows[0]?.rowId ?? null)
  }, [focusedRowId, navigationRows])

  useEffect(() => {
    if (focusedRowId) return
    const selectedRow = selectedDestination
      ? navigationRows.find((row) =>
          destinationEquals(row.destination, selectedDestination),
        )
      : null
    setFocusedRowId(selectedRow?.rowId ?? navigationRows[0]?.rowId ?? null)
  }, [focusedRowId, navigationRows, selectedDestination])

  const focusRow = useCallback(
    (rowId: string) => {
      setFocusedRowId(rowId)
      requestAnimationFrame(() => rowRefs.current.get(rowId)?.focus())
    },
    [],
  )

  const toggleGroup = useCallback(
    (group: NavigationGroupId) => {
      const expanded = !expandedGroups[group]
      if (!controlledExpandedGroups) {
        setLocalExpandedGroups((current) => ({ ...current, [group]: expanded }))
      }
      onToggleGroup?.(group, expanded)
    },
    [controlledExpandedGroups, expandedGroups, onToggleGroup],
  )

  const toggleProject = useCallback(
    (projectId: string) => {
      const expanded = !expandedProjectIds.has(projectId)
      if (!controlledExpandedProjectIds) {
        setLocalExpandedProjectIds((current) => {
          const next = new Set(current)
          if (expanded) next.add(projectId)
          else next.delete(projectId)
          return next
        })
      }
      onToggleProject?.(projectId, expanded)
    },
    [controlledExpandedProjectIds, expandedProjectIds, onToggleProject],
  )

  const selectRow = useCallback(
    (row: NavigationRowDescriptor) => {
      if (row.kind === 'group') {
        toggleGroup(row.rowId.replace('group:', '') as NavigationGroupId)
        return
      }
      if (row.destination) {
        onSelect(row.destination)
      }
    },
    [onSelect, toggleGroup],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: NavigationRowDescriptor) => {
      if (isEditableTarget(event.target)) return

      const action = getNavigationKeyboardAction({
        key: event.key,
        row,
        rows: navigationRows,
        projects,
        editableTarget: false,
      })

      if (action.type === 'none') return
      event.preventDefault()

      if (action.type === 'select') {
        onSelect(action.destination)
      } else if (action.type === 'focus') {
        focusRow(action.rowId)
      } else if (action.type === 'toggle-group') {
        toggleGroup(action.groupId as NavigationGroupId)
      } else if (action.type === 'toggle-project') {
        toggleProject(action.projectId)
      }
    },
    [
      focusRow,
      navigationRows,
      projects,
      selectRow,
      toggleGroup,
      toggleProject,
    ],
  )

  const renderRow = (row: NavigationRowDescriptor) => {
    const destination = destinationFromRow(row)
    const selected = Boolean(destination && destinationEquals(destination, selectedDestination))
    const icon =
      row.kind === 'group' ? (
        <NavigationIcon
          name={
            row.rowId === 'group:projects'
              ? 'folder'
              : row.rowId === 'group:filters'
                ? 'filter'
                : row.rowId === 'group:labels'
                  ? 'tag'
                  : 'star'
          }
          width={17}
          height={17}
        />
      ) : row.kind === 'project' ? (
        <NavigationIcon name="folder" width={17} height={17} />
      ) : row.kind === 'label' ? (
        <NavigationIcon name="tag" width={17} height={17} />
      ) : row.kind === 'filter' ? (
        <NavigationIcon name="filter" width={17} height={17} />
      ) : (
        <NavigationIcon
          name={viewIcon(views.find((view) => view.id === row.destination?.id) ?? { id: '', label: '' })}
          width={17}
          height={17}
        />
      )

    return (
      <div
        key={row.rowId}
        ref={(element) => {
          if (element) rowRefs.current.set(row.rowId, element)
          else rowRefs.current.delete(row.rowId)
        }}
      >
        <NavigationRow
          row={row}
          selected={selected}
          focused={focusedRowId === row.rowId}
          hasChildren={
            row.kind === 'project' && row.destination
              ? hasProjectChildren(projects, row.destination.id)
              : false
          }
          icon={icon}
          onFocus={setFocusedRowId}
          onKeyDown={handleKeyDown}
          onSelect={selectRow}
          onToggle={(currentRow) => {
            if (currentRow.kind === 'group') {
              toggleGroup(currentRow.rowId.replace('group:', '') as NavigationGroupId)
            } else if (currentRow.destination) {
              toggleProject(currentRow.destination.id)
            }
          }}
          onOpenMenu={onOpenMenu}
          onContextMenu={onContextMenu}
        />
      </div>
    )
  }

  return (
    <aside className={mergeClassNames('app-sidebar', className)} aria-label={`${title} navigation`}>
      <div className="app-sidebar__topbar">
        <div className="app-sidebar__identity">
          <span className="app-sidebar__identity-mark" aria-hidden="true">
            <NavigationIcon name="spark" width={17} height={17} />
          </span>
          <span className="app-sidebar__identity-copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </span>
        </div>
        <button
          type="button"
          className="app-sidebar__icon-button"
          aria-label="Close navigation"
          title="Close navigation"
          onClick={onToggleSidebar}
        >
          <NavigationIcon name="chevron" width={17} height={17} className="app-sidebar__close-icon" />
        </button>
      </div>

      <div className="app-sidebar__actions">
        <button
          type="button"
          className="app-sidebar__quick-add"
          onClick={onQuickAdd}
          disabled={!onQuickAdd}
        >
          <span className="app-sidebar__quick-add-icon">
            <NavigationIcon name="plus" width={17} height={17} />
          </span>
          <span>Quick add</span>
          <kbd>Q</kbd>
        </button>
        <div className="app-sidebar__utility-actions">
          <button
            type="button"
            className="app-sidebar__utility-button"
            onClick={onSearch}
            disabled={!onSearch}
          >
            <NavigationIcon name="search" width={16} height={16} />
            <span>Search</span>
            <kbd>/</kbd>
          </button>
          <button
            type="button"
            className="app-sidebar__utility-button"
            onClick={onQuickFind}
            disabled={!onQuickFind}
          >
            <NavigationIcon name="command" width={16} height={16} />
            <span>Quick find</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
      </div>

      <div
        className="app-sidebar__tree"
        role="tree"
        aria-label="Workspace views and projects"
        onKeyDown={(event) => {
          if (isEditableTarget(event.target)) return
          const action = getNavigationGlobalKeyAction(event.key)
          if (action.type === 'toggle-sidebar') {
            event.preventDefault()
            onToggleSidebar?.()
          }
        }}
      >
        <div className="app-sidebar__section-label">Views</div>
        {navigationRows.slice(0, views.length).map(renderRow)}
        {navigationRows.slice(views.length).map(renderRow)}
        {onAdd ? (
          <div className="app-sidebar__add-actions">
            <button type="button" onClick={() => onAdd('projects')}>
              <NavigationIcon name="plus" width={15} height={15} />
              New project
            </button>
            <button type="button" onClick={() => onAdd('labels')}>
              <NavigationIcon name="plus" width={15} height={15} />
              New label
            </button>
            <button type="button" onClick={() => onAdd('filters')}>
              <NavigationIcon name="plus" width={15} height={15} />
              New filter
            </button>
          </div>
        ) : null}
      </div>

      {footer ? <div className="app-sidebar__footer">{footer}</div> : null}
    </aside>
  )
}
