/**
 * Pure logic helpers for the AIControlPanel workspace board.
 * Journal lines use an em dash (U+2014) and local zero-padded 24h HH:MM.
 * "— pinned —" may legitimately hold the first line; the newest journal
 * marker always sits directly below it.
 */

const CLOCK = '([01]?\\d|2[0-3]):([0-5]\\d)'

export const JOURNAL_LINE_RE = new RegExp(
  `^\\u2014\\s*(update|heartbeat|REOPENED|PAUSED|RESUMED)\\s+${CLOCK}\\s*\\u2014`,
  'i',
)

const PINNED_LINE = '\u2014 pinned \u2014'

const PAUSED_FIRST_RE = new RegExp(`^\\u2014\\s*PAUSED\\s+${CLOCK}\\s*\\u2014`, 'i')

/** The first line that carries journal meaning: skips a leading "— pinned —" marker. */
function firstMeaningfulLine(description: string): string {
  const lines = description.split('\n')
  if (lines[0]?.trim() === PINNED_LINE) return lines[1] ?? ''
  return lines[0] ?? ''
}

export function isTaskPaused(description: string): boolean {
  return PAUSED_FIRST_RE.test(firstMeaningfulLine(description))
}

function formatClock(now: Date): string {
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function pausedPrefixLine(now: Date = new Date()): string {
  return `\u2014 PAUSED ${formatClock(now)} \u2014`
}

export function resumedPrefixLine(now: Date = new Date()): string {
  return `\u2014 RESUMED ${formatClock(now)} \u2014`
}

/**
 * Prepends a journal line as the newest entry. A leading "— pinned —" marker
 * keeps the first line (both apps key pin ordering off it); the new journal
 * line is inserted directly below it, preserving every existing character.
 */
export function prependJournalLine(description: string, line: string): string {
  const lines = description.split('\n')
  if (lines[0]?.trim() === PINNED_LINE) {
    return `${lines[0]}\n${line}\n${lines.slice(1).join('\n')}`
  }
  return `${line}\n${description}`
}

export interface PauseAllItem {
  id: string
  description?: string | null
  /** Optimistic in-flight flip from a momentary click (undefined = none pending). */
  pausedOverride?: boolean | undefined
}

/**
 * Pause-all / resume-all selection for a set of In Progress sessions. While any
 * session is still running the button pauses every running one; once everything
 * is paused it flips to resume-everything. Targets are only the sessions whose
 * effective state differs from `nextPaused` (an already-paused session is never
 * re-paused, a running one is never "resumed").
 */
export function pauseAllSelection(items: PauseAllItem[]): { nextPaused: boolean; targetIds: string[] } {
  const effective = (item: PauseAllItem): boolean => {
    const server = isTaskPaused(item.description ?? '')
    return item.pausedOverride !== undefined && item.pausedOverride !== server ? item.pausedOverride : server
  }
  const nextPaused = items.some((item) => !effective(item))
  const targetIds = items.filter((item) => effective(item) !== nextPaused).map((item) => item.id)
  return { nextPaused, targetIds }
}

// ---------------------------------------------------------------------------
// User-to-agent message / ORDER lines
//
// Messaging a session prepends `— message HH:MM — <text>` (below the pinned
// marker). Imperative one-shot orders (sub-agents, extra steps) use
// `— ORDER HH:MM — <instruction>` so agents can tell user commands apart from
// status updates they log themselves.
// ---------------------------------------------------------------------------

const MESSAGE_LINE_RE = new RegExp(`^\\u2014\\s*message\\s+((?:[01]?\\d|2[0-3]):[0-5]\\d)\\s*\\u2014\\s*(.*)$`, 'i')
const ORDER_LINE_RE = new RegExp(`^\\u2014\\s*ORDER\\s+(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*\\u2014\\s*(.*)$`, 'i')
const AGENTS_LINE_RE = /^[\u2014-]\s*agents\s+(\d+)\s*[\u2014-]/i
// Inline counts agents write inside update/ack/heartbeat lines, e.g.
// "created 4 agents", "3 sub-agents running (1 done, 1 streaming)".
const CREATED_AGENTS_RE = /(?:created|dispatched|spawned|launched|ordered)\s+(?:exactly\s+)?(\d+)\s+(?:sub-?\s*)?agents/i
const AGENTS_STATE_RE = /(\d+)\s+(?:sub-?\s*)?agents\s+(?:(?:are|still|now|currently)\s+)*(?:created|running|streaming|active|working|live|alive)/i
const DONE_AGENTS_RE = /(?:all\s+)?(?:\d+\s+)?(?:sub-?\s*)?agents\s+(?:are\s+)?(?:all\s+)?(?:done|finished|completed)/i
const NUDGE_BODY_PREFIX = 'unanswered message nudge:'

/** True when this line kind signals agent life and clears an awaiting-reply state. */
function isLifeSignalLine(line: string): boolean {
  return JOURNAL_LINE_RE.test(line)
}

export function messagePrefixLine(text: string, now: Date = new Date()): string {
  return `\u2014 message ${formatClock(now)} \u2014 ${text}`
}

export function orderPrefixLine(text: string, now: Date = new Date()): string {
  return `\u2014 ORDER ${formatClock(now)} \u2014 ${text}`
}

export function reopenedFromMessageLine(now: Date = new Date()): string {
  return `\u2014 REOPENED ${formatClock(now)} \u2014 continued by user message`
}

export function stepOrderLine(text: string, now: Date = new Date()): string {
  return orderPrefixLine(`do this now: ${text}; when finished continue exactly where you left off`, now)
}

export function subAgentsCreateLine(count: number, now: Date = new Date()): string {
  return orderPrefixLine(`sub-agents: create exactly ${count} sub-agents`, now)
}

export function subAgentsStopLine(now: Date = new Date()): string {
  return orderPrefixLine('sub-agents: stop all sub-agents now', now)
}

/**
 * Hand button order: forces the session to drop its current step and run the
 * /hand skill immediately. Body matches the Android client's buildOrderLine
 * ("hand", …) exactly so the bridge/relay demand matchers treat both apps'
 * lines identically.
 */
export function handOrderLine(now: Date = new Date()): string {
  return orderPrefixLine('hand: stop whatever you are doing right now and run /hand immediately', now)
}

/** Inline sub-agent count for one journal line; null when the line has none. */
function inlineAgentCount(line: string): number | null {
  const done = line.match(DONE_AGENTS_RE)
  if (done) return 0
  const created = line.match(CREATED_AGENTS_RE)
  if (created) return Number(created[1])
  const state = line.match(AGENTS_STATE_RE)
  // "3 agents running (1 done, 2 streaming)" — the leading count is the
  // exact number still running per the journal convention; the parenthetical
  // is a breakdown, never subtracted.
  if (state) return Number(state[1])
  return null
}

/**
 * Newest agent-count mention wins (newest lines are prepended first): the
 * dedicated `— agents N —` line or an inline "created N agents" / "N agents
 * running" mention in any journal or order line.
 */
export function parseAgentCount(description: string): number | null {
  for (const line of String(description ?? '').split('\n')) {
    const match = line.match(AGENTS_LINE_RE)
    if (match) {
      const count = Number(match[1])
      if (Number.isInteger(count) && count >= 0) return count
    }
    const inline = inlineAgentCount(line)
    if (inline != null && Number.isInteger(inline) && inline >= 0) return inline
  }
  return null
}

function clockLineToMs(time: string, now: Date): number {
  const [hours, minutes] = time.split(':').map(Number)
  const stamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
  if (stamp.getTime() > now.getTime() + 60_000) stamp.setDate(stamp.getDate() - 1)
  return stamp.getTime()
}

export interface PendingMessageState {
  /** True when the newest agent-relevant line is still the user's message. */
  pending: boolean;
  /** Seconds since the newest message line's HH:MM stamp. */
  elapsedSec: number;
  /** Nudge ORDER lines logged after the message (max 2, one per 90s). */
  nudges: number;
}

/**
 * Awaiting-reply state for a session card: pending while no update/heartbeat/
 * REOPENED/PAUSED/RESUMED line is newer than the newest `— message` line.
 * ORDER lines (our own nudges and user orders) do NOT clear it.
 */
export function pendingMessageState(description: string, now: Date = new Date()): PendingMessageState {
  const lines = String(description ?? '').split('\n')
  let messageIndex = -1
  let messageTime: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(MESSAGE_LINE_RE)
    if (match) {
      messageIndex = index
      messageTime = match[1]
      break
    }
  }
  if (messageIndex < 0 || !messageTime) return { pending: false, elapsedSec: 0, nudges: 0 }

  for (let index = 0; index < messageIndex; index += 1) {
    if (isLifeSignalLine(lines[index])) return { pending: false, elapsedSec: 0, nudges: 0 }
  }

  let nudges = 0
  for (let index = 0; index < messageIndex; index += 1) {
    const order = lines[index].match(ORDER_LINE_RE)
    if (order && order[1].trim().toLowerCase().startsWith(NUDGE_BODY_PREFIX)) nudges += 1
  }

  const elapsedSec = Math.max(0, Math.round((now.getTime() - clockLineToMs(messageTime, now)) / 1000))
  return { pending: true, elapsedSec, nudges }
}

export function finishedDeletableIds(
  tasks: ReadonlyArray<{ id: string; sectionId: string }>,
  finishedSectionId: string,
): string[] {
  return tasks.filter((task) => task.sectionId === finishedSectionId).map((task) => task.id)
}

// SLICE-DONE: backend-engineer
