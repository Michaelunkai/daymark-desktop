import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ForwardedRef,
  type KeyboardEvent,
  type MutableRefObject,
} from "react"
import {
  addDays,
  formatDate,
  fromLocalDate,
  toLocalDate,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"
import {
  CalendarTaskEditor,
  type CalendarTaskDraft,
} from "./CalendarTaskEditor"
import {
  createCalendarTaskDragPayload,
  calendarRange,
  dayDensity,
  navigateDate,
  parseCalendarTaskDragPayload,
  type CalendarDayDensity,
} from "./calendar-task-adapters"

export type UpcomingCalendarMode = "week" | "month" | "year"

export type UpcomingCalendarTask = {
  id: string
  title: string
  dueDate: LocalDate
  completed?: boolean
  projectName?: string
  projectColor?: string
}

export type UpcomingCalendarProps = {
  tasks: readonly UpcomingCalendarTask[]
  selectedDate?: LocalDate
  initialMode?: UpcomingCalendarMode
  today?: LocalDate
  weekStartsOn?: WeekStart
  onDateSelect?: (date: LocalDate) => void
  onTaskAdd?: (date: LocalDate) => void
  onTaskQuickAdd?: (date: LocalDate, title: string) => void
  onTaskEdit?: (taskId: string) => void
  onTaskMove?: (taskId: string, date: LocalDate) => void
}

const modes: readonly UpcomingCalendarMode[] = ["week", "month", "year"]
const dragMime = "application/x-daymark-calendar-task"

export function UpcomingCalendar({
  tasks,
  selectedDate,
  initialMode = "month",
  today = toLocalDate(new Date()),
  weekStartsOn = 0,
  onDateSelect,
  onTaskAdd,
  onTaskQuickAdd,
  onTaskEdit,
  onTaskMove,
}: UpcomingCalendarProps) {
  const initialDate = selectedDate ?? today
  const [mode, setMode] = useState<UpcomingCalendarMode>(initialMode)
  const [cursor, setCursor] = useState<LocalDate>(initialDate)
  const [focusedDate, setFocusedDate] = useState<LocalDate>(initialDate)
  const [quickAddDate, setQuickAddDate] = useState<LocalDate>()
  const [draggingTaskId, setDraggingTaskId] = useState<string>()
  const dayButtonRefs = useRef(new Map<LocalDate, HTMLButtonElement>())

  useEffect(() => {
    if (!selectedDate) return
    setCursor(selectedDate)
    setFocusedDate(selectedDate)
  }, [selectedDate])

  const tasksByDate = useMemo(() => {
    const grouped = new Map<LocalDate, UpcomingCalendarTask[]>()
    for (const task of tasks) {
      const scheduled = grouped.get(task.dueDate) ?? []
      scheduled.push(task)
      grouped.set(task.dueDate, scheduled)
    }
    grouped.forEach((scheduled) => {
      scheduled.sort((left, right) =>
        Number(left.completed) - Number(right.completed) || left.title.localeCompare(right.title),
      )
    })
    return grouped
  }, [tasks])

  const range = calendarRange(mode, cursor, weekStartsOn)
  const selected = selectedDate ?? cursor
  const heading = calendarHeading(mode, cursor)
  const selectedTasks = tasksByDate.get(selected) ?? []

  function selectDate(date: LocalDate, shouldFocus = false): void {
    setCursor(date)
    setFocusedDate(date)
    onDateSelect?.(date)
    if (shouldFocus) {
      requestAnimationFrame(() => dayButtonRefs.current.get(date)?.focus())
    }
  }

  function shift(amount: number): void {
    setCursor((date) => navigateDate(mode, date, amount))
  }

  function moveFocusedDate(event: KeyboardEvent<HTMLButtonElement>, date: LocalDate): void {
    const offsetByKey: Record<string, number | undefined> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const offset = offsetByKey[event.key]
    if (offset === undefined) return
    event.preventDefault()
    selectDate(addDays(date, offset), true)
  }

  function handleTaskKeyDown(event: KeyboardEvent<HTMLButtonElement>, task: UpcomingCalendarTask): void {
    if (!event.altKey) return
    const moves: Record<string, number | undefined> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const offset = moves[event.key]
    if (offset === undefined) return
    event.preventDefault()
    onTaskMove?.(task.id, addDays(task.dueDate, offset))
  }

  function handleDrop(event: DragEvent<HTMLElement>, date: LocalDate): void {
    event.preventDefault()
    const payload = parseCalendarTaskDragPayload(event.dataTransfer.getData(dragMime))
    if (!payload || payload.taskId !== draggingTaskId || payload.sourceDate === date) return
    onTaskMove?.(payload.taskId, date)
    setDraggingTaskId(undefined)
  }

  function submitQuickAdd(draft: CalendarTaskDraft): void {
    if (onTaskQuickAdd) {
      onTaskQuickAdd(draft.date, draft.title)
    } else {
      onTaskAdd?.(draft.date)
    }
    setQuickAddDate(undefined)
  }

  return (
    <section className="upcoming-calendar" aria-label="Upcoming calendar">
      <header className="upcoming-calendar__toolbar">
        <div className="upcoming-calendar__navigation">
          <button aria-label={`Previous ${mode}`} className="upcoming-calendar__nav-button" onClick={() => shift(-1)} type="button">
            &larr;
          </button>
          <button className="upcoming-calendar__today-button" onClick={() => selectDate(today)} type="button">Today</button>
          <button aria-label={`Next ${mode}`} className="upcoming-calendar__nav-button" onClick={() => shift(1)} type="button">
            &rarr;
          </button>
          <h2 className="upcoming-calendar__title" aria-live="polite">{heading}</h2>
        </div>
        <div className="upcoming-calendar__toolbar-actions">
          <div aria-label="Calendar view" className="upcoming-calendar__view-switcher" role="group">
            {modes.map((candidate) => (
              <button
                aria-pressed={mode === candidate}
                className="upcoming-calendar__view-button"
                key={candidate}
                onClick={() => setMode(candidate)}
                type="button"
              >
                {candidate[0].toUpperCase() + candidate.slice(1)}
              </button>
            ))}
          </div>
          <button className="upcoming-calendar__add-button" onClick={() => setQuickAddDate(selected)} type="button">
            <span aria-hidden="true">+</span>
            <span className="upcoming-calendar__add-button-label">Add task</span>
          </button>
        </div>
      </header>

      {quickAddDate ? (
        <CalendarTaskEditor
          date={quickAddDate}
          onCancel={() => setQuickAddDate(undefined)}
          onSubmit={submitQuickAdd}
        />
      ) : null}

      {mode === "year" ? (
        <YearView cursor={cursor} tasksByDate={tasksByDate} onMonthSelect={(date) => {
          setCursor(date)
          setFocusedDate(date)
          setMode("month")
        }} />
      ) : (
        <CalendarGrid
          dateRefs={dayButtonRefs}
          draggingTaskId={draggingTaskId}
          focusedDate={focusedDate}
          mode={mode}
          onAdd={(date) => setQuickAddDate(date)}
          onDateSelect={selectDate}
          onDayKeyDown={moveFocusedDate}
          onDrop={handleDrop}
          onDraggingTaskIdChange={setDraggingTaskId}
          onTaskEdit={onTaskEdit}
          onTaskKeyDown={handleTaskKeyDown}
          range={range}
          selectedDate={selected}
          tasksByDate={tasksByDate}
          today={today}
          visibleMonth={cursor.slice(0, 7)}
          weekStartsOn={weekStartsOn}
        />
      )}

      <SelectedDayAgenda
        date={selected}
        density={dayDensity(selectedTasks)}
        onAdd={() => setQuickAddDate(selected)}
        onEdit={onTaskEdit}
        onMove={onTaskMove}
        tasks={selectedTasks}
      />
    </section>
  )
}

type CalendarGridProps = {
  dateRefs: MutableRefObject<Map<LocalDate, HTMLButtonElement>>
  draggingTaskId?: string
  focusedDate: LocalDate
  mode: Exclude<UpcomingCalendarMode, "year">
  onAdd: (date: LocalDate) => void
  onDateSelect: (date: LocalDate, shouldFocus?: boolean) => void
  onDayKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: LocalDate) => void
  onDrop: (event: DragEvent<HTMLElement>, date: LocalDate) => void
  onDraggingTaskIdChange: (taskId?: string) => void
  onTaskEdit?: (taskId: string) => void
  onTaskKeyDown: (event: KeyboardEvent<HTMLButtonElement>, task: UpcomingCalendarTask) => void
  range: readonly LocalDate[]
  selectedDate: LocalDate
  tasksByDate: ReadonlyMap<LocalDate, readonly UpcomingCalendarTask[]>
  today: LocalDate
  visibleMonth: string
  weekStartsOn: WeekStart
}

