import { createSampleState } from "../../src/core/sample-data"
import type { AppState, StateStorage } from "../../src/core/types"

export function createTestState(revision = 0): AppState {
  const state = createSampleState("2026-08-02T12:00:00.000Z", "integration-client")
  return { ...state, revision }
}

export function createSharedStorage(initial: AppState = createTestState()): {
  storage: StateStorage
  readRaw(): string | null
  replace(next: AppState): void
  writes(): readonly string[]
} {
  let raw: string | null = JSON.stringify(initial)
  const writes: string[] = []

  return {
    storage: {
      read: () => raw,
      write: (value) => {
        raw = value
        writes.push(value)
      },
      remove: () => {
        raw = null
      },
    },
    readRaw: () => raw,
    replace: (next) => {
      raw = JSON.stringify(next)
    },
    writes: () => writes,
  }
}

export function readStoredState(storage: { readRaw(): string | null }): AppState {
  const raw = storage.readRaw()
  if (!raw) throw new Error("Expected durable state.")
  return JSON.parse(raw) as AppState
}
