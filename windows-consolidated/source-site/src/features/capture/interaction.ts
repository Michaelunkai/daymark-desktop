export type CaptureInteractionPhase = "closed" | "open";

export type CaptureInteractionAction =
  | "open"
  | "submit"
  | "newline"
  | "dismiss"
  | null;

export interface CaptureKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function getCaptureInteractionAction(
  event: CaptureKeyEvent,
  phase: CaptureInteractionPhase,
): CaptureInteractionAction {
  if (event.defaultPrevented || event.isComposing || event.altKey) {
    return null;
  }

  if (
    phase === "closed" &&
    event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key === " "
  ) {
    return "open";
  }

  if (phase === "open" && event.key === "Escape") {
    return "dismiss";
  }

  if (phase === "open" && event.key === "Enter") {
    return event.shiftKey ? "newline" : "submit";
  }

  return null;
}
