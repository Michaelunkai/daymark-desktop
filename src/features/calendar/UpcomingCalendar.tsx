import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import {
  addDays,
  addMonths,
  addYears,
  formatDate,
  fromLocalDate,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"
import { groupUpcomingTasks } from "./upcoming-model"
import "./upcoming-calendar.css"

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
  onTaskEdit?: (taskId: string) => void
  onTaskMove?: (taskId: string, date: LocalDate) => void
  onTaskToggle?: (taskId: string) => void
}

const modes: readonly UpcomingCalendarMode[] = ["week", "month", "year"]

export function UpcomingCalendar({
  tasks,
  selectedDate,
  initialMode = "month",
  today = toLocalDate(new Date()),
  weekStartsOn = 0,
  onDateSelect,
  onTaskAdd,
  onTaskEdit,
  onTaskMove,
  onTaskToggle,
}: UpcomingCalendarProps) {
  const [mode, setMode] = useState<UpcomingCalendarMode>(initialMode)
  const [cursor, setCursor] = useState<LocalDate>(selectedDate ?? today)
  const [draggingTaskId, setDraggingTaskId] = useState<string>()
  const [pendingFocus, setPendingFocus] = useState<LocalDate>()
  const dayRefs = useRef(new Map<LocalDate, HTMLButtonElement>())

  const tasksByDate = useMemo(() => {
    const grouped = new Map<LocalDate, UpcomingCalendarTask[]>()
    tasks.forEach((task) => {
      const items = grouped.get(task.dueDate) ?? []
      items.push(task)
      grouped.set(task.dueDate, items)
    })
    grouped.forEach((items) => items.sort((left, right) => Number(left.completed) - Number(right.completed) || left.title.localeCompare(right.title)))
    return grouped
  }, [tasks])

  const groupedUpcoming = useMemo(
    () => groupUpcomingTasks(tasks, today),
    [tasks, today],
  )
  const selectedDay = selectedDate ?? today
  const selectedDayTasks = tasksByDate.get(selectedDay) ?? []
  const range = calendarRange(mode, cursor, weekStartsOn)
  const heading = mode === "year"
    ? String(fromLocalDate(cursor).getFullYear())
    : mode === "week"
      ? weekLabel(cursor, weekStartsOn)
      : formatDate(cursor, { month: "long", year: "numeric" })

  useEffect(() => {
    if (!pendingFocus) return
    dayRefs.current.get(pendingFocus)?.focus()
    setPendingFocus(undefined)
  }, [pendingFocus, range])

  function selectDate(date: LocalDate): void {
    setCursor(date)
    onDateSelect?.(date)
  }

  function moveFocus(date: LocalDate): void {
    setCursor(date)
    setPendingFocus(date)
    onDateSelect?.(date)
  }

  function shift(amount: number): void {
    setCursor((date) => {
      if (mode === "week") return addDays(date, amount * 7)
      if (mode === "month") return addMonths(date, amount)
      return addYears(date, amount)
    })
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: LocalDate): void {
    const offsets: Record<string, number | undefined> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const offset = offsets[event.key]
    if (offset !== undefined) {
      event.preventDefault()
      moveFocus(addDays(date, offset))
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      const start = startOfWeek(date, weekStartsOn)
      moveFocus(event.key === "Home" ? start : addDays(start, 6))
      return
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault()
      moveFocus(event.shiftKey
        ? addYears(date, event.key === "PageUp" ? -1 : 1)
        : addMonths(date, event.key === "PageUp" ? -1 : 1))
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectDate(date)
      onTaskAdd?.(date)
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>, date: LocalDate): void {
    event.preventDefault()
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId
    if (taskId) onTaskMove?.(taskId, date)
    setDraggingTaskId(undefined)
  }

  return (
    <section className="upcoming-calendar" aria-label="Upcoming calendar">
      <header className="upcoming-calendar__toolbar">
        <div className="upcoming-calendar__navigation">
          <button aria-label={`Previous ${mode}`} className="upcoming-calendar__nav-button" onClick={() => shift(-1)} type="button">‹</button>
          <button className="upcoming-calendar__today-button" onClick={() => { setCursor(today); onDateSelect?.(today) }} type="button">Today</button>
          <button aria-label={`Next ${mode}`} className="upcoming-calendar__nav-button" onClick={() => shift(1)} type="button">›</button>
        </div>
        <h2 className="upcoming-calendar__title" aria-live="polite">{heading}</h2>
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
          <button className="upcoming-calendar__add-button" onClick={() => onTaskAdd?.(selectedDate ?? today)} type="button">
            <span aria-hidden="true">+</span><span className="upcoming-calendar__add-button-label">Add task</span>
          </button>
        </div>
      </header>

      {mode === "year" ? (
        <div className="upcoming-calendar__year-grid">
          {Array.from({ length: 12 }, (_, month) => {
            const date = toLocalDate(new Date(fromLocalDate(cursor).getFullYear(), month, 1))
            const count = tasks.filter((task) => task.dueDate.slice(0, 7) === date.slice(0, 7)).length
            return (
              <button
                className="upcoming-calendar__month-button"
                key={date}
                onClick={() => { setCursor(date); setMode("month"); onDateSelect?.(date) }}
                type="button"
              >
                <span>{formatDate(date, { month: "long" })}</span>
                <b>{count ? `${count} task${count === 1 ? "" : "s"}` : "Open month"}</b>
              </button>
            )
          })}
        </div>
      ) : (
        <div
          aria-label={`${heading} calendar grid`}
          className="upcoming-calendar__viewport"
          role="region"
          tabIndex={0}
        >
          <div className="upcoming-calendar__surface">
            <div className="upcoming-calendar__weekdays" aria-hidden="true">
              {weekdayLabels(weekStartsOn).map((weekday) => <span className="upcoming-calendar__weekday" key={weekday}>{weekday}</span>)}
            </div>
            <div className={`upcoming-calendar__grid upcoming-calendar__grid--${mode}`} role="grid" aria-label={`${heading} calendar`}>
              {range.map((date) => (
                <CalendarDay
                  date={date}
                  draggingTaskId={draggingTaskId}
                  isCurrentMonth={date.slice(0, 7) === cursor.slice(0, 7)}
                  isSelected={date === selectedDate}
                  isToday={date === today}
                  mode={mode}
                  onAdd={onTaskAdd}
                  onDateSelect={selectDate}
                  onDayKeyDown={handleDayKeyDown}
                  onDrop={handleDrop}
                  onDraggingTaskIdChange={setDraggingTaskId}
                  onEdit={onTaskEdit}
                  onToggle={onTaskToggle}
                  registerDay={(node) => node ? dayRefs.current.set(date, node) : dayRefs.current.delete(date)}
                  tasks={tasksByDate.get(date) ?? []}
                  key={date}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <section className="upcoming-selected-day" aria-labelledby="selected-day-title">
        <div className="upcoming-agenda__header">
          <div>
            <p className="upcoming-calendar__eyebrow">SELECTED DAY</p>
            <h3 id="selected-day-title">{formatDate(selectedDay, { weekday: "long", month: "long", day: "numeric" })}</h3>
          </div>
          <button className="upcoming-calendar__add-button" onClick={() => onTaskAdd?.(selectedDay)} type="button">
            <span aria-hidden="true">+</span><span>Add task</span>
          </button>
        </div>
        {selectedDayTasks.length ? (
          <div className="upcoming-agenda__tasks">
            {selectedDayTasks.map((task) => (
              <AgendaTask key={task.id} onEdit={onTaskEdit} onToggle={onTaskToggle} task={task} />
            ))}
          </div>
        ) : (
          <div className="upcoming-agenda__empty">
            <strong>No tasks are scheduled for this day.</strong>
            <span>Add one now, or choose another date above.</span>
          </div>
        )}
      </section>

      <section className="upcoming-agenda" aria-labelledby="upcoming-agenda-title">
        <div className="upcoming-agenda__header">
          <div>
            <p className="upcoming-calendar__eyebrow">NEXT UP</p>
            <h3 id="upcoming-agenda-title">Upcoming tasks</h3>
          </div>
          <span>{groupedUpcoming.reduce((count, group) => count + group.tasks.length, 0)} scheduled</span>
        </div>
        {groupedUpcoming.length ? (
          <div className="upcoming-agenda__groups">
            {groupedUpcoming.map((group) => (
              <div className="upcoming-agenda__group" key={group.date}>
                <button className="upcoming-agenda__date" onClick={() => selectDate(group.date)} type="button">
                  <strong>{group.label}</strong><span>{group.date}</span>
                </button>
                <div className="upcoming-agenda__tasks">
                  {group.tasks.map((task) => (
                    <AgendaTask
                      key={task.id}
                      onEdit={onTaskEdit}
                      onToggle={onTaskToggle}
                      task={task}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="upcoming-agenda__empty">
            <strong>Your runway is clear.</strong>
            <span>Add a task from the selected day to start planning.</span>
          </div>
        )}
      </section>
    </section>
  )
}

function AgendaTask({
  task,
  onEdit,
  onToggle,
}: {
  task: UpcomingCalendarTask
  onEdit?: (taskId: string) => void
  onToggle?: (taskId: string) => void
}) {
  return (
    <article className={`upcoming-agenda__task ${task.completed ? "is-completed" : ""}`}>
      <button
        aria-label={task.completed ? `Restore ${task.title}` : `Complete ${task.title}`}
        className="upcoming-agenda__check"
        onClick={() => onToggle?.(task.id)}
        type="button"
      >
        {task.completed ? "✓" : ""}
      </button>
      <button className="upcoming-agenda__task-body" onClick={() => onEdit?.(task.id)} type="button">
        <span>{task.title}</span>
        {task.projectName ? <small>{task.projectName}</small> : null}
      </button>
      <button aria-label={`Edit ${task.title}`} className="upcoming-agenda__edit" onClick={() => onEdit?.(task.id)} type="button">Edit</button>
    </article>
  )
}

type CalendarDayProps = {
  date: LocalDate
  draggingTaskId?: string
  isCurrentMonth: boolean
  isSelected: boolean
  isToday: boolean
  mode: Exclude<UpcomingCalendarMode, "year">
  onAdd?: (date: LocalDate) => void
  onDateSelect: (date: LocalDate) => void
  onDayKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: LocalDate) => void
  onDrop: (event: DragEvent<HTMLElement>, date: LocalDate) => void
  onDraggingTaskIdChange: (taskId?: string) => void
  onEdit?: (taskId: string) => void
  onToggle?: (taskId: string) => void
  registerDay: (node: HTMLButtonElement | null) => void
  tasks: readonly UpcomingCalendarTask[]
}

function CalendarDay({
  date,
  draggingTaskId,
  isCurrentMonth,
  isSelected,
  isToday,
  mode,
  onAdd,
  onDateSelect,
  onDayKeyDown,
  onDrop,
  onDraggingTaskIdChange,
  onEdit,
  tasks,
  registerDay,
}: CalendarDayProps) {
  const visibleTasks = mode === "week" ? tasks : tasks.slice(0, 3)
  const overflow = tasks.length - visibleTasks.length

  return (
    <article
      aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${tasks.length} tasks`}
      className={[
        "upcoming-calendar__day",
        !isCurrentMonth && "upcoming-calendar__day--outside",
        isToday && "upcoming-calendar__day--today",
        isSelected && "upcoming-calendar__day--selected",
        tasks.length > 0 && "upcoming-calendar__day--has-tasks",
        draggingTaskId && "upcoming-calendar__day--droppable",
      ].filter(Boolean).join(" ")}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, date)}
      role="gridcell"
    >
      <div className="upcoming-calendar__day-header">
        <button
          aria-current={isToday ? "date" : undefined}
          aria-label={`Select ${formatDate(date, { month: "long", day: "numeric", year: "numeric" })}`}
          aria-selected={isSelected}
          className="upcoming-calendar__day-number"
          onClick={() => onDateSelect(date)}
          onKeyDown={(event) => onDayKeyDown(event, date)}
          ref={registerDay}
          type="button"
        >
          {fromLocalDate(date).getDate()}
        </button>
        <button aria-label={`Add task on ${date}`} className="upcoming-calendar__add-day" onClick={() => onAdd?.(date)} type="button">+</button>
      </div>
      <div className="upcoming-calendar__day-tasks">
        {visibleTasks.map((task) => (
          <button
            className={`upcoming-calendar__task ${task.completed ? "upcoming-calendar__task--completed" : ""}`}
            draggable
            key={task.id}
            onClick={() => onEdit?.(task.id)}
            onDragEnd={() => onDraggingTaskIdChange(undefined)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", task.id)
              onDraggingTaskIdChange(task.id)
            }}
            title={`${task.title}${task.projectName ? ` · ${task.projectName}` : ""}`}
            type="button"
          >
            <span className="upcoming-calendar__task-label">{task.title}</span>
          </button>
        ))}
        {overflow > 0 ? <button className="upcoming-calendar__more-tasks" onClick={() => onDateSelect(date)} type="button">+{overflow} more</button> : null}
      </div>
    </article>
  )
}

function calendarRange(mode: Exclude<UpcomingCalendarMode, "year">, cursor: LocalDate, weekStartsOn: WeekStart): LocalDate[] {
  if (mode === "week") {
    const start = startOfWeek(cursor, weekStartsOn)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }
  const start = startOfWeek(startOfMonth(cursor), weekStartsOn)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function weekdayLabels(weekStartsOn: WeekStart): string[] {
  const anchor = new Date(2023, 0, 1 + weekStartsOn)
  return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + index)))
}

function weekLabel(cursor: LocalDate, weekStartsOn: WeekStart): string {
  const start = startOfWeek(cursor, weekStartsOn)
  const end = addDays(start, 6)
  return `${formatDate(start, { month: "short", day: "numeric" })} - ${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`
}
