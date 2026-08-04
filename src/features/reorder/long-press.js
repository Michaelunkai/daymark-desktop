export const LONG_PRESS_DELAY = 520
export const LONG_PRESS_MOVE_TOLERANCE = 10

export function createLongPressReorderController({
  onCancel,
  onLongPress,
  delay = LONG_PRESS_DELAY,
  moveTolerance = LONG_PRESS_MOVE_TOLERANCE,
  scheduler = globalThis,
}) {
  let pointerId = null
  let startX = 0
  let startY = 0
  let timer = null
  let triggered = false
  let suppressClick = false

  const clearTimer = () => {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
  }

  const resetPress = () => {
    clearTimer()
    pointerId = null
    startX = 0
    startY = 0
  }

  const cancelPress = (event) => {
    if (pointerId !== null && event?.pointerId !== pointerId) return
    const wasTriggered = triggered
    resetPress()
    triggered = false
    if (!wasTriggered) onCancel?.()
  }

  return {
    pointerDown(event) {
      if (event?.isPrimary === false || (event?.button !== undefined && event.button !== 0)) return
      resetPress()
      pointerId = event?.pointerId ?? 0
      startX = event?.clientX ?? 0
      startY = event?.clientY ?? 0
      triggered = false
      timer = scheduler.setTimeout(() => {
        timer = null
        triggered = true
        suppressClick = true
        onLongPress()
      }, delay)
    },
    pointerMove(event) {
      if (pointerId === null || event?.pointerId !== pointerId || triggered) return
      const deltaX = (event?.clientX ?? 0) - startX
      const deltaY = (event?.clientY ?? 0) - startY
      if (Math.hypot(deltaX, deltaY) > moveTolerance) cancelPress(event)
    },
    pointerUp(event) {
      if (pointerId === null || event?.pointerId !== pointerId) return
      clearTimer()
      pointerId = null
      startX = 0
      startY = 0
      triggered = false
    },
    pointerCancel(event) {
      cancelPress(event)
    },
    consumeSuppressedClick() {
      const wasSuppressed = suppressClick
      suppressClick = false
      return wasSuppressed
    },
    dispose() {
      resetPress()
      triggered = false
      suppressClick = false
    },
  }
}

export function moveInOrder(items, selectedId, direction) {
  const index = items.indexOf(selectedId)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  return next
}
