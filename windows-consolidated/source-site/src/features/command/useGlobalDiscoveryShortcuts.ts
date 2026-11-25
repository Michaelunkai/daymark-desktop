import { useEffect, useRef } from "react";
import { getDiscoveryShortcutAction } from "./shortcut-events";

export interface GlobalDiscoveryShortcuts {
  onOpenCommand: () => void;
  onOpenSearch: () => void;
  onOpenShortcutHelp: () => void;
}

export function useGlobalDiscoveryShortcuts({
  onOpenCommand,
  onOpenSearch,
  onOpenShortcutHelp,
}: GlobalDiscoveryShortcuts): void {
  const callbacksRef = useRef({ onOpenCommand, onOpenSearch, onOpenShortcutHelp });
  callbacksRef.current = { onOpenCommand, onOpenSearch, onOpenShortcutHelp };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getDiscoveryShortcutAction(event, isEditableTarget(event.target));
      if (action === "command") {
        event.preventDefault();
        callbacksRef.current.onOpenCommand();
        return;
      }

      if (action === "search") {
        event.preventDefault();
        callbacksRef.current.onOpenSearch();
        return;
      }

      if (action === "shortcut-help") {
        event.preventDefault();
        callbacksRef.current.onOpenShortcutHelp();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
