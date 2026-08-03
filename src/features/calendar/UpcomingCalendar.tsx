import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react"
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
}: UpcomingCalendarProps) {
  const [mode, setMode] = useState<UpcomingCalendarMode>(initialMode)
  const [cursor, setCursor] = useState<LocalDate>(selectedDate ?? today)
  const [draggingTaskId, setDraggingTaskId] = useState<string>()

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

  const range = calendarRange(mode, cursor, weekStartsOn)
  const heading = mode === "year"
    ? String(fromLocalDate(cursor).getFullYear())
    : formatDate(cursor, { month: "long", year: "numeric" })

  function selectDate(date: LocalDate): void {
    setCursor(date)
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
    const offsetByKey: Record<string, number | undefined> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const offset = offsetByKey[event.key]
    if (offset !== undefined) {
      event.preventDefault()
      selectDate(addDays(date, offset))
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
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
      <style>{calendarStyles}</style>
      <header className="upcoming-calendar__toolbar">
        <div className="upcoming-calendar__nav">
          <button aria-label={`Previous ${mode}`} className="upcoming-calendar__icon-button" onClick={() => shift(-1)} type="button">
            <span aria-hidden="true">‹</span>
          </button>
          <button className="upcoming-calendar__today-button" onClick={() => setCursor(today)} type="button">Today</button>
          <button aria-label={`Next ${mode}`} className="upcoming-calendar__icon-button" onClick={() => shift(1)} type="button">
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <h2 aria-live="polite">{heading}</h2>
        <div aria-label="Calendar view" className="upcoming-calendar__modes" role="group">
          {modes.map((candidate) => (
            <button
              aria-pressed={mode === candidate}
              key={candidate}
              onClick={() => setMode(candidate)}
              type="button"
            >
              {candidate[0].toUpperCase() + candidate.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {mode === "year" ? (
        <div className="upcoming-calendar__year-grid">
          {Array.from({ length: 12 }, (_, month) => {
            const date = toLocalDate(new Date(fromLocalDate(cursor).getFullYear(), month, 1))
            const count = countTasksInMonth(tasksByDate, date)
            return (
              <button
                className="upcoming-calendar__month-button"
                key={date}
                onClick={() => {
                  setCursor(date)
                  setMode("month")
                }}
                type="button"
              >
                <span>{formatDate(date, { month: "long" })}</span>
                <b>{count ? `${count} task${count === 1 ? "" : "s"}` : "Open month"}</b>
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="upcoming-calendar__weekdays" aria-hidden="true">
            {weekdayLabels(weekStartsOn).map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className={`upcoming-calendar__grid upcoming-calendar__grid--${mode}`} role="grid" aria-label={`${heading} calendar`}>
            {range.map((date) => (
              <CalendarDay
                date={date}
                draggingTaskId={draggingTaskId}
                isCurrentMonth={date.slice(0, 7) === cursor.slice(0, 7)}
                isSelected={date === selectedDate}
                isToday={date === today}
                key={date}
                mode={mode}
                onAdd={onTaskAdd}
                onDateSelect={selectDate}
                onDayKeyDown={handleDayKeyDown}
                onDrop={handleDrop}
                onDraggingTaskIdChange={setDraggingTaskId}
                onEdit={onTaskEdit}
                tasks={tasksByDate.get(date) ?? []}
              />
            ))}
          </div>
        </>
      )}
    </section>
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
          className="upcoming-calendar__day-number"
          onClick={() => onDateSelect(date)}
          onKeyDown={(event) => onDayKeyDown(event, date)}
          type="button"
        >
          {fromLocalDate(date).getDate()}
        </button>
        <button aria-label={`Add task on ${date}`} className="upcoming-calendar__add-day" onClick={() => onAdd?.(date)} type="button">+</button>
      </div>
      <div className="upcoming-calendar__task-list">
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
            <span aria-hidden="true" className="upcoming-calendar__task-dot" style={{ background: task.projectColor ?? "var(--color-success, #267553)" }} />
            <span>{task.title}</span>
          </button>
        ))}
        {overflow > 0 ? <button className="upcoming-calendar__more" onClick={() => onDateSelect(date)} type="button">+{overflow} more</button> : null}
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

function countTasksInMonth(tasksByDate: Map<LocalDate, UpcomingCalendarTask[]>, month: LocalDate): number {
  let count = 0
  tasksByDate.forEach((tasks, date) => {
    if (date.slice(0, 7) === month.slice(0, 7)) count += tasks.length
  })
  return count
}

const calendarStyles = `
.upcoming-calendar{color:var(--color-text-primary,#252321);font:14px/1.35 var(--font-sans,Inter,"Segoe UI",sans-serif);min-width:0}
.upcoming-calendar button{font:inherit}.upcoming-calendar__toolbar{align-items:center;display:grid;gap:12px;grid-template-columns:1fr auto 1fr;margin-bottom:18px}.upcoming-calendar__toolbar h2{font-size:18px;margin:0;text-align:center}.upcoming-calendar__nav,.upcoming-calendar__modes{align-items:center;display:flex;gap:4px}.upcoming-calendar__modes{justify-content:flex-end}.upcoming-calendar__icon-button,.upcoming-calendar__today-button,.upcoming-calendar__modes button,.upcoming-calendar__add-day,.upcoming-calendar__more{background:transparent;border:1px solid var(--color-border,#e4e1dd);border-radius:6px;color:inherit;cursor:pointer}.upcoming-calendar__icon-button{font-size:24px;height:32px;line-height:1;width:32px}.upcoming-calendar__today-button{height:32px;padding:0 10px}.upcoming-calendar__modes{background:var(--color-surface-hover,#f0f0ef);border-radius:7px;padding:3px}.upcoming-calendar__modes button{border:0;border-radius:4px;color:var(--color-text-secondary,#6d6965);height:28px;padding:0 9px}.upcoming-calendar__modes button[aria-pressed="true"]{background:var(--color-surface,#fff);box-shadow:0 1px 2px rgb(35 31 28 / 10%);color:var(--color-text-primary,#252321);font-weight:700}.upcoming-calendar__weekdays,.upcoming-calendar__grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.upcoming-calendar__weekdays{color:var(--color-text-tertiary,#918c87);font-size:11px;font-weight:700;margin-bottom:6px;text-align:center;text-transform:uppercase}.upcoming-calendar__grid{border-left:1px solid var(--color-border,#e4e1dd);border-top:1px solid var(--color-border,#e4e1dd)}.upcoming-calendar__day{background:var(--color-surface,#fff);border-bottom:1px solid var(--color-border,#e4e1dd);border-right:1px solid var(--color-border,#e4e1dd);min-height:124px;padding:8px}.upcoming-calendar__grid--week .upcoming-calendar__day{min-height:300px}.upcoming-calendar__day--outside{background:var(--color-canvas,#f7f7f6);color:var(--color-text-tertiary,#918c87)}.upcoming-calendar__day--selected{box-shadow:inset 0 0 0 2px var(--color-focus-ring,#276fbb)}.upcoming-calendar__day--droppable{background:color-mix(in srgb,var(--color-success,#267553) 8%,var(--color-surface,#fff))}.upcoming-calendar__day-header{align-items:center;display:flex;justify-content:space-between;margin-bottom:7px}.upcoming-calendar__day-number{background:transparent;border:0;border-radius:50%;color:inherit;cursor:pointer;font-weight:650;height:27px;padding:0;width:27px}.upcoming-calendar__day--today .upcoming-calendar__day-number{background:var(--color-success,#267553);color:#fff}.upcoming-calendar__add-day{align-items:center;border:0;color:var(--color-text-tertiary,#918c87);display:inline-flex;font-size:18px;height:27px;justify-content:center;opacity:0;width:27px}.upcoming-calendar__day:hover .upcoming-calendar__add-day,.upcoming-calendar__day:focus-within .upcoming-calendar__add-day{opacity:1}.upcoming-calendar__task-list{display:grid;gap:4px}.upcoming-calendar__task{align-items:center;background:var(--color-surface-hover,#f0f0ef);border:0;border-radius:4px;color:inherit;cursor:grab;display:flex;font-size:12px;gap:6px;min-width:0;padding:4px 6px;text-align:left}.upcoming-calendar__task:hover{background:color-mix(in srgb,var(--color-success,#267553) 13%,var(--color-surface,#fff))}.upcoming-calendar__task--completed{color:var(--color-text-tertiary,#918c87);text-decoration:line-through}.upcoming-calendar__task-dot{border-radius:50%;flex:0 0 auto;height:6px;width:6px}.upcoming-calendar__task span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.upcoming-calendar__more{border:0;color:var(--color-success,#267553);font-size:12px;padding:3px 5px;text-align:left}.upcoming-calendar__year-grid{display:grid;gap:10px;grid-template-columns:repeat(4,minmax(0,1fr))}.upcoming-calendar__month-button{background:var(--color-surface,#fff);border:1px solid var(--color-border,#e4e1dd);border-radius:7px;color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:5px;min-height:86px;padding:12px;text-align:left}.upcoming-calendar__month-button:hover{border-color:var(--color-success,#267553);background:color-mix(in srgb,var(--color-success,#267553) 6%,var(--color-surface,#fff))}.upcoming-calendar__month-button span{font-weight:700}.upcoming-calendar__month-button b{color:var(--color-success,#267553);font-size:12px;font-weight:600}.upcoming-calendar button:focus-visible{outline:2px solid var(--color-focus-ring,#276fbb);outline-offset:2px}@media (max-width:720px){.upcoming-calendar__toolbar{grid-template-columns:1fr auto}.upcoming-calendar__toolbar h2{grid-column:1/-1;grid-row:1;text-align:left}.upcoming-calendar__nav{grid-row:2}.upcoming-calendar__modes{grid-row:2}.upcoming-calendar__day{min-height:94px;padding:5px}.upcoming-calendar__grid--week{overflow-x:auto}.upcoming-calendar__grid--week .upcoming-calendar__day{min-width:130px}.upcoming-calendar__task{font-size:11px;padding:3px 4px}.upcoming-calendar__year-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`
