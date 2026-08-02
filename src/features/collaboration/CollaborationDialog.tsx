import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { InvitationForm } from "./InvitationForm";
import { MemberList } from "./MemberList";

export type CollaborationRole = "owner" | "admin" | "editor" | "viewer";
export type MutationResult = void | string | { ok: boolean; message: string } | Promise<void | string | { ok: boolean; message: string }>;

export interface CollaborationMember {
  id: string;
  email: string;
  displayName?: string;
  role: CollaborationRole;
  invitationStatus?: "pending" | "accepted";
}

export interface CollaborationDialogProps {
  currentUserId: string;
  isOpen: boolean;
  members: readonly CollaborationMember[];
  onChangeRole: (memberId: string, role: CollaborationRole) => MutationResult;
  onClose: () => void;
  onInvite: (input: { email: string; role: CollaborationRole }) => MutationResult;
  onLeaveProject: () => MutationResult;
  onRemoveMember: (memberId: string) => MutationResult;
  onRevokeInvitation: (memberId: string) => MutationResult;
  onTransferOwnership: (memberId: string) => MutationResult;
  projectName: string;
}

type Confirmation =
  | { kind: "change-role"; member: CollaborationMember; role: CollaborationRole }
  | { kind: "leave"; member?: undefined; role?: undefined }
  | { kind: "remove"; member: CollaborationMember; role?: undefined }
  | { kind: "revoke"; member: CollaborationMember; role?: undefined }
  | { kind: "transfer"; member: CollaborationMember; role?: undefined };

export function CollaborationDialog(props: CollaborationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.isOpen]);

  const close = useCallback(() => {
    if (isMutating) {
      return;
    }
    props.onClose();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [isMutating, props]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmation) {
          setConfirmation(null);
          setConfirmationError("");
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, confirmation, props.isOpen]);

  const requestConfirmation = (next: Confirmation) => {
    setConfirmation(next);
    setConfirmationError("");
  };

  const confirm = async () => {
    if (!confirmation) {
      return;
    }
    setConfirmationError("");
    setIsMutating(true);

    try {
      const result = await actionFor(confirmation, props);
      if (typeof result === "string") {
        setConfirmationError(result);
        return;
      }
      if (result && !result.ok) {
        setConfirmationError(result.message);
        return;
      }
      setConfirmation(null);
    } catch {
      setConfirmationError("That change could not be completed. Try again.");
    } finally {
      setIsMutating(false);
    }
  };

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusables = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const targetIndex = getTrappedFocusIndex(focusables.length, focusables.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (targetIndex === null) {
      return;
    }
    event.preventDefault();
    focusables[targetIndex]?.focus();
  };

  return (
    <div
      aria-hidden={!props.isOpen}
      className="collaboration-backdrop"
      hidden={!props.isOpen}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && !confirmation) {
          close();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="collaboration-dialog"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <header className="collaboration-dialog__header">
          <div>
            <p className="collaboration-dialog__eyebrow">Project sharing</p>
            <h2 id={titleId}>Collaborate on {props.projectName}</h2>
            <p>Choose who can see and shape this project.</p>
          </div>
          <button
            aria-label="Close project collaboration"
            className="collaboration-close"
            disabled={isMutating}
            onClick={close}
            ref={closeRef}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
        </header>

        <div className="collaboration-dialog__content">
          <InvitationForm disabled={isMutating} onInvite={props.onInvite} />
          <MemberList
            currentUserId={props.currentUserId}
            disabled={isMutating}
            members={props.members}
            onChangeRole={(member, role) => requestConfirmation({ kind: "change-role", member, role })}
            onLeave={() => requestConfirmation({ kind: "leave" })}
            onRemove={(member) => requestConfirmation({ kind: "remove", member })}
            onRevoke={(member) => requestConfirmation({ kind: "revoke", member })}
            onTransferOwnership={(member) => requestConfirmation({ kind: "transfer", member })}
          />
        </div>

        {confirmation ? (
          <ConfirmationPanel
            confirmation={confirmation}
            error={confirmationError}
            isMutating={isMutating}
            onCancel={() => {
              setConfirmation(null);
              setConfirmationError("");
            }}
            onConfirm={confirm}
          />
        ) : null}
      </section>
    </div>
  );
}