function CalendarGrid(props: CalendarGridProps) {
  return (
    <>
      <div className="upcoming-calendar__weekdays" aria-hidden="true">
        {weekdayLabels(props.weekStartsOn).map((weekday) => <span className="upcoming-calendar__weekday" key={weekday}>{weekday}</span>)}
      </div>
      <div className={`upcoming-calendar__grid upcoming-calendar__grid--${props.mode}`} role="grid" aria-label={`${props.mode} calendar`}>
        {props.range.map((date) => {
          const tasks = props.tasksByDate.get(date) ?? []
          return (
            <ForwardedCalendarDay
              date={date}
              density={dayDensity(tasks)}
              draggingTaskId={props.draggingTaskId}
              isCurrentMonth={date.slice(0, 7) === props.visibleMonth}
              isFocused={date === props.focusedDate}
              isSelected={date === props.selectedDate}
              isToday={date === props.today}
              key={date}
              mode={props.mode}
              onAdd={props.onAdd}
              onDateSelect={props.onDateSelect}
              onDayKeyDown={props.onDayKeyDown}
              onDrop={props.onDrop}
              onDraggingTaskIdChange={props.onDraggingTaskIdChange}
              onTaskEdit={props.onTaskEdit}
              onTaskKeyDown={props.onTaskKeyDown}
              ref={(element) => {
                if (element) props.dateRefs.current.set(date, element)
                else props.dateRefs.current.delete(date)
              }}
              tasks={tasks}
            />
          )
        })}
      </div>
    </>
  )
}

