/**
 * Smooth scrolling manager for the workspace board.
 * Reuses wheel-delta normalization from core/smooth-wheel.ts; degrades to native
 * scrolling under prefers-reduced-motion and never hijacks inputs or keyboard/scrollbar scrolling.
 */
import { normalizeWheelDelta } from '../../core/smooth-wheel';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isModifierHeld(event: WheelEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
}

/** Finds the nearest ancestor (or self) of the event target that can scroll vertically. */
function findScrollableAncestor(start: HTMLElement | null, root: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start;
  while (node && node !== root.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

export function attachBoardScroll(container: HTMLElement): () => void {
  if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
    return () => {};
  }

  let frame = 0;
  const targets = new Map<HTMLElement, { position: number; velocity: number }>();

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented) return;
    if (isModifierHeld(event) || isEditableTarget(event.target)) return;
    // Let horizontal/zoom gestures and plain non-vertical deltas stay native.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const start = event.target instanceof HTMLElement ? event.target : null;
    const scroller = findScrollableAncestor(start, container) ?? container;
    let state = targets.get(scroller);
    if (!state) {
      state = { position: scroller.scrollTop, velocity: 0 };
      targets.set(scroller, state);
    } else {
      // Re-sync with the real scroll position: native wheel inertia, scrollbar
      // drags, and keyboard scrolls all move it outside this loop.
      state.position = scroller.scrollTop;
    }
    const delta = normalizeWheelDelta(event);
    state.velocity += delta;

    if (frame === 0) {
      const step = () => {
        frame = 0;
        for (const [node, s] of targets) {
          const next = s.position + s.velocity;
          s.position += (next - s.position) * 0.35;
          s.velocity *= 0.72;
          if (Math.abs(s.velocity) < 0.4) {
            s.velocity = 0;
          }
          node.scrollTop = s.position;
        }
        let idle = true;
        for (const s of targets.values()) {
          if (Math.abs(s.velocity) > 0.01) idle = false;
        }
        if (!idle) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    }
  };

  container.addEventListener('wheel', onWheel, { passive: true });

  return () => {
    container.removeEventListener('wheel', onWheel);
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
    targets.clear();
  };
}

export function scrollToSection(container: HTMLElement, columnIndex: number): void {
  const columns = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const column = columns[Math.max(0, Math.min(columnIndex, columns.length - 1))];
  if (!column) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  column.scrollIntoView({ behavior, inline: 'start', block: 'nearest' });
}

// SLICE-DONE: performance-optimizer