export const ProjectCollaborationDialog = CollaborationDialog;

export function getTrappedFocusIndex(length: number, activeIndex: number, shiftKey: boolean): number | null {
  if (length === 0 || activeIndex < 0) {
    return null;
  }
  if (shiftKey && activeIndex === 0) {
    return length - 1;
  }
  if (!shiftKey && activeIndex === length - 1) {
    return 0;
  }
  return null;
}

export function confirmationCopy(confirmation: Confirmation): { title: string; body: string; action: string; destructive: boolean } {
  switch (confirmation.kind) {
    case "change-role":
      return {
        title: `Change ${memberName(confirmation.member)} to ${roleLabel(confirmation.role)}?`,
        body: confirmation.role === "viewer"
          ? "Viewers can see project tasks and activity, but cannot change them."
          : confirmation.role === "editor"
            ? "Editors can add, edit, move, and complete tasks in this project."
            : "Admins can manage members and change access. They cannot transfer ownership.",
        action: "Change access",
        destructive: false,
      };
    case "revoke":
      return {
        title: `Revoke the invitation for ${memberName(confirmation.member)}?`,
        body: "The invitation link will stop working. You can invite them again later.",
        action: "Revoke invitation",
        destructive: true,
      };
    case "remove":
      return {
        title: `Remove ${memberName(confirmation.member)}?`,
        body: "They will immediately lose access to this project. Their completed work remains in the project.",
        action: "Remove access",
        destructive: true,
      };
    case "leave":
      return {
        title: "Leave this project?",
        body: "You will lose access right away. Ask an owner or admin to invite you back if you need to return.",
        action: "Leave project",
        destructive: true,
      };
    case "transfer":
      return {
        title: `Make ${memberName(confirmation.member)} the owner?`,
        body: "You will become an admin. Only the new owner can transfer ownership again.",
        action: "Transfer ownership",
        destructive: true,
      };
  }
}

function ConfirmationPanel({
  confirmation,
  error,
  isMutating,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation;
  error: string;
  isMutating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = confirmationCopy(confirmation);
  const [acknowledged, setAcknowledged] = useState(!copy.destructive);
  const acknowledgementId = useId();
  const errorId = useId();

  return (
    <aside aria-describedby={error ? errorId : undefined} aria-label={copy.title} className="collaboration-confirmation" role="alertdialog">
      <div>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        {copy.destructive ? (
          <label className="collaboration-confirmation__acknowledgement" htmlFor={acknowledgementId}>
            <input
              checked={acknowledged}
              disabled={isMutating}
              id={acknowledgementId}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>I understand this change takes effect immediately.</span>
          </label>
        ) : null}
        {error ? <p className="collaboration-form-error" id={errorId} role="alert">{error}</p> : null}
      </div>
      <div className="collaboration-confirmation__actions">
        <button className="collaboration-button collaboration-button--secondary" disabled={isMutating} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className={`collaboration-button ${copy.destructive ? "collaboration-button--danger" : "collaboration-button--primary"}`}
          disabled={!acknowledged || isMutating}
          onClick={onConfirm}
          type="button"
        >
          {isMutating ? "Updating..." : copy.action}
        </button>
      </div>
    </aside>
  );
}

function actionFor(confirmation: Confirmation, props: CollaborationDialogProps): MutationResult {
  switch (confirmation.kind) {
    case "change-role":
      return props.onChangeRole(confirmation.member.id, confirmation.role);
    case "revoke":
      return props.onRevokeInvitation(confirmation.member.id);
    case "remove":
      return props.onRemoveMember(confirmation.member.id);
    case "leave":
      return props.onLeaveProject();
    case "transfer":
      return props.onTransferOwnership(confirmation.member.id);
  }
}

function memberName(member: CollaborationMember): string {
  return member.displayName || member.email;
}

function roleLabel(role: CollaborationRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
