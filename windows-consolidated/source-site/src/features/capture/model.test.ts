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
import {
  applyClipboardToDraft,
  buildQuickOrderInput,
  buildQuickTaskInput,
  createQuickOrderDraftFromTask,
  createQuickSearchEntries,
  createQuickTaskDraftFromOrder,
  findQuickMatches,
  getQuickSaveAction,
  resolveSectionForProject,
} from "./quick-capture-model";

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

const quickEntries = createQuickSearchEntries({
  projects: [{ id: "work", name: "Work" }],
  sections: [{ id: "plan", name: "Planning", projectId: "work" }],
  tasks: [{
    id: "task-1",
    content: "Prepare launch notes",
    description: "Include Android keyboard flow",
    projectId: "work",
    sectionId: "plan",
    due: { date: "2026-08-20", time: "09:30" },
    priority: 2,
    updatedAt: "2026-08-19T12:00:00.000Z",
  }],
  orderItems: [{
    id: "order-1",
    title: "Call release owner",
    details: "Confirm original signer",
    lane: "now",
    priority: 1,
    updatedAt: "2026-08-19T11:00:00.000Z",
  }],
});
assert(
  findQuickMatches(quickEntries, "keyboard planning")[0]?.id === "task-1",
  "Quick finder should locate tasks through compact details and destination context.",
);
assert(
  findQuickMatches(quickEntries, "release owner")[0]?.id === "order-1",
  "Quick finder should locate Order items from their title.",
);

const pastedTask = applyClipboardToDraft(
  { title: "", details: "", projectId: "work", sectionId: "plan", date: "", time: "", priority: 4 },
  "Prepare demo\nRecord Android one-hand flow",
);
assert(
  pastedTask.title === "Prepare demo" && pastedTask.details === "Record Android one-hand flow",
  "Clipboard capture should split a first line into the title and retain remaining detail lines.",
);
const appendedTask = applyClipboardToDraft(pastedTask, "Include screenshots");
assert(
  appendedTask.title === "Prepare demo" && appendedTask.details.endsWith("Include screenshots"),
  "Clipboard capture should append context without replacing a typed title or details.",
);

const taskInput = buildQuickTaskInput({
  title: "Move me",
  details: "Preserve every destination field",
  projectId: "work",
  sectionId: "plan",
  date: "2026-08-20",
  time: "09:30",
  priority: 2,
});
assert(
  taskInput.projectId === "work" &&
    taskInput.sectionId === "plan" &&
    taskInput.due?.date === "2026-08-20" &&
    taskInput.due?.time === "09:30",
  "Task save payloads must retain project, section, date, and time together.",
);
const orderInput = buildQuickOrderInput({
  title: "Follow up",
  details: "Keep lane relation",
  lane: "after",
  relationId: "order-1",
  priority: 3,
});
assert(
  orderInput.lane === "after" && orderInput.relationId === "order-1",
  "Order save payloads must retain the selected After destination.",
);
assert(
  buildQuickOrderInput({ ...orderInput, lane: "later" }).relationId === null,
  "Order save payloads must clear a relation only when the destination no longer supports one.",
);
assert(
  resolveSectionForProject("work", "plan", [{ id: "plan", name: "Planning", projectId: "work" }]) === "plan" &&
    resolveSectionForProject("other", "plan", [{ id: "plan", name: "Planning", projectId: "work" }]) === "",
  "Quick project changes should restore only compatible remembered sections.",
);
const conversionTask = {
  title: "Keep the launch plan",
  details: "Preserve title and detail context",
  priority: 1,
  projectId: "work",
  sectionId: "plan",
  date: "2026-08-20",
  time: "09:30",
};
const convertedOrderDraft = createQuickOrderDraftFromTask(conversionTask);
assert(
  convertedOrderDraft.title === conversionTask.title &&
    convertedOrderDraft.details === conversionTask.details &&
    convertedOrderDraft.priority === conversionTask.priority &&
    convertedOrderDraft.lane === "now",
  "Task-to-Order conversion should preserve content and priority while opening an explicit Order destination.",
);
const conversionOrder = {
  title: "Return to project work",
  details: "Retain the release context",
  priority: 2,
  lane: "after",
  relationId: "order-1",
};
const convertedTaskDraft = createQuickTaskDraftFromOrder(conversionOrder, "work");
assert(
  convertedTaskDraft.title === conversionOrder.title &&
    convertedTaskDraft.details === conversionOrder.details &&
    convertedTaskDraft.priority === conversionOrder.priority &&
    convertedTaskDraft.projectId === "work" &&
    convertedTaskDraft.date === "",
  "Order-to-task conversion should preserve content and priority while opening a task destination.",
);
assert(
  getQuickSaveAction("task", null) === "save-task" &&
    getQuickSaveAction("order", null) === "save-order" &&
    getQuickSaveAction("order", { from: "task", sourceId: "task-1" }) === "convert-task-to-order" &&
    getQuickSaveAction("task", { from: "order", sourceId: "order-1" }) === "convert-order-to-task",
  "Conversion callbacks should be selected only from an explicit conversion state.",
);

console.log("CAPTURE_MODEL_TESTS_OK");
