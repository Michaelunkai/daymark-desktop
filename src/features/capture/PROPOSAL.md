# Conversation Thought Capture

## Decision

Use a compact capture tray opened with `Ctrl+Shift+Space` on Windows/Linux and
`Cmd+Shift+Space` on macOS. The tray takes focus without navigating away from
the conversation:

1. Type one thought.
2. Press `Enter` to save it locally and close the tray.
3. Press `Shift+Enter` for a newline.
4. Press `Escape` to close the tray while keeping the draft.
5. Use an explicit discard action to remove a pending draft.

The success acknowledgement should be a small non-blocking status message, so
the conversation remains visible and usable.

## Local-first contract

- Pending drafts are stored per conversation id, with one unscoped bucket for
  captures opened without conversation context.
- A successful save creates a `CapturedThought` with only the text, source
  (`conversation`), optional conversation id, stable id, and local timestamp.
- The adapter writes to browser storage and keeps an in-memory copy if storage
  is unavailable. It performs no network request and requires no account.
- The model does not copy conversation messages, participant names, auth data,
  or provider metadata into the capture record.
- Empty or whitespace-only submissions stay open and are not persisted as
  captures.

## Integration seam

The host conversation surface owns the visual tray and calls the pure model
functions from `src/features/capture/index.ts`:

1. Read the snapshot from `createLocalThoughtCaptureStore`.
2. Call `openCapture(snapshot, conversationId)` when the shortcut fires.
3. Persist each `updateCaptureDraft` result so an interrupted thought can be
   resumed.
4. On `submitCapture`, persist the returned snapshot before showing success.
5. Treat `CapturedThought` as an inbox item for a later organizer flow. This
   slice intentionally does not create tasks, notes, routes, navigation items,
   or cloud records.

The host should ignore the global open shortcut while a modal or command
palette owns the same key event, and should pass through composition events
from IME input.
