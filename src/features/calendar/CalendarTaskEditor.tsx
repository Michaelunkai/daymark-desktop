import { useEffect, useState, type FormEvent } from "react"
import type { LocalDate } from "../../core/dates"

export type CalendarTaskDraft = {
  date: LocalDate
  title: string
}

export function CalendarTaskEditor({
  date,
  onCancel,
  onSubmit,
}: {
  date: LocalDate
  onCancel: () => void
  onSubmit: (draft: CalendarTaskDraft) => void
}) {
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    setTitle("")
    setError("")
  }, [date])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = title.trim()
    if (!normalized) {
      setError("Enter a task name.")
      return
    }
    onSubmit({ date, title: normalized })
  }

  return (
    <form className="upcoming-calendar__quick-add" onSubmit={submit}>
      <label htmlFor="calendar-quick-add">New task for {date}</label>
      <input
        autoFocus
        id="calendar-quick-add"
        onChange={(event) => {
          setTitle(event.currentTarget.value)
          setError("")
        }}
        placeholder="What needs doing?"
        value={title}
      />
      <button type="submit">Add</button>
      <button onClick={onCancel} type="button">Cancel</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  )
}
