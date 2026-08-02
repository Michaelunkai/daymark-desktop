import assert from "node:assert/strict";
import test from "node:test";

import { COLLABORATION_CAPABILITIES, hasCapability } from "./capabilities.ts";
import {
  CollaborationClient,
  CollaborationPermissionError,
  CollaborationValidationError,
} from "./collaboration-client.ts";
import type {
  CollaborationActivity,
  CollaborationInvitation,
  CollaborationMember,
  CollaborationProvider,
} from "./types.ts";

const projectId = "project-collaboration";
const timestamp = "2026-08-02T14:00:00.000Z";

function member(
  id: string,
  userId: string,
  role: CollaborationMember["role"],
  status: CollaborationMember["status"] = "active",
): CollaborationMember {
  return {
    id,
    projectId,
    userId,
    role,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: status === "revoked" ? timestamp : null,
  };
}

class TestProvider implements CollaborationProvider {
  members: CollaborationMember[];
  invitations: CollaborationInvitation[] = [];
  activity: CollaborationActivity[] = [];

  constructor(members: CollaborationMember[]) {
    this.members = members;
  }

  async listMembers() { return this.members; }
  async listInvitations() { return this.invitations; }
  async listActivity() { return this.activity; }
  async createInvitation(invitation: CollaborationInvitation) { this.invitations.push(invitation); }
  async updateInvitation(invitation: CollaborationInvitation) {
    this.invitations = this.invitations.map((item) => item.id === invitation.id ? invitation : item);
  }
  async createMember(newMember: CollaborationMember) { this.members.push(newMember); }
  async updateMember(memberToUpdate: CollaborationMember) {
    this.members = this.members.map((item) => item.id === memberToUpdate.id ? memberToUpdate : item);
  }
  async revokeMember(memberToRevoke: CollaborationMember) { await this.updateMember(memberToRevoke); }
  async transferOwnership(input: {
    previousOwnerMemberId: string;
    nextOwnerMemberId: string;
    occurredAt: string;
  }) {
    this.members = this.members.map((current) => {
      if (current.id === input.previousOwnerMemberId) {
        return { ...current, role: "editor", updatedAt: input.occurredAt };
      }
      if (current.id === input.nextOwnerMemberId) {
        return { ...current, role: "owner", updatedAt: input.occurredAt };
      }
      return current;
    });
  }
  async appendActivity(entry: CollaborationActivity) { this.activity.push(entry); }
}

function createClient(members: CollaborationMember[]) {
  let sequence = 0;
  const provider = new TestProvider(members);
  const client = new CollaborationClient(provider, {
    now: () => timestamp,
    createId: (kind) => `${kind}-${++sequence}`,
  });
  return { client, provider };
}

test("exhaustively enforces the role capability matrix", () => {
  const allowed: Record<CollaborationMember["role"], readonly string[]> = {
    owner: COLLABORATION_CAPABILITIES,
    editor: ["project.view", "activity.view", "task.create", "task.update", "task.delete", "task.move"],
    viewer: ["project.view", "activity.view"],
  };

  for (const role of ["owner", "editor", "viewer"] as const) {
    for (const capability of COLLABORATION_CAPABILITIES) {
      assert.equal(
        hasCapability(member(`member-${role}`, role, role), capability),
        allowed[role].includes(capability),
        `${role} ${capability}`,
      );
    }
  }

  assert.equal(hasCapability(member("revoked", "former-user", "owner", "revoked"), "task.delete"), false);
  assert.equal(hasCapability(null, "project.view"), false);
});

test("blocks viewer task and membership mutations while editors may only mutate tasks", async () => {
  const { client } = createClient([
    member("owner", "owner-user", "owner"),
    member("editor", "editor-user", "editor"),
    member("viewer", "viewer-user", "viewer"),
  ]);

  assert.equal(await client.can(projectId, "editor-user", "task.move"), true);
  assert.equal(await client.can(projectId, "viewer-user", "task.update"), false);
  assert.equal(await client.can(projectId, "editor-user", "member.role.update"), false);

  await assert.rejects(
    () => client.createInvitation("viewer-user", { projectId, invitedUserId: "new-user", role: "viewer" }),
    CollaborationPermissionError,
  );
  await assert.rejects(
    () => client.createInvitation("editor-user", { projectId, invitedUserId: "new-user", role: "viewer" }),
    CollaborationPermissionError,
  );
});

test("models pending, accepted, and revoked invitation transitions with activity", async () => {
  const { client, provider } = createClient([member("owner", "owner-user", "owner")]);
  const invitation = await client.createInvitation("owner-user", {
    projectId,
    invitedUserId: "editor-user",
    role: "editor",
  });
  assert.equal(invitation.status, "pending");

  const accepted = await client.acceptInvitation("editor-user", projectId, invitation.id);
  assert.equal(accepted.role, "editor");
  assert.equal(provider.invitations[0].status, "accepted");
  assert.equal(provider.members.find((item) => item.userId === "editor-user")?.status, "active");

  const second = await client.createInvitation("owner-user", {
    projectId,
    invitedUserId: "viewer-user",
    role: "viewer",
  });
  const revoked = await client.revokeInvitation("owner-user", projectId, second.id);
  assert.equal(revoked.status, "revoked");
  await assert.rejects(
    () => client.acceptInvitation("viewer-user", projectId, second.id),
    CollaborationValidationError,
  );
  assert.deepEqual(provider.activity.map((entry) => entry.kind), [
    "invitation.created",
    "invitation.accepted",
    "invitation.created",
    "invitation.revoked",
  ]);
});

test("restricts role changes, member revocation, and ownership transfer to owners", async () => {
  const { client, provider } = createClient([
    member("owner", "owner-user", "owner"),
    member("editor", "editor-user", "editor"),
    member("viewer", "viewer-user", "viewer"),
  ]);

  await assert.rejects(
    () => client.updateMemberRole("editor-user", { projectId, memberId: "viewer", role: "editor" }),
    CollaborationPermissionError,
  );
  await client.updateMemberRole("owner-user", { projectId, memberId: "viewer", role: "editor" });
  assert.equal(provider.members.find((item) => item.id === "viewer")?.role, "editor");

  await assert.rejects(
    () => client.updateMemberRole("owner-user", { projectId, memberId: "owner", role: "viewer" }),
    CollaborationValidationError,
  );
  await assert.rejects(
    () => client.revokeMember("owner-user", { projectId, memberId: "owner" }),
    CollaborationValidationError,
  );

  await assert.rejects(
    () => client.transferOwnership("editor-user", { projectId, nextOwnerMemberId: "viewer" }),
    CollaborationPermissionError,
  );
  await client.transferOwnership("owner-user", { projectId, nextOwnerMemberId: "editor" });
  assert.equal(provider.members.find((item) => item.id === "owner")?.role, "editor");
  assert.equal(provider.members.find((item) => item.id === "editor")?.role, "owner");
});
