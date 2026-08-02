import assert from "node:assert/strict"
import { test } from "vitest"

import { createAppStore } from "../../src/core/store"
import { createTestState, createSharedStorage } from "../fixtures/daymark-state"

test("reloads the accepted state in another tab and notifies its subscribers once", () => {
  const shared = createSharedStorage()
  const writer = createAppStore(shared.storage)
  const observer = createAppStore(shared.storage)
  let notifications = 0
  const stop = observer.subscribe(() => {
    notifications += 1
  })

  assert.equal(writer.dispatch({ type: "task.add", input: { id: "task-visible", content: "Visible in second tab" } }).ok, true)
  const reloaded = observer.reload()
  stop()

  assert.equal(reloaded.tasks["task-visible"].content, "Visible in second tab")
  assert.equal(notifications, 1)
})

test("does not lose the first tab's change when the second tab detects a conflict", () => {
  const base = createTestState()
  const newer = structuredClone(base)
  newer.revision += 1
  newer.tasks["task-first"] = {
    ...base.tasks["task-welcome"],
    id: "task-first",
    content: "First tab",
  }
  let reads = 0
  const secondTab = createAppStore({
    read: () => {
      reads += 1
      return JSON.stringify(reads < 3 ? base : newer)
    },
    write: () => undefined,
  })
  const stale = secondTab.dispatch({ type: "task.add", input: { id: "task-second", content: "Second tab" } })

  assert.equal(stale.ok, false)
  assert.equal(secondTab.getState().tasks["task-first"].content, "First tab")
  assert.equal(secondTab.getState().tasks["task-second"], undefined)
})
