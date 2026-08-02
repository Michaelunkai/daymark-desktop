import { hasCapability } from "./capabilities";
import type {
  CollaborationActivity,
  CollaborationCapability,
  CollaborationIdFactory,
  CollaborationInvitation,
  CollaborationMember,
  CollaborationProvider,
  CollaborationSnapshot,
  CreateInvitationInput,
  RevokeMemberInput,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
} from "./types";

export class CollaborationPermissionError extends Error {
  constructor(capability: CollaborationCapability) {
    super(`The current member cannot perform ${capability}.`);
    this.name = "CollaborationPermissionError";
  }
}

export class CollaborationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollaborationValidationError";
  }
}

export interface CollaborationClientOptions {
  now?: () => string;
  createId?: CollaborationIdFactory;
}

export class CollaborationClient {
  private readonly now: () => string;
  private readonly createId: CollaborationIdFactory;

  constructor(
    private readonly provider: CollaborationProvider,
    options: CollaborationClientOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? ((kind) => `${kind}-${crypto.randomUUID()}`);
  }

  async getSnapshot(projectId: string): Promise<CollaborationSnapshot> {
    const [members, invitations, activity] = await Promise.all([
      this.provider.listMembers(projectId),
      this.provider.listInvitations(projectId),
      this.provider.listActivity(projectId),
    ]);

    return { projectId, members, invitations, activity };
  }

  async can(
    projectId: string,
    actorUserId: string,
    capability: CollaborationCapability,
  ): Promise<boolean> {
    const actor = await this.findActiveMember(projectId, actorUserId);
    return hasCapability(actor, capability);
  }

  async createInvitation(
    actorUserId: string,
    input: CreateInvitationInput,
  ): Promise<CollaborationInvitation> {
    await this.requireCapability(input.projectId, actorUserId, "invitation.create");
    if (input.invitedUserId === actorUserId) {
      throw new CollaborationValidationError("Members cannot invite themselves.");
    }

    const invitations = await this.provider.listInvitations(input.projectId);
    if (invitations.some((invitation) => invitation.invitedUserId === input.invitedUserId && invitation.status === "pending")) {
      throw new CollaborationValidationError("That user already has a pending invitation.");
    }

    const occurredAt = this.now();
    const invitation: CollaborationInvitation = {
      id: this.createId("invitation"),
      projectId: input.projectId,
      invitedUserId: input.invitedUserId,
      role: input.role,
      status: "pending",
      invitedByUserId: actorUserId,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: input.expiresAt ?? null,
    };
    await this.provider.createInvitation(invitation);
    await this.record(input.projectId, actorUserId, "invitation.created", input.invitedUserId, {
      role: input.role,
    }, occurredAt);
    return invitation;
  }

  async acceptInvitation(
    actorUserId: string,
    projectId: string,
    invitationId: string,
  ): Promise<CollaborationMember> {
    const invitation = await this.findInvitation(projectId, invitationId);
    if (invitation.invitedUserId !== actorUserId) {
      throw new CollaborationPermissionError("project.view");
    }
    if (invitation.status !== "pending") {
      throw new CollaborationValidationError("Only pending invitations can be accepted.");
    }
    const occurredAt = this.now();
    if (invitation.expiresAt && invitation.expiresAt <= occurredAt) {
      throw new CollaborationValidationError("This invitation has expired.");
    }
    const members = await this.provider.listMembers(projectId);
    if (members.some((member) => member.userId === actorUserId && member.status === "active")) {
      throw new CollaborationValidationError("That user is already an active member.");
    }

    const accepted: CollaborationInvitation = {
      ...invitation,
      status: "accepted",
      acceptedAt: occurredAt,
      updatedAt: occurredAt,
    };
    const member: CollaborationMember = {
      id: this.createId("member"),
      projectId,
      userId: actorUserId,
      role: invitation.role,
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      revokedAt: null,
    };
    await this.provider.updateInvitation(accepted);
    await this.provider.createMember(member);
    await this.record(projectId, actorUserId, "invitation.accepted", actorUserId, {
      invitationId: invitation.id,
      role: invitation.role,
    }, occurredAt);
    return member;
  }

