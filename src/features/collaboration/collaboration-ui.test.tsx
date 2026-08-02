import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmationCopy,
  getTrappedFocusIndex,
  type CollaborationMember,
} from "./CollaborationDialog";

const member: CollaborationMember = {
  id: "member-1",
  displayName: "Sam Lee",
  email: "sam@example.com",
  role: "editor",
};

test("destructive collaboration changes describe consequences and need acknowledgement", () => {
  const copy = confirmationCopy({ kind: "transfer", member });

  assert.equal(copy.destructive, true);
  assert.match(copy.body, /become an admin/i);
  assert.equal(copy.action, "Transfer ownership");
});

test("role changes tell the manager what the new role allows", () => {
  const copy = confirmationCopy({ kind: "change-role", member, role: "viewer" });

  assert.equal(copy.destructive, false);
  assert.match(copy.body, /cannot change/i);
});

test("dialog focus wrapping only changes focus at either end of the tab order", () => {
  assert.equal(getTrappedFocusIndex(4, 3, false), 0);
  assert.equal(getTrappedFocusIndex(4, 0, true), 3);
  assert.equal(getTrappedFocusIndex(4, 1, false), null);
  assert.equal(getTrappedFocusIndex(0, 0, false), null);
});
