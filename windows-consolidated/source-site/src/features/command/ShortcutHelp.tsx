import { useCallback, useEffect, useId, useRef } from "react";
import "./command.css";

export interface ShortcutHelpEntry {
  keys: string;
  description: string;
}

export interface ShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts?: readonly ShortcutHelpEntry[];
}

const DEFAULT_SHORTCUTS: readonly ShortcutHelpEntry[] = [
  { keys: "Ctrl K", description: "Open command center" },
  { keys: "/", description: "Open search" },
  { keys: "?", description: "Show keyboard shortcuts" },
  { keys: "Ctrl 1", description: "Open Inbox" },
  { keys: "Ctrl 2", description: "Open Today" },
  { keys: "Ctrl 3", description: "Open Upcoming" },
  { keys: "Esc", description: "Close a dialog or menu" },
];

export function ShortcutHelp({
  isOpen,
  onClose,
  shortcuts = DEFAULT_SHORTCUTS,
}: ShortcutHelpProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="command-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <section aria-labelledby={titleId} aria-modal="true" className="shortcut-dialog" role="dialog">
        <header className="command-dialog__header">
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <button
            aria-label="Close keyboard shortcuts"
            className="command-close"
            onClick={close}
            ref={closeButtonRef}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
        </header>
        <dl className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={`${shortcut.keys}-${shortcut.description}`}>
              <dt><kbd>{shortcut.keys}</kbd></dt>
              <dd>{shortcut.description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
