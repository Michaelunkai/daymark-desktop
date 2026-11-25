import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { filterCommands } from "./command-filter";
import "./command.css";

export interface CommandDefinition {
  id: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  shortcut?: string;
}

export interface CommandPaletteProps {
  commands: readonly CommandDefinition[];
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: (commandId: string) => void;
}

export function CommandPalette({
  commands,
  isOpen,
  onClose,
  onRunCommand,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const matchingCommands = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [onClose]);

  const runCommand = useCallback(
    (commandId: string) => {
      onRunCommand(commandId);
      close();
    },
    [close, onRunCommand],
  );

  const moveActive = useCallback(
    (offset: number) => {
      setActiveIndex((currentIndex) => {
        if (matchingCommands.length === 0) {
          return 0;
        }

        return (currentIndex + offset + matchingCommands.length) % matchingCommands.length;
      });
    },
    [matchingCommands.length],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveActive(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveActive(-1);
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(Math.max(0, matchingCommands.length - 1));
          break;
        case "Enter": {
          event.preventDefault();
          const command = matchingCommands[activeIndex];
          if (command) {
            runCommand(command.id);
          }
          break;
        }
        case "Escape":
          event.preventDefault();
          close();
          break;
      }
    },
    [activeIndex, close, matchingCommands, moveActive, runCommand],
  );

  const handleOverlayMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        close();
      }
    },
    [close],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="command-overlay" onMouseDown={handleOverlayMouseDown}>
      <section aria-labelledby={titleId} aria-modal="true" className="command-dialog" role="dialog">
        <header className="command-dialog__header">
          <h2 id={titleId}>Command center</h2>
          <button aria-label="Close command center" className="command-close" onClick={close} type="button">
            <span aria-hidden="true">x</span>
          </button>
        </header>
        <label className="command-input">
          <span className="sr-only">Find an action</span>
          <input
            aria-activedescendant={
              matchingCommands[activeIndex] ? `${listId}-${matchingCommands[activeIndex].id}` : undefined
            }
            aria-controls={listId}
            aria-expanded="true"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Find an action"
            ref={inputRef}
            role="combobox"
            type="text"
            value={query}
          />
        </label>
        <div aria-label="Commands" className="command-results" id={listId} role="listbox">
          {matchingCommands.length === 0 ? (
            <p className="command-empty">No actions match that search.</p>
          ) : (
            matchingCommands.map((command, index) => (
              <button
                aria-selected={index === activeIndex}
                className="command-row"
                id={`${listId}-${command.id}`}
                key={command.id}
                onClick={() => runCommand(command.id)}
                onMouseMove={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="command-row__copy">
                  <strong>{command.label}</strong>
                  {command.description ? <small>{command.description}</small> : null}
                </span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
