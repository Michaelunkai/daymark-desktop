import assert from "node:assert/strict"
import { test } from "vitest"

import { COLLABORATION_CAPABILITIES, hasCapability } from "../../src/features/collaboration/capabilities"

test("enforces RLS-aligned capability expectations for viewer, editor, and owner roles", () => {
  const member = (role: "owner" | "editor" | "viewer", status: "active" | "revoked" = "active") => ({ role, status })

  for (const capability of COLLABORATION_CAPABILITIES) {
    assert.equal(hasCapability(member("owner"), capability), true)
    assert.equal(hasCapability(member("viewer"), capability), capability === "project.view" || capability === "activity.view")
    assert.equal(
      hasCapability(member("editor"), capability),
      ["project.view", "activity.view", "task.create", "task.update", "task.delete", "task.move"].includes(capability),
    )
  }

  assert.equal(hasCapability(member("owner", "revoked"), "member.revoke"), false)
})
