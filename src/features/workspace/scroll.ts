/**
 * Native scrolling law (round 3): Daymark NEVER hijacks the wheel. The
 * browser's compositor scroll is faster and keeps working smoothly even when
 * the process is busy. attachBoardScroll intentionally installs nothing;
 * scrollToSection stays for programmatic jumps (CSS smooth is fine there).
 */
export function attachBoardScroll(_container: HTMLElement): () => void {
  return () => {};
}

export function scrollToSection(container: HTMLElement, columnIndex: number): void {
  const columns = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const column = columns[Math.max(0, Math.min(columnIndex, columns.length - 1))];
  if (!column) return;
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  column.scrollIntoView({ behavior, inline: 'start', block: 'nearest' });
}
