# Daymark Upcoming Calendar Design System

## Concept scope

Desktop-first task planning surface for creating projects and organizing tasks by day. The reference image deliberately keeps the calendar as the primary work area, with project context at left and a scannable due-task agenda at right.

Reference artifact: `upcoming-calendar-concept.png`

## Layout

| Area | Role | Recommended width |
| --- | --- | --- |
| Left sidebar | Navigation, project selection, project creation entry point, account menu | 244px fixed |
| Main workspace | Calendar header and active calendar view | Flexible, min-width 720px |
| Right agenda | Upcoming grouped tasks and quick filtering | 304px fixed |

- App shell: `min-height: 100vh`; off-white workspace with an ink sidebar.
- Calendar header: title on the left, date navigation centered, view switcher and primary action aligned right.
- Calendar grid: seven equal columns and six stable week rows. Prevent task chips from changing row height.
- At desktop widths below the three-column minimum, collapse the right agenda before compressing the calendar cells.

## Tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--canvas` | `#F8F8F5` | Main workspace |
| `--surface` | `#FFFFFF` | Popover, agenda, elevated controls |
| `--ink` | `#101D2C` | Sidebar and primary text |
| `--text` | `#17212B` | Main labels and dates |
| `--muted` | `#6D747B` | Secondary labels |
| `--line` | `#E3E5E2` | Grid and separator lines |
| `--green` | `#18784E` | Task-day marker, selected date, primary action |
| `--green-soft` | `#E8F3EC` | Green task chip / selected-day wash |
| `--coral` | `#F47E71` | Engineering task/project |
| `--gold` | `#F5B80E` | Research/marketing task/project |
| `--blue` | `#4B98EC` | Secondary project category |
| `--violet` | `#8C73E8` | Operations project category |

Use no gradients. Keep category color in thin leading bars, compact chips, dots, and swatches; green is reserved for task presence, selection, and affirmative actions.

## Typography and geometry

- Use the product's existing sans-serif family. Fallback: `Inter, ui-sans-serif, system-ui, sans-serif`.
- Page title: 28px / 34px, 650 weight.
- Month title: 22px / 28px, 600 weight.
- Sidebar and control labels: 14px / 20px, 500 weight.
- Calendar date: 14px / 20px, 500 weight.
- Task chip: 13px / 18px, 500 weight.
- Base spacing unit: 8px.
- Sidebar row height: 48px. Toolbar controls: 38px. Icon buttons: 38px square.
- Corner radius: 6px for chips, fields, buttons, and popovers. Calendar cells remain square.
- Popover shadow: `0 14px 32px rgba(16, 29, 44, 0.18)`.

## Interaction model

### Calendar navigation

- Previous and next arrows move one interval in the current view.
- `Today` selects the device-local current day and changes the visible period if necessary.
- Month, Week, and Year are a single segmented control. Preserve the selected date while changing views.
- The selected day uses a filled green circular date marker. Dates containing one or more tasks show a green dot or short green underline, even when the cell is not selected.

### Projects

- The plus beside Projects opens the `New project` popover anchored to the sidebar.
- Popover fields: project name, one required color swatch, Create project. The primary button remains disabled until a non-whitespace name is entered.
- New projects should appear immediately in the project list and become available to task creation without a page reload.

### Tasks

- Task chips show title, project color, and optional drag handle on hover/focus.
- Add task defaults its date to the selected calendar day; task creation must also support explicit project, date, and time/untimed state.
- Dragging a task over a calendar day shows a dashed drop target and a low-opacity task ghost. Dropping updates the persisted due date and calendar markers.
- Opening a chip permits editing title, project, due day/time, notes, and completion. Moving or editing a task must immediately update the corresponding calendar cells and right agenda.

## Accessibility and responsive behavior

- All visual controls require text labels or accessible names; icon-only buttons need tooltips.
- Expose calendar cells as buttons with an accessible date and task count.
- Support keyboard navigation between days and moving a focused task to the selected date.
- Maintain visible focus rings using the green accent at a 3:1 contrast ratio or higher.
- Below 1120px, hide/collapse the right agenda into a toggleable panel. Below 860px, switch to a single-column compact calendar or day-list mode; do not render clipped month cells.

## Handoff for W09

Implement this as a responsive three-region app shell, with the central calendar as the owner of `selectedDate`, `visibleDate`, and `viewMode`. Treat task markers as a derived `tasksByDate` index so project creation, task edits, and drag/drop all refresh the calendar and agenda from one persisted task source.

Visual evidence was generated with the built-in image generator and copied unchanged to the reference artifact.
