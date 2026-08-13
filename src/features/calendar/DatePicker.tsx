import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  addDays,
  formatDate,
  fromLocalDate,
  parseDateExpression,
  toLocalDate,
  type LocalDate,
  type WeekStart,
} from "../../core/dates"
import { buildMonthGrid, dateForCalendarKey, shiftMonth, weekdayLabels } from "./calendar-grid"
import "./date-picker.css"

export type DatePickerProps = {
  value?: LocalDate
  onChange: (date?: LocalDate) => void
  onDismiss?: () => void
  today?: LocalDate
  minDate?: LocalDate
  maxDate?: LocalDate
  dateCounts?: Record<LocalDate, number>
  weekStartsOn?: WeekStart
  label?: string
  showTextEntry?: boolean
  allowClear?: boolean
}

export function DatePicker({
  value,
  onChange,
  onDismiss,
  today = toLocalDate(new Date()),
  minDate,
  maxDate,
  dateCounts = {},
  weekStartsOn = 0,
  label = "Choose a date",
  showTextEntry = true,
  allowClear = true,
}: DatePickerProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => value ?? today)
  const [draft, setDraft] = useState("")
  const [pendingFocus, setPendingFocus] = useState<LocalDate>()
  const gridId = useId()
  const dayRefs = useRef(new Map<LocalDate, HTMLButtonElement>())
  const days = useMemo(
    () => buildMonthGrid({ month: visibleMonth, today, selectedDate: value, minDate, maxDate, weekStartsOn }),
    [visibleMonth, today, value, minDate, maxDate, weekStartsOn],
  )

  useEffect(() => {
    if (value) setVisibleMonth(value)
  }, [value])

  useEffect(() => {
    if (pendingFocus) {
      dayRefs.current.get(pendingFocus)?.focus()
      setPendingFocus(undefined)
    }
  }, [days, pendingFocus])

  function choose(date: LocalDate): void {
    if (isOutOfRange(date, minDate, maxDate)) return
    onChange(date)
    setVisibleMonth(date)
  }

  function moveFocus(date: LocalDate): void {
    const month = date.slice(0, 7)
    if (month !== visibleMonth.slice(0, 7)) {
      setVisibleMonth(date)
      setPendingFocus(date)
      return
    }
    dayRefs.current.get(date)?.focus()
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: LocalDate): void {
    if (event.key === "PageUp") {
      event.preventDefault()
      setVisibleMonth((month) => shiftMonth(month, event.shiftKey ? -12 : -1))
      return
    }
    if (event.key === "PageDown") {
      event.preventDefault()
      setVisibleMonth((month) => shiftMonth(month, event.shiftKey ? 12 : 1))
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onDismiss?.()
      return
    }
    const target = dateForCalendarKey(event.key, date, weekStartsOn)
    if (target) {
      event.preventDefault()
      if (!isOutOfRange(target, minDate, maxDate)) moveFocus(target)
    }
  }

  function submitDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = parseDateExpression(draft, today)
    if (parsed && !isOutOfRange(parsed.date, minDate, maxDate)) {
      choose(parsed.date)
      setDraft("")
    }
  }

  const formattedMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    fromLocalDate(visibleMonth),
  )
  const focusDate = value && days.some((day) => day.date === value) ? value : days.find((day) => day.isToday)?.date ?? days[0].date

  return (
    <section className="date-picker" aria-label={label}>
      {showTextEntry ? (
        <form className="date-picker__entry" onSubmit={submitDraft}>
          <label htmlFor={gridId}>Schedule</label>
          <input
            id={gridId}
            value={draft}
            placeholder="Try tomorrow or 2026-08-15"
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      ) : null}
      <div className="date-picker__quick-actions" aria-label="Quick dates">
        <button type="button" onClick={() => choose(today)}>Today</button>
        <button type="button" onClick={() => choose(addDays(today, 1))}>Tomorrow</button>
        <button type="button" onClick={() => choose(addDays(today, 7))}>Next week</button>
        {allowClear && value ? <button type="button" onClick={() => onChange(undefined)}>Clear date</button> : null}
      </div>
      <div className="date-picker__header">
        <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}>
          <span aria-hidden="true">&lt;</span>
        </button>
        <strong aria-live="polite">{formattedMonth}</strong>
        <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}>
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
      <div className="date-picker__weekdays" aria-hidden="true">
        {weekdayLabels(weekStartsOn).map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="date-picker__grid" role="grid" aria-label={`${formattedMonth} calendar`}>
        {days.map((day) => {
          const count = dateCounts[day.date] ?? 0
          const isFocusable = day.date === focusDate
          return (
            <button
              key={day.date}
              ref={(node) => {
                if (node) dayRefs.current.set(day.date, node)
                else dayRefs.current.delete(day.date)
              }}
              type="button"
              role="gridcell"
              data-date={day.date}
              tabIndex={isFocusable ? 0 : -1}
              disabled={day.isDisabled}
              aria-current={day.isToday ? "date" : undefined}
              aria-selected={day.isSelected}
              aria-label={`${formatDate(day.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${count ? `, ${count} scheduled` : ""}`}
              className={[
                "date-picker__day",
                !day.isCurrentMonth && "date-picker__day--outside",
                day.isToday && "date-picker__day--today",
                day.isSelected && "date-picker__day--selected",
              ].filter(Boolean).join(" ")}
              onClick={() => choose(day.date)}
              onKeyDown={(event) => onDayKeyDown(event, day.date)}
            >
              <span>{day.day}</span>
              {count > 0 ? <small aria-hidden="true">{count}</small> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function isOutOfRange(date: LocalDate, minDate?: LocalDate, maxDate?: LocalDate): boolean {
  return Boolean((minDate && date < minDate) || (maxDate && date > maxDate))
}