type CalendarDayProps = {
  date: LocalDate
  density: CalendarDayDensity
  draggingTaskId?: string
  isCurrentMonth: boolean
  isFocused: boolean
  isSelected: boolean
  isToday: boolean
  mode: Exclude<UpcomingCalendarMode, "year">
  onAdd: (date: LocalDate) => void
  onDateSelect: (date: LocalDate) => void
  onDayKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: LocalDate) => void
  onDrop: (event: DragEvent<HTMLElement>, date: LocalDate) => void
  onDraggingTaskIdChange: (taskId?: string) => void
  onTaskEdit?: (taskId: string) => void
  onTaskKeyDown: (event: KeyboardEvent<HTMLButtonElement>, task: UpcomingCalendarTask) => void
  tasks: readonly UpcomingCalendarTask[]
}

const CalendarDay = function CalendarDay({
  date,
  density,
  draggingTaskId,
  isCurrentMonth,
  isFocused,
  isSelected,
  isToday,
  mode,
  onAdd,
  onDateSelect,
  onDayKeyDown,
  onDrop,
  onDraggingTaskIdChange,
  onTaskEdit,
  onTaskKeyDown,
  tasks,
}: CalendarDayProps, ref: ForwardedRef<HTMLButtonElement>) {
  const visibleTasks = mode === "week" ? tasks : tasks.slice(0, 3)
  const overflow = tasks.length - visibleTasks.length
  const densityLabel = `${density.active} active, ${density.completed} completed`

  return (
    <article
      aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${densityLabel}`}
      className={[
        "upcoming-calendar__day",
        !isCurrentMonth && mode === "month" && "upcoming-calendar__day--outside",
        isToday && "upcoming-calendar__day--today",
        isSelected && "upcoming-calendar__day--selected",
        draggingTaskId && "upcoming-calendar__day--droppable",
      ].filter(Boolean).join(" ")}
      data-has-tasks={density.total > 0}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, date)}
      role="gridcell"
    >
      <div className="upcoming-calendar__day-header">
        <button
          aria-current={isToday ? "date" : undefined}
          aria-label={`Select ${formatDate(date, { month: "long", day: "numeric", year: "numeric" })}; ${densityLabel}`}
          className="upcoming-calendar__day-number"
          onClick={() => onDateSelect(date)}
          onKeyDown={(event) => onDayKeyDown(event, date)}
          ref={ref}
          tabIndex={isFocused ? 0 : -1}
          type="button"
        >
          {fromLocalDate(date).getDate()}
        </button>
        <button aria-label={`Add task on ${date}`} className="upcoming-calendar__day-add" onClick={() => onAdd(date)} type="button">+</button>
      </div>
      <div className="upcoming-calendar__day-tasks">
        {visibleTasks.map((task) => (
          <button
            aria-label={`${task.title}, ${task.completed ? "completed" : "active"}. Press Alt and an arrow key to move.`}
            className={`upcoming-calendar__task ${task.completed ? "upcoming-calendar__task--completed" : ""}`}
            draggable
            key={task.id}
            onClick={() => onTaskEdit?.(task.id)}
            onDragEnd={() => onDraggingTaskIdChange(undefined)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData(dragMime, createCalendarTaskDragPayload(task))
              onDraggingTaskIdChange(task.id)
            }}
            onKeyDown={(event) => onTaskKeyDown(event, task)}
            title={`${task.title}${task.projectName ? ` - ${task.projectName}` : ""}`}
            type="button"
          >
            <span aria-hidden="true" className="upcoming-calendar__task-dot" style={{ background: task.projectColor ?? "var(--color-success, #267553)" }} />
            <span className="upcoming-calendar__task-label">{task.title}</span>
          </button>
        ))}
        {overflow > 0 ? <button aria-label={`Show all ${tasks.length} tasks on ${date}`} className="upcoming-calendar__more-tasks" onClick={() => onDateSelect(date)} type="button">+{overflow} more</button> : null}
      </div>
    </article>
  )
}

const ForwardedCalendarDay = forwardRef(CalendarDay)

function YearView({
  cursor,
  tasksByDate,
  onMonthSelect,
}: {
  cursor: LocalDate
  tasksByDate: ReadonlyMap<LocalDate, readonly UpcomingCalendarTask[]>
  onMonthSelect: (date: LocalDate) => void
}) {
  const year = fromLocalDate(cursor).getFullYear()
  return (
    <div className="upcoming-calendar__year-grid" aria-label={`${year} months`}>
      {Array.from({ length: 12 }, (_, month) => {
        const date = toLocalDate(new Date(year, month, 1))
        const density = dayDensity(Array.from(tasksByDate.entries())
          .filter(([taskDate]) => taskDate.slice(0, 7) === date.slice(0, 7))
          .flatMap(([, tasks]) => tasks))
        return (
          <button className="upcoming-calendar__month-button" key={date} onClick={() => onMonthSelect(date)} type="button">
            <span>{formatDate(date, { month: "long" })}</span>
            <small>{density.total ? `${density.active} active, ${density.completed} completed` : "No tasks"}</small>
          </button>
        )
      })}
    </div>
  )
}

function SelectedDayAgenda({
  date,
  density,
  onAdd,
  onEdit,
  onMove,
  tasks,
}: {
  date: LocalDate
  density: CalendarDayDensity
  onAdd: () => void
  onEdit?: (taskId: string) => void
  onMove?: (taskId: string, date: LocalDate) => void
  tasks: readonly UpcomingCalendarTask[]
}) {
  return (
    <aside className="upcoming-calendar__agenda" aria-label={`Agenda for ${formatDate(date, { month: "long", day: "numeric" })}`}>
      <div>
        <p className="upcoming-calendar__agenda-kicker">{formatDate(date, { weekday: "long" })}</p>
        <h3>{formatDate(date, { month: "long", day: "numeric" })}</h3>
        <p>{density.active} active, {density.completed} completed</p>
      </div>
      <button className="upcoming-calendar__agenda-add" onClick={onAdd} type="button">Add task</button>
      <div className="upcoming-calendar__agenda-list">
        {tasks.length ? tasks.map((task) => (
          <div className="upcoming-calendar__agenda-task" key={task.id}>
            <button onClick={() => onEdit?.(task.id)} type="button">{task.title}</button>
            <span>
              <button aria-label={`Move ${task.title} to previous day`} onClick={() => onMove?.(task.id, addDays(date, -1))} type="button">&larr;</button>
              <button aria-label={`Move ${task.title} to next day`} onClick={() => onMove?.(task.id, addDays(date, 1))} type="button">&rarr;</button>
            </span>
          </div>
        )) : <p className="upcoming-calendar__agenda-empty">Nothing scheduled.</p>}
      </div>
    </aside>
  )
}

function calendarHeading(mode: UpcomingCalendarMode, cursor: LocalDate): string {
  return mode === "year"
    ? String(fromLocalDate(cursor).getFullYear())
    : formatDate(cursor, { month: "long", year: "numeric" })
}

function weekdayLabels(weekStartsOn: WeekStart): string[] {
  const anchor = new Date(2023, 0, 1 + weekStartsOn)
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
      new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + index),
    ))
}
