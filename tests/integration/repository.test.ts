import assert from "node:assert/strict"
import { test } from "vitest"

import { createLocalRepository } from "../../src/core/repository"
import { createAppStore } from "../../src/core/store"
import { createBrowserStorage, loadState, migrate, saveState } from "../../src/core/storage"
import { createTestState } from "../fixtures/daymark-state"

test("migrates legacy localStorage state without discarding durable entities", () => {
  const current = createTestState()
  const legacy = {
    ...current,
    schemaVersion: 1,
    sections: undefined,
    filters: undefined,
    preferences: { inboxProjectId: current.preferences.inboxProjectId, onboardingDismissed: false },
    undoStack: undefined,
  }

  const migrated = migrate(legacy)

  assert.equal(migrated.schemaVersion, 2)
  assert.deepEqual(migrated.sections, {})
  assert.deepEqual(migrated.filters, {})
  assert.equal(migrated.preferences.theme, "system")
  assert.deepEqual(migrated.undoStack, [])
  assert.deepEqual(migrated.tasks, current.tasks)
})

test("uses the supplied browser storage repository and recovers corrupted state", () => {
  const values = new Map<string, string | null>()
  const browserStorage = createBrowserStorage(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    "daymark.integration",
  )

  browserStorage.write(JSON.stringify(createTestState()))
  assert.equal(loadState(browserStorage).recovered, false)

  browserStorage.write("{corrupt")
  assert.equal(loadState(browserStorage).recovered, true)
  browserStorage.remove?.()
  assert.equal(browserStorage.read(), null)
})

test("rejects stale revision writes and leaves the accepted repository state intact", () => {
  const first = createTestState()
  const left = { read: () => JSON.stringify(first), write: () => undefined }
  const stale = { ...first, revision: first.revision + 1, clientId: "second-client" }

  const result = saveState(left, stale, first.revision + 1)

  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.state.revision, first.revision)
})

test("exposes durable project and task workflows through the repository contract", () => {
  let raw = JSON.stringify(createTestState())
  const repository = createLocalRepository(
    createAppStore({
      read: () => raw,
      write: (value) => {
        raw = value
      },
    }),
  )

  assert.equal(repository.addProject({ id: "project-integration", name: "Integration" }).ok, true)
  assert.equal(
    repository.addTask({
      id: "task-integration",
      content: "Persist through repository",
      projectId: "project-integration",
    }).ok,
    true,
  )
  assert.equal(repository.completeTask("task-integration").ok, true)
  assert.ok(repository.getState().tasks["task-integration"].completedAt)
})
