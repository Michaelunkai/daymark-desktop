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
import {
  flattenSearchGroups,
  rankSearchRecords,
  type SearchRecord,
  type SearchResult,
} from "./search-index";
import "./search.css";

export interface SearchDialogProps {
  isOpen: boolean;
  records: readonly SearchRecord[];
  onClose: () => void;
  onSelect: (record: SearchResult) => void;
  initialQuery?: string;
  title?: string;
}

export function SearchDialog({
  isOpen,
  records,
  onClose,
  onSelect,
  initialQuery = "",
  title = "Search",
}: SearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const groups = useMemo(() => rankSearchRecords(records, query), [query, records]);
  const results = useMemo(() => flattenSearchGroups(groups), [groups]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(initialQuery);
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [initialQuery, isOpen]);

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [onClose]);

  const selectActive = useCallback(() => {
    const result = results[activeIndex];
    if (!result) {
      return;
    }

    onSelect(result);
    close();
  }, [activeIndex, close, onSelect, results]);

  const moveActive = useCallback(
    (offset: number) => {
      setActiveIndex((currentIndex) => {
        if (results.length === 0) {
          return 0;
        }

        return (currentIndex + offset + results.length) % results.length;
      });
    },
    [results.length],
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
          setActiveIndex(Math.max(0, results.length - 1));
          break;
        case "Enter":
          event.preventDefault();
          selectActive();
          break;
        case "Escape":
          event.preventDefault();
          close();
          break;
      }
    },
    [close, moveActive, results.length, selectActive],
  );

  const handleOverlayMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        close();
      }
    },
    [close],
  );

  const getResultId = useCallback(
    (result: SearchResult) => `${listId}-${result.type}-${result.id}`,
    [listId],
  );

  if (!isOpen) {
    return null;
  }

  let resultIndex = -1;
  return (
    <div className="discovery-overlay" onMouseDown={handleOverlayMouseDown}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="discovery-dialog"
        role="dialog"
      >
        <header className="discovery-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <button aria-label="Close search" className="discovery-icon-button" onClick={close} type="button">
            <span aria-hidden="true">x</span>
          </button>
        </header>
        <label className="discovery-search-field">
          <span className="sr-only">Search tasks, projects, and views</span>
          <input
            aria-activedescendant={results[activeIndex] ? getResultId(results[activeIndex]) : undefined}
            aria-controls={listId}
            aria-expanded="true"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, and views"
            ref={inputRef}
            role="combobox"
            type="search"
            value={query}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </label>
        <div aria-label="Search results" className="discovery-results" id={listId} role="listbox">
          {groups.length === 0 ? (
            <p className="discovery-empty">No matches found.</p>
          ) : (
            groups.map((group) => (
              <div className="discovery-group" key={group.type}>
                <h3>{group.label}</h3>
                {group.results.map((result) => {
                  resultIndex += 1;
                  const index = resultIndex;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      aria-selected={isActive}
                      className="discovery-row"
                      id={getResultId(result)}
                      key={result.id}
                      onClick={() => {
                        onSelect(result);
                        close();
                      }}
                      onMouseMove={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <span className="discovery-row__type">{result.type}</span>
                      <span className="discovery-row__content">
                        <strong>{result.title}</strong>
                        {result.subtitle ? <small>{result.subtitle}</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
