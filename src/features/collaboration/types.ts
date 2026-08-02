export type CollaborationRole = "owner" | "editor" | "viewer";

export type CollaborationInvitationStatus = "pending" | "accepted" | "revoked";

export type CollaborationMemberStatus = "active" | "revoked";

export type CollaborationCapability =
  | "project.view"
  | "activity.view"
  | "task.create"
  | "task.update"
  | "task.delete"
  | "task.move"
  | "invitation.create"
  | "invitation.revoke"
  | "member.role.update"
  | "member.revoke"
  | "ownership.transfer";

export interface CollaborationMember {
  id: string;
  projectId: string;
  userId: string;
  role: CollaborationRole;
  status: CollaborationMemberStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface CollaborationInvitation {
  id: string;
  projectId: string;
  invitedUserId: string;
  role: Exclude<CollaborationRole, "owner">;
  status: CollaborationInvitationStatus;
  invitedByUserId: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export type CollaborationActivityKind =
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "member.role.updated"
  | "member.revoked"
  | "ownership.transferred";

export interface CollaborationActivity {
  id: string;
  projectId: string;
  actorUserId: string;
  kind: CollaborationActivityKind;
  occurredAt: string;
  subjectUserId: string;
  metadata: Readonly<Record<string, string>>;
}

export interface CollaborationSnapshot {
  projectId: string;
  members: readonly CollaborationMember[];
  invitations: readonly CollaborationInvitation[];
  activity: readonly CollaborationActivity[];
}

export interface CreateInvitationInput {
  projectId: string;
  invitedUserId: string;
  role: Exclude<CollaborationRole, "owner">;
  expiresAt?: string | null;
}

export interface UpdateMemberRoleInput {
  projectId: string;
  memberId: string;
  role: Exclude<CollaborationRole, "owner">;
}

export interface RevokeMemberInput {
  projectId: string;
  memberId: string;
}

export interface TransferOwnershipInput {
  projectId: string;
  nextOwnerMemberId: string;
}

export interface CollaborationProvider {
  listMembers(projectId: string): Promise<readonly CollaborationMember[]>;
  listInvitations(projectId: string): Promise<readonly CollaborationInvitation[]>;
  listActivity(projectId: string): Promise<readonly CollaborationActivity[]>;
  createInvitation(invitation: CollaborationInvitation): Promise<void>;
  updateInvitation(invitation: CollaborationInvitation): Promise<void>;
  createMember(member: CollaborationMember): Promise<void>;
  updateMember(member: CollaborationMember): Promise<void>;
  revokeMember(member: CollaborationMember): Promise<void>;
  transferOwnership(input: {
    projectId: string;
    previousOwnerMemberId: string;
    nextOwnerMemberId: string;
    occurredAt: string;
  }): Promise<void>;
  appendActivity(activity: CollaborationActivity): Promise<void>;
}

export type CollaborationIdFactory = (kind: "activity" | "invitation" | "member") => string;
