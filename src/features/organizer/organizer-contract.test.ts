import test from "node:test"
import assert from "node:assert/strict"
import {
  getOrganizerEmptyState,
  getOrganizerNavigationKeyAction,
  getOrganizerRoute,
  getOrganizerSection,
  isOrganizerRoute,
  ORGANIZER_SECTIONS,
} from "./organizer-contract"

test("exposes one route contract for all organizer spaces", () => {
  assert.deepEqual(
    ORGANIZER_SECTIONS.map((section) => section.id),
    ["calendar", "tasks", "notes", "diary"],
  )
  assert.equal(getOrganizerSection("upcoming")?.id, "calendar")
  assert.equal(getOrganizerSection("today")?.id, "tasks")
  assert.equal(getOrganizerRoute("notes"), "notes")
  assert.equal(isOrganizerRoute("diary"), true)
  assert.equal(isOrganizerRoute("project:work"), false)
})

test("keeps empty states connected to the rest of the organizer", () => {
  assert.match(getOrganizerEmptyState("notes").description, /context/i)
  assert.equal(getOrganizerEmptyState("notes").primaryLabel, "Open tasks")
  assert.equal(getOrganizerEmptyState("diary").secondaryLabel, "Open calendar")
})

test("supports predictable keyboard movement between organizer spaces", () => {
  assert.deepEqual(getOrganizerNavigationKeyAction("tasks", "ArrowRight"), {
    type: "focus",
    sectionId: "notes",
  })
  assert.deepEqual(getOrganizerNavigationKeyAction("tasks", "ArrowUp"), {
    type: "focus",
    sectionId: "calendar",
  })
  assert.deepEqual(getOrganizerNavigationKeyAction("tasks", "Home"), {
    type: "focus",
    sectionId: "calendar",
  })
  assert.deepEqual(getOrganizerNavigationKeyAction("tasks", "End"), {
    type: "focus",
    sectionId: "diary",
  })
  assert.deepEqual(getOrganizerNavigationKeyAction("diary", "ArrowRight"), {
    type: "focus",
    sectionId: "diary",
  })
  assert.deepEqual(getOrganizerNavigationKeyAction("calendar", "Escape"), {
    type: "none",
  })
})
