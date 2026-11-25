export const LONG_PRESS_DELAY = 520
export const LONG_PRESS_MOVE_TOLERANCE = 10

export function createLongPressReorderController({
  onCancel,
  onDragEnd,
  onDragMove,
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
  let dragMoved = false
  let movedBeforeTrigger = false
  let suppressClick = false

  const clearTimer = () => {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
  }

  const triggerReorder = () => {
    clearTimer()
    triggered = true
    dragMoved = false
    suppressClick = true
    onLongPress()
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
    dragMoved = false
    movedBeforeTrigger = false
    if (!wasTriggered) onCancel?.()
  }

  const hasPosition = (event) => Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)

  return {
    pointerDown(event) {
      if (event?.isPrimary === false || (event?.button !== undefined && event.button !== 0)) return
      resetPress()
      pointerId = event?.pointerId ?? 0
      startX = event?.clientX ?? 0
      startY = event?.clientY ?? 0
      triggered = false
      dragMoved = false
      timer = scheduler.setTimeout(triggerReorder, delay)
    },
    pointerMove(event) {
      if (pointerId === null || event?.pointerId !== pointerId) return
      if (triggered) {
        event?.preventDefault?.()
        dragMoved = true
        onDragMove?.(event)
        return
      }
      const deltaX = (event?.clientX ?? 0) - startX
      const deltaY = (event?.clientY ?? 0) - startY
      if (Math.hypot(deltaX, deltaY) <= moveTolerance) return
      if (event?.pointerType === 'mouse' && event?.buttons === 1) {
        triggerReorder()
        event?.preventDefault?.()
        dragMoved = true
        onDragMove?.(event)
        return
      }
      if (event?.pointerType === 'touch') {
        movedBeforeTrigger = true
        return
      }
      cancelPress(event)
    },
    pointerUp(event) {
      if (pointerId === null || event?.pointerId !== pointerId) return
      if (!triggered && event?.pointerType === 'touch' && movedBeforeTrigger) {
        cancelPress(event)
        return
      }
      if (!triggered && event?.pointerType === 'mouse') {
        const deltaX = (event?.clientX ?? 0) - startX
        const deltaY = (event?.clientY ?? 0) - startY
        if (hasPosition(event) && Math.hypot(deltaX, deltaY) > moveTolerance) {
          triggerReorder()
          event?.preventDefault?.()
          dragMoved = true
          onDragMove?.(event)
        }
      } else if (!dragMoved) {
        const deltaX = (event?.clientX ?? 0) - startX
        const deltaY = (event?.clientY ?? 0) - startY
        if (hasPosition(event) && Math.hypot(deltaX, deltaY) > moveTolerance) {
          event?.preventDefault?.()
          dragMoved = true
          onDragMove?.(event)
        }
      }
      const wasTriggered = triggered
      clearTimer()
      pointerId = null
      startX = 0
      startY = 0
      triggered = false
      dragMoved = false
      movedBeforeTrigger = false
      if (wasTriggered) onDragEnd?.(event)
    },
    pointerCancel(event) {
      if (triggered) {
        const deltaX = (event?.clientX ?? 0) - startX
        const deltaY = (event?.clientY ?? 0) - startY
        if (hasPosition(event) && Math.hypot(deltaX, deltaY) > moveTolerance) {
          event?.preventDefault?.()
          dragMoved = true
          onDragMove?.(event)
        }
        onDragEnd?.(event)
      }
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
      dragMoved = false
      movedBeforeTrigger = false
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
