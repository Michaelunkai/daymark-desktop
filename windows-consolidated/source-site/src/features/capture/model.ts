export const CAPTURE_STORAGE_VERSION = 1 as const;
export const CAPTURE_STORAGE_KEY = "daymark.thought-capture.v1";
const UNSCOPED_DRAFT_KEY = "__unscoped__";

export type CaptureOrigin = "conversation";

export interface CapturedThought {
  id: string;
  text: string;
  origin: CaptureOrigin;
  conversationId: string | null;
  capturedAt: string;
}

export interface ThoughtCaptureDraft {
  text: string;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThoughtCaptureSnapshot {
  version: typeof CAPTURE_STORAGE_VERSION;
  drafts: Record<string, ThoughtCaptureDraft>;
  captures: CapturedThought[];
}

export interface ThoughtCaptureStore {
  read(): ThoughtCaptureSnapshot;
  write(snapshot: ThoughtCaptureSnapshot): void;
}

export interface CaptureSession {
  isOpen: boolean;
  draftKey: string;
  draft: ThoughtCaptureDraft | null;
  status: "idle" | "empty" | "saved";
  lastCapturedId: string | null;
}

export type CaptureSubmitResult =
  | {
      ok: true;
      capture: CapturedThought;
      snapshot: ThoughtCaptureSnapshot;
      session: CaptureSession;
    }
  | {
      ok: false;
      reason: "empty";
      snapshot: ThoughtCaptureSnapshot;
      session: CaptureSession;
    };

export function createEmptyCaptureSnapshot(): ThoughtCaptureSnapshot {
  return {
    version: CAPTURE_STORAGE_VERSION,
    drafts: {},
    captures: [],
  };
}

export function createLocalThoughtCaptureStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  key = CAPTURE_STORAGE_KEY,
): ThoughtCaptureStore {
  let memorySnapshot = createEmptyCaptureSnapshot();

  return {
    read: () => {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return memorySnapshot;
        const parsed = parseCaptureSnapshot(JSON.parse(raw));
        memorySnapshot = parsed;
        return parsed;
      } catch {
        return memorySnapshot;
      }
    },
    write: (snapshot) => {
      memorySnapshot = cloneSnapshot(snapshot);
      try {
        storage?.setItem(key, JSON.stringify(memorySnapshot));
      } catch {
        // Keep the in-memory copy usable when browser storage is blocked.
      }
    },
  };
}

export function openCapture(
  snapshot: ThoughtCaptureSnapshot,
  conversationId: string | null | undefined,
): CaptureSession {
  const draftKey = getDraftKey(conversationId);
  const existing = snapshot.drafts[draftKey];
  return {
    isOpen: true,
    draftKey,
    draft: existing ? cloneDraft(existing) : null,
    status: "idle",
    lastCapturedId: null,
  };
}

export function updateCaptureDraft(
  snapshot: ThoughtCaptureSnapshot,
  session: CaptureSession,
  text: string,
  now: string,
): { snapshot: ThoughtCaptureSnapshot; session: CaptureSession } {
  const previous = session.draft;
  const draft: ThoughtCaptureDraft = {
    text,
    conversationId: previous?.conversationId ?? conversationIdFromKey(session.draftKey),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const nextSnapshot = cloneSnapshot(snapshot);
  nextSnapshot.drafts[session.draftKey] = draft;
  return {
    snapshot: nextSnapshot,
    session: {
      ...session,
      draft: cloneDraft(draft),
      status: "idle",
      lastCapturedId: null,
    },
  };
}

export function dismissCapture(session: CaptureSession): CaptureSession {
  return {
    ...session,
    isOpen: false,
    status: "idle",
    lastCapturedId: null,
  };
}

export function discardCapture(
  snapshot: ThoughtCaptureSnapshot,
  session: CaptureSession,
): { snapshot: ThoughtCaptureSnapshot; session: CaptureSession } {
  const nextSnapshot = cloneSnapshot(snapshot);
  delete nextSnapshot.drafts[session.draftKey];
  return {
    snapshot: nextSnapshot,
    session: {
      ...session,
      isOpen: false,
      draft: null,
      status: "idle",
      lastCapturedId: null,
    },
  };
}

export function submitCapture(
  snapshot: ThoughtCaptureSnapshot,
  session: CaptureSession,
  id: string,
  now: string,
): CaptureSubmitResult {
  const text = session.draft?.text.trim() ?? "";
  if (!text) {
    return {
      ok: false,
      reason: "empty",
      snapshot,
      session: { ...session, status: "empty" },
    };
  }

  const capture: CapturedThought = {
    id,
    text,
    origin: "conversation",
    conversationId: session.draft?.conversationId ?? conversationIdFromKey(session.draftKey),
    capturedAt: now,
  };
  const nextSnapshot = cloneSnapshot(snapshot);
  delete nextSnapshot.drafts[session.draftKey];
  nextSnapshot.captures = [capture, ...nextSnapshot.captures.filter((item) => item.id !== id)];

  return {
    ok: true,
    capture,
    snapshot: nextSnapshot,
    session: {
      ...session,
      isOpen: false,
      draft: null,
      status: "saved",
      lastCapturedId: id,
    },
  };
}

export function parseCaptureSnapshot(value: unknown): ThoughtCaptureSnapshot {
  if (!isRecord(value) || value.version !== CAPTURE_STORAGE_VERSION) {
    return createEmptyCaptureSnapshot();
  }

  const drafts = isRecord(value.drafts)
    ? Object.entries(value.drafts).reduce<Record<string, ThoughtCaptureDraft>>((result, [key, draft]) => {
        if (isDraft(draft)) result[key] = cloneDraft(draft);
        return result;
      }, {})
    : {};
  const captures = Array.isArray(value.captures)
    ? value.captures.filter(isCapturedThought).map((capture) => ({ ...capture }))
    : [];

  return { version: CAPTURE_STORAGE_VERSION, drafts, captures };
}

function getDraftKey(conversationId: string | null | undefined): string {
  return conversationId?.trim() || UNSCOPED_DRAFT_KEY;
}

function conversationIdFromKey(draftKey: string): string | null {
  return draftKey === UNSCOPED_DRAFT_KEY ? null : draftKey;
}

function cloneSnapshot(snapshot: ThoughtCaptureSnapshot): ThoughtCaptureSnapshot {
  return {
    version: CAPTURE_STORAGE_VERSION,
    drafts: Object.fromEntries(
      Object.entries(snapshot.drafts).map(([key, draft]) => [key, cloneDraft(draft)]),
    ),
    captures: snapshot.captures.map((capture) => ({ ...capture })),
  };
}

function cloneDraft(draft: ThoughtCaptureDraft): ThoughtCaptureDraft {
  return { ...draft };
}

function isDraft(value: unknown): value is ThoughtCaptureDraft {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    (typeof value.conversationId === "string" || value.conversationId === null) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isCapturedThought(value: unknown): value is CapturedThought {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    value.origin === "conversation" &&
    (typeof value.conversationId === "string" || value.conversationId === null) &&
    typeof value.capturedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
