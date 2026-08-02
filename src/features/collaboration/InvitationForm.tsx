import { type FormEvent, useId, useState } from "react";

import type { CollaborationRole, MutationResult } from "./CollaborationDialog";

export interface InvitationFormProps {
  disabled?: boolean;
  onInvite: (input: { email: string; role: CollaborationRole }) => MutationResult;
}

const INVITABLE_ROLES: readonly CollaborationRole[] = ["editor", "viewer"];

export function InvitationForm({ disabled = false, onInvite }: InvitationFormProps) {
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollaborationRole>("editor");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();

    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const result = await onInvite({ email: address, role });
      if (typeof result === "string") {
        setError(result);
        return;
      }
      if (result && !result.ok) {
        setError(result.message);
        return;
      }
      setEmail("");
    } catch {
      setError("The invitation could not be sent. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="collaboration-invitation" noValidate onSubmit={submit}>
      <div className="collaboration-invitation__heading">
        <div>
          <h3>Invite people</h3>
          <p>They will receive access to this project only.</p>
        </div>
      </div>
      <div className="collaboration-invitation__fields">
        <label className="collaboration-field" htmlFor={emailId}>
          <span>Email address</span>
          <input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="email"
            disabled={disabled || isSubmitting}
            id={emailId}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              if (error) {
                setError("");
              }
            }}
            placeholder="name@example.com"
            type="email"
            value={email}
          />
        </label>
        <label className="collaboration-field collaboration-field--role">
          <span>Access</span>
          <select
            disabled={disabled || isSubmitting}
            onChange={(event) => setRole(event.currentTarget.value as CollaborationRole)}
            value={role}
          >
            {INVITABLE_ROLES.map((option) => (
              <option key={option} value={option}>{roleLabel(option)}</option>
            ))}
          </select>
        </label>
        <button className="collaboration-button collaboration-button--primary" disabled={disabled || isSubmitting} type="submit">
          {isSubmitting ? "Sending..." : "Send invite"}
        </button>
      </div>
      <p className="collaboration-invitation__note">
        Editors can add and change tasks. Viewers can see the plan without changing it.
      </p>
      {error ? <p className="collaboration-form-error" id={errorId} role="alert">{error}</p> : null}
    </form>
  );
}

function roleLabel(role: CollaborationRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
