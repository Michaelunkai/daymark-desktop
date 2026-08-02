import type { CollaborationMember, CollaborationRole } from "./CollaborationDialog";

export interface MemberListProps {
  currentUserId: string;
  disabled?: boolean;
  members: readonly CollaborationMember[];
  onChangeRole: (member: CollaborationMember, role: CollaborationRole) => void;
  onLeave: () => void;
  onRemove: (member: CollaborationMember) => void;
  onRevoke: (member: CollaborationMember) => void;
  onTransferOwnership: (member: CollaborationMember) => void;
}

const ROLE_OPTIONS: readonly CollaborationRole[] = ["admin", "editor", "viewer"];

export function MemberList({
  currentUserId,
  disabled = false,
  members,
  onChangeRole,
  onLeave,
  onRemove,
  onRevoke,
  onTransferOwnership,
}: MemberListProps) {
  const currentUser = members.find((member) => member.id === currentUserId);
  const isCurrentOwner = currentUser?.role === "owner";

  return (
    <section aria-labelledby="collaboration-members-title" className="collaboration-members">
      <div className="collaboration-members__header">
        <div>
          <h3 id="collaboration-members-title">People with access</h3>
          <p>{members.length} {members.length === 1 ? "person" : "people"} in this project</p>
        </div>
        {!isCurrentOwner && currentUser ? (
          <button className="collaboration-button collaboration-button--quiet-danger" disabled={disabled} onClick={onLeave} type="button">
            Leave project
          </button>
        ) : null}
      </div>
      <ul className="collaboration-members__list">
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          const isOwner = member.role === "owner";
          const canManage = isCurrentOwner && !isSelf;
          const label = member.displayName || member.email;
          return (
            <li className="collaboration-member" key={member.id}>
              <span aria-hidden="true" className="collaboration-member__avatar">{initials(label)}</span>
              <div className="collaboration-member__identity">
                <strong>{label}{isSelf ? <span className="collaboration-member__you">You</span> : null}</strong>
                <span>{member.email}</span>
                {member.invitationStatus === "pending" ? <small>Invitation pending</small> : null}
              </div>
              <div className="collaboration-member__access">
                {isOwner ? (
                  <span className="collaboration-role-badge">Owner</span>
                ) : canManage ? (
                  <label className="collaboration-role-select">
                    <span className="collaboration-sr-only">Change {label}'s role</span>
                    <select
                      aria-label={`Change ${label}'s role`}
                      disabled={disabled}
                      onChange={(event) => onChangeRole(member, event.currentTarget.value as CollaborationRole)}
                      value={member.role}
                    >
                      {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </select>
                  </label>
                ) : (
                  <span className="collaboration-role-badge">{roleLabel(member.role)}</span>
                )}
                {canManage && member.invitationStatus === "pending" ? (
                  <button className="collaboration-member__action" disabled={disabled} onClick={() => onRevoke(member)} type="button">
                    Revoke invite
                  </button>
                ) : null}
                {canManage && member.invitationStatus !== "pending" ? (
                  <button className="collaboration-member__action collaboration-member__action--danger" disabled={disabled} onClick={() => onRemove(member)} type="button">
                    Remove
                  </button>
                ) : null}
                {canManage ? (
                  <button className="collaboration-member__action" disabled={disabled} onClick={() => onTransferOwnership(member)} type="button">
                    Make owner
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function roleLabel(role: CollaborationRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
