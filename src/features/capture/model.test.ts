import {
  createEmptyCaptureSnapshot,
  createLocalThoughtCaptureStore,
  discardCapture,
  dismissCapture,
  openCapture,
  parseCaptureSnapshot,
  submitCapture,
  updateCaptureDraft,
} from "./model";
import { getCaptureInteractionAction } from "./interaction";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const NOW = "2026-08-03T10:00:00.000Z";
const LATER = "2026-08-03T10:00:03.000Z";

let snapshot = createEmptyCaptureSnapshot();
let session = openCapture(snapshot, "conversation-42");
assert(session.isOpen && session.draft === null, "Opening a conversation should start with an empty draft.");

({ snapshot, session } = updateCaptureDraft(snapshot, session, "  Remember the pricing question  ", LATER));
assert(snapshot.drafts["conversation-42"]?.text === "  Remember the pricing question  ", "Draft text must preserve typed spacing.");
assert(session.draft?.conversationId === "conversation-42", "Drafts must retain conversation provenance locally.");

const submitted = submitCapture(snapshot, session, "thought-1", LATER);
assert(submitted.ok, "A non-empty thought should submit.");
if (submitted.ok) {
  assert(submitted.capture.text === "Remember the pricing question", "Submission should trim only the saved thought.");
  assert(submitted.capture.conversationId === "conversation-42", "Saved thoughts should retain only the conversation id.");
  assert(!submitted.snapshot.drafts["conversation-42"], "Successful submission should clear its pending draft.");
  assert(submitted.snapshot.captures[0].id === "thought-1", "Successful submission should add a local capture.");
}

const emptySession = openCapture(createEmptyCaptureSnapshot(), null);
const emptyResult = submitCapture(createEmptyCaptureSnapshot(), emptySession, "thought-empty", NOW);
assert(!emptyResult.ok && emptyResult.reason === "empty", "Whitespace-only capture must remain open and unsaved.");

let retainedSnapshot = createEmptyCaptureSnapshot();
let retainedSession = openCapture(retainedSnapshot, "conversation-7");
({ snapshot: retainedSnapshot, session: retainedSession } = updateCaptureDraft(
  retainedSnapshot,
  retainedSession,
  "Keep this while I check one more thing",
  NOW,
));
retainedSession = dismissCapture(retainedSession);
assert(!retainedSession.isOpen, "Escape dismissal should close the capture surface.");
assert(retainedSnapshot.drafts["conversation-7"], "Dismissal should preserve the local draft for quick resume.");
({ snapshot: retainedSnapshot, session: retainedSession } = discardCapture(retainedSnapshot, retainedSession));
assert(!retainedSnapshot.drafts["conversation-7"], "Explicit discard should remove the pending local draft.");

const storageValues = new Map<string, string>();
const store = createLocalThoughtCaptureStore({
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => void storageValues.set(key, value),
});
store.write({ ...createEmptyCaptureSnapshot(), captures: submitted.ok ? [submitted.capture] : [] });
assert(store.read().captures[0]?.id === "thought-1", "The local store should round-trip captured thoughts.");
storageValues.set("daymark.thought-capture.v1", "{broken");
assert(store.read().version === 1 && store.read().captures.length === 1, "Malformed storage must fall back to the last memory copy.");
assert(parseCaptureSnapshot({ version: 999 }).captures.length === 0, "Unsupported capture versions must fail closed.");

const baseKeyEvent = {
  altKey: false,
  ctrlKey: true,
  defaultPrevented: false,
  isComposing: false,
  key: " ",
  metaKey: false,
  shiftKey: true,
};
assert(getCaptureInteractionAction(baseKeyEvent, "closed") === "open", "Ctrl Shift Space should open capture.");
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, ctrlKey: false, metaKey: true }, "closed") === "open",
  "Cmd Shift Space should open capture on macOS.",
);
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, altKey: true }, "closed") === null,
  "Alt-modified capture shortcuts must remain available to the host.",
);
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, key: "Enter", shiftKey: false }, "open") === "submit",
  "Enter should submit the focused thought.",
);
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, key: "Enter" }, "open") === "newline",
  "Shift Enter should insert a newline.",
);
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, key: "Escape", shiftKey: false }, "open") === "dismiss",
  "Escape should dismiss without discarding the draft.",
);
assert(
  getCaptureInteractionAction({ ...baseKeyEvent, defaultPrevented: true }, "closed") === null,
  "Already handled keyboard events must not open another capture surface.",
);

console.log("CAPTURE_MODEL_TESTS_OK");
