const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;
const DISCRETE_WHEEL_THRESHOLD = 32;
const WHEEL_DISTANCE_SCALE = 1.08;
const EASING_FACTOR = 0.24;
const SETTLED_DISTANCE = 1.5;
const ACTIVE_SCROLL_CLASS = "daymark-smooth-wheel-active";
const NEAR_EMPTY_MAIN_SCROLL_LIMIT = 320;

type ScrollAxis = "x" | "y";

type ScrollTarget = {
  axis: ScrollAxis;
  element: HTMLElement;
};

type ScrollAnimation = {
  axis: ScrollAxis;
  frame: number;
  target: number;
};

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  viewportSize: number,
): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, viewportSize);
  return delta;
}

export function isDiscreteMouseWheel(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): boolean {
  return deltaMode !== 0
    || Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= DISCRETE_WHEEL_THRESHOLD;
}

export function nextSmoothScrollPosition(current: number, target: number): number {
  if (Math.abs(target - current) <= SETTLED_DISTANCE) return target;
  return current + ((target - current) * EASING_FACTOR);
}

function maxScroll(element: HTMLElement, axis: ScrollAxis): number {
  return axis === "y"
    ? Math.max(0, element.scrollHeight - element.clientHeight)
    : Math.max(0, element.scrollWidth - element.clientWidth);
}

function currentScroll(element: HTMLElement, axis: ScrollAxis): number {
  return axis === "y" ? element.scrollTop : element.scrollLeft;
}

function setCurrentScroll(element: HTMLElement, axis: ScrollAxis, value: number) {
  if (axis === "y") element.scrollTop = value;
  else element.scrollLeft = value;
}

function canScroll(element: HTMLElement, axis: ScrollAxis, delta: number): boolean {
  const maximum = maxScroll(element, axis);
  if (maximum <= 0) return false;
  const current = currentScroll(element, axis);
  return delta < 0 ? current > 0 : current < maximum;
}

function hasScrollableOverflow(element: HTMLElement, axis: ScrollAxis): boolean {
  const style = getComputedStyle(element);
  return SCROLLABLE_OVERFLOW.test(axis === "y" ? style.overflowY : style.overflowX);
}

function findScrollTarget(
  path: EventTarget[],
  axis: ScrollAxis,
  delta: number,
): ScrollTarget | null {
  for (const candidate of path) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (!hasScrollableOverflow(candidate, axis)) continue;
    if (canScroll(candidate, axis, delta)) return { axis, element: candidate };
  }
  return null;
}

function findVisibleSidebarFallback(
  targetWindow: Window,
  axis: ScrollAxis,
  delta: number,
): ScrollTarget | null {
  if (axis !== "y") return null;
  const sidebar = targetWindow.document.querySelector<HTMLElement>(".sidebar__scroll");
  if (!sidebar || !hasScrollableOverflow(sidebar, axis) || !canScroll(sidebar, axis, delta)) {
    return null;
  }
  const rect = sidebar.getBoundingClientRect();
  if (
    rect.width <= 0
    || rect.height <= 0
    || rect.right <= 0
    || rect.bottom <= 0
    || rect.left >= targetWindow.innerWidth
    || rect.top >= targetWindow.innerHeight
  ) {
    return null;
  }
  return { axis, element: sidebar };
}

export function installSmoothWheelScrolling(targetWindow: Window = window): () => void {
  const animations = new WeakMap<HTMLElement, ScrollAnimation>();
  const reducedMotion = targetWindow.matchMedia("(prefers-reduced-motion: reduce)");

  const animate = (element: HTMLElement) => {
    const animation = animations.get(element);
    if (!animation) return;
    const current = currentScroll(element, animation.axis);
    const next = nextSmoothScrollPosition(current, animation.target);
    setCurrentScroll(element, animation.axis, next);
    if (next === animation.target) {
      element.classList.remove(ACTIVE_SCROLL_CLASS);
      animations.delete(element);
      return;
    }
    animation.frame = targetWindow.requestAnimationFrame(() => animate(element));
  };

  const enqueue = (scrollTarget: ScrollTarget, delta: number) => {
    const { axis, element } = scrollTarget;
    const maximum = maxScroll(element, axis);
    const previous = animations.get(element);
    if (previous && previous.axis !== axis) {
      targetWindow.cancelAnimationFrame(previous.frame);
      element.classList.remove(ACTIVE_SCROLL_CLASS);
      animations.delete(element);
    }
    const active = animations.get(element);
    const startingPoint = active?.target ?? currentScroll(element, axis);
    const nextTarget = Math.min(maximum, Math.max(0, startingPoint + (delta * WHEEL_DISTANCE_SCALE)));
    if (active) {
      active.target = nextTarget;
      return;
    }
    const animation: ScrollAnimation = { axis, frame: 0, target: nextTarget };
    animations.set(element, animation);
    element.classList.add(ACTIVE_SCROLL_CLASS);
    animation.frame = targetWindow.requestAnimationFrame(() => animate(element));
  };

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || reducedMotion.matches) return;
    if (!isDiscreteMouseWheel(event.deltaX, event.deltaY, event.deltaMode)) return;

    const path = event.composedPath();
    const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, targetWindow.innerHeight);
    const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode, targetWindow.innerWidth);
    const prefersHorizontal = event.shiftKey || Math.abs(deltaX) > Math.abs(deltaY);
    let scrollTarget = prefersHorizontal
      ? findScrollTarget(path, "x", deltaX || deltaY)
      : findScrollTarget(path, "y", deltaY);
    let delta = prefersHorizontal ? (deltaX || deltaY) : deltaY;

    if (
      !prefersHorizontal
      && deltaY !== 0
      && (
        !scrollTarget
        || (
          scrollTarget.element.matches(".main-content")
          && maxScroll(scrollTarget.element, "y") <= NEAR_EMPTY_MAIN_SCROLL_LIMIT
        )
      )
    ) {
      scrollTarget = findVisibleSidebarFallback(targetWindow, "y", deltaY) ?? scrollTarget;
      delta = deltaY;
    }
    if (!scrollTarget && !prefersHorizontal && deltaY !== 0) {
      scrollTarget = findScrollTarget(path, "x", deltaY);
      delta = deltaY;
    }
    if (!scrollTarget || delta === 0) return;

    event.preventDefault();
    enqueue(scrollTarget, delta);
  };

  targetWindow.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => targetWindow.removeEventListener("wheel", onWheel, { capture: true });
}
