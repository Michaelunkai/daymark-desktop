import type { ReactNode } from "react"

export type CalendarViewMode = "year" | "month" | "week"

export type CalendarToolbarProps = {
  mode: CalendarViewMode
  onModeChange: (mode: CalendarViewMode) => void
  rangeLabel: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  className?: string
  previousLabel?: string
  nextLabel?: string
  todayLabel?: string
  isToday?: boolean
  disabled?: boolean
}

const modes: Array<{ value: CalendarViewMode; label: string }> = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
]

export function CalendarToolbar({
  mode,
  onModeChange,
  rangeLabel,
  onPrevious,
  onNext,
  onToday,
  className,
  previousLabel = "Previous period",
  nextLabel = "Next period",
  todayLabel = "Today",
  isToday = false,
  disabled = false,
}: CalendarToolbarProps) {
  return (
    <header className={["calendar-toolbar", className].filter(Boolean).join(" ")}>
      <style>{calendarToolbarStyles}</style>
      <div className="calendar-toolbar__modes" aria-label="Calendar view" role="group">
        {modes.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="calendar-toolbar__mode"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="calendar-toolbar__navigation">
        <button
          type="button"
          className="calendar-toolbar__icon-button"
          aria-label={previousLabel}
          title={previousLabel}
          onClick={onPrevious}
          disabled={disabled}
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          className="calendar-toolbar__today"
          aria-current={isToday ? "date" : undefined}
          onClick={onToday}
          disabled={disabled || isToday}
        >
          {todayLabel}
        </button>
        <button
          type="button"
          className="calendar-toolbar__icon-button"
          aria-label={nextLabel}
          title={nextLabel}
          onClick={onNext}
          disabled={disabled}
        >
          <ChevronRight />
        </button>
      </div>

      <output className="calendar-toolbar__range" aria-live="polite">
        {rangeLabel}
      </output>
    </header>
  )
}

function ChevronLeft(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="m12.5 4.5-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronRight(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="m7.5 4.5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const calendarToolbarStyles = `
  .calendar-toolbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 42px;
    color: var(--color-text-primary, #252321);
    font-family: var(--font-sans, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  }

  .calendar-toolbar button {
    font: inherit;
  }

  .calendar-toolbar__modes,
  .calendar-toolbar__navigation {
    display: inline-flex;
    align-items: center;
  }

  .calendar-toolbar__modes {
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--color-border, #e4e1dd);
    border-radius: 8px;
    background: var(--color-surface-raised, #ffffff);
  }

  .calendar-toolbar__mode,
  .calendar-toolbar__today,
  .calendar-toolbar__icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--color-text-secondary, #6d6965);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }

  .calendar-toolbar__mode {
    min-width: 48px;
    min-height: 30px;
    padding: 0 9px;
    font-size: 12px;
    font-weight: 650;
  }

  .calendar-toolbar__mode:hover:not(:disabled),
  .calendar-toolbar__today:hover:not(:disabled),
  .calendar-toolbar__icon-button:hover:not(:disabled) {
    color: var(--color-text-primary, #252321);
    background: var(--color-surface-hover, #f0f0ef);
  }

  .calendar-toolbar__mode[aria-pressed="true"] {
    color: var(--color-text-primary, #252321);
    background: var(--color-surface, #ffffff);
    box-shadow: 0 1px 3px rgb(35 31 28 / 0.12);
  }

  .calendar-toolbar__navigation {
    justify-self: center;
    gap: 2px;
  }

  .calendar-toolbar__today {
    min-height: 32px;
    margin: 0 2px;
    padding: 0 10px;
    border: 1px solid var(--color-border, #e4e1dd);
    font-size: 12px;
    font-weight: 650;
  }

  .calendar-toolbar__today[aria-current="date"] {
    color: var(--color-success, #267553);
    border-color: color-mix(in srgb, var(--color-success, #267553) 42%, var(--color-border, #e4e1dd));
    background: color-mix(in srgb, var(--color-success, #267553) 10%, transparent);
  }

  .calendar-toolbar__icon-button {
    width: 32px;
    height: 32px;
    padding: 0;
  }

  .calendar-toolbar__icon-button svg {
    width: 18px;
    height: 18px;
  }

  .calendar-toolbar__range {
    justify-self: end;
    overflow: hidden;
    color: var(--color-text-primary, #252321);
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .calendar-toolbar button:focus-visible {
    outline: 2px solid var(--color-focus-ring, #276fbb);
    outline-offset: 2px;
  }

  .calendar-toolbar button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  @media (max-width: 620px) {
    .calendar-toolbar {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }

    .calendar-toolbar__modes {
      order: 2;
      grid-column: 1 / -1;
      width: 100%;
      justify-content: stretch;
    }

    .calendar-toolbar__mode {
      flex: 1;
    }

    .calendar-toolbar__navigation {
      justify-self: start;
    }

    .calendar-toolbar__range {
      max-width: min(52vw, 230px);
      font-size: 13px;
    }
  }
`

export default CalendarToolbar
