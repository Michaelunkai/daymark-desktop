import type {
  CollaborationCapability,
  CollaborationMember,
  CollaborationRole,
} from "./types";

export const COLLABORATION_CAPABILITIES = [
  "project.view",
  "activity.view",
  "task.create",
  "task.update",
  "task.delete",
  "task.move",
  "invitation.create",
  "invitation.revoke",
  "member.role.update",
  "member.revoke",
  "ownership.transfer",
] as const satisfies readonly CollaborationCapability[];

const ROLE_CAPABILITIES: Readonly<Record<CollaborationRole, ReadonlySet<CollaborationCapability>>> = {
  owner: new Set(COLLABORATION_CAPABILITIES),
  editor: new Set([
    "project.view",
    "activity.view",
    "task.create",
    "task.update",
    "task.delete",
    "task.move",
  ]),
  viewer: new Set(["project.view", "activity.view"]),
};

export function getCapabilities(role: CollaborationRole): ReadonlySet<CollaborationCapability> {
  return ROLE_CAPABILITIES[role];
}

export function hasCapability(
  member: Pick<CollaborationMember, "role" | "status"> | null | undefined,
  capability: CollaborationCapability,
): boolean {
  return member?.status === "active" && ROLE_CAPABILITIES[member.role].has(capability);
}

export function canManageMembership(role: CollaborationRole): boolean {
  return role === "owner";
}