  async revokeInvitation(actorUserId: string, projectId: string, invitationId: string): Promise<CollaborationInvitation> {
    await this.requireCapability(projectId, actorUserId, "invitation.revoke");
    const invitation = await this.findInvitation(projectId, invitationId);
    if (invitation.status !== "pending") {
      throw new CollaborationValidationError("Only pending invitations can be revoked.");
    }

    const occurredAt = this.now();
    const revoked: CollaborationInvitation = {
      ...invitation,
      status: "revoked",
      revokedAt: occurredAt,
      updatedAt: occurredAt,
    };
    await this.provider.updateInvitation(revoked);
    await this.record(projectId, actorUserId, "invitation.revoked", invitation.invitedUserId, {
      invitationId,
    }, occurredAt);
    return revoked;
  }

  async updateMemberRole(actorUserId: string, input: UpdateMemberRoleInput): Promise<CollaborationMember> {
    await this.requireCapability(input.projectId, actorUserId, "member.role.update");
    const member = await this.findMember(input.projectId, input.memberId);
    if (member.status !== "active") {
      throw new CollaborationValidationError("Only active members can receive a role.");
    }
    if (member.userId === actorUserId) {
      throw new CollaborationValidationError("Owners cannot change their own role.");
    }
    if (member.role === "owner") {
      throw new CollaborationValidationError("Use ownership transfer to change the owner.");
    }

    const occurredAt = this.now();
    const updated = { ...member, role: input.role, updatedAt: occurredAt };
    await this.provider.updateMember(updated);
    await this.record(input.projectId, actorUserId, "member.role.updated", member.userId, {
      role: input.role,
    }, occurredAt);
    return updated;
  }

  async revokeMember(actorUserId: string, input: RevokeMemberInput): Promise<CollaborationMember> {
    await this.requireCapability(input.projectId, actorUserId, "member.revoke");
    const member = await this.findMember(input.projectId, input.memberId);
    if (member.status !== "active") {
      throw new CollaborationValidationError("Only active members can be revoked.");
    }
    if (member.userId === actorUserId || member.role === "owner") {
      throw new CollaborationValidationError("The owner cannot be revoked.");
    }

    const occurredAt = this.now();
    const revoked = { ...member, status: "revoked" as const, revokedAt: occurredAt, updatedAt: occurredAt };
    await this.provider.revokeMember(revoked);
    await this.record(input.projectId, actorUserId, "member.revoked", member.userId, {}, occurredAt);
    return revoked;
  }

  async transferOwnership(actorUserId: string, input: TransferOwnershipInput): Promise<void> {
    const actor = await this.requireCapability(input.projectId, actorUserId, "ownership.transfer");
    const nextOwner = await this.findMember(input.projectId, input.nextOwnerMemberId);
    if (nextOwner.status !== "active" || nextOwner.role === "owner" || nextOwner.userId === actorUserId) {
      throw new CollaborationValidationError("Ownership must be transferred to another active non-owner member.");
    }

    const occurredAt = this.now();
    await this.provider.transferOwnership({
      projectId: input.projectId,
      previousOwnerMemberId: actor.id,
      nextOwnerMemberId: nextOwner.id,
      occurredAt,
    });
    await this.record(input.projectId, actorUserId, "ownership.transferred", nextOwner.userId, {}, occurredAt);
  }

  private async requireCapability(
    projectId: string,
    actorUserId: string,
    capability: CollaborationCapability,
  ): Promise<CollaborationMember> {
    const actor = await this.findActiveMember(projectId, actorUserId);
    if (!hasCapability(actor, capability)) {
      throw new CollaborationPermissionError(capability);
    }
    return actor;
  }

  private async findActiveMember(projectId: string, userId: string): Promise<CollaborationMember | null> {
    const members = await this.provider.listMembers(projectId);
    return members.find((member) => member.userId === userId && member.status === "active") ?? null;
  }

  private async findMember(projectId: string, memberId: string): Promise<CollaborationMember> {
    const members = await this.provider.listMembers(projectId);
    const member = members.find((candidate) => candidate.id === memberId);
    if (!member) {
      throw new CollaborationValidationError("The member does not belong to this project.");
    }
    return member;
  }

  private async findInvitation(projectId: string, invitationId: string): Promise<CollaborationInvitation> {
    const invitations = await this.provider.listInvitations(projectId);
    const invitation = invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation) {
      throw new CollaborationValidationError("The invitation does not belong to this project.");
    }
    return invitation;
  }

  private async record(
    projectId: string,
    actorUserId: string,
    kind: CollaborationActivity["kind"],
    subjectUserId: string,
    metadata: Readonly<Record<string, string>>,
    occurredAt: string,
  ): Promise<void> {
    await this.provider.appendActivity({
      id: this.createId("activity"),
      projectId,
      actorUserId,
      kind,
      occurredAt,
      subjectUserId,
      metadata,
    });
  }
}
