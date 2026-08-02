import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import {
  canDeleteAccount,
  DELETE_ACCOUNT_CONFIRMATION,
  type AuthRequestResult,
} from "./auth-model";

export interface AccountDialogProps {
  isOpen: boolean;
  email: string;
  onClose: () => void;
  onSignOut: () => Promise<AuthRequestResult>;
  onSignOutAllDevices: () => Promise<AuthRequestResult>;
  onDeleteAccount: () => Promise<AuthRequestResult>;
}

export function AccountDialog({
  isOpen,
  email,
  onClose,
  onSignOut,
  onSignOutAllDevices,
  onDeleteAccount,
}: AccountDialogProps) {
  const titleId = useId();
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<"sign-out" | "all-devices" | "delete" | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmation("");
    setError("");
    setMessage("");
  }, [isOpen]);

  if (!isOpen) return null;

  const runAction = async (
    action: "sign-out" | "all-devices" | "delete",
    request: () => Promise<AuthRequestResult>,
  ) => {
    setPendingAction(action);
    setError("");
    setMessage("");
    try {
      const result = await request();
      if (!result.ok) {
        setError(result.message || "That change could not be completed. Your current settings were not changed.");
        return;
      }
      setMessage(result.message || "Your account has been updated.");
    } catch {
      setError("We could not reach the service. Nothing was changed.");
    } finally {
      setPendingAction(null);
    }
  };

  const requestDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canDeleteAccount({ confirmation })) {
      setError(`Type ${DELETE_ACCOUNT_CONFIRMATION} to confirm account deletion.`);
      confirmationRef.current?.focus();
      return;
    }
    void runAction("delete", onDeleteAccount);
  };

  return (
    <div className="auth-dialog__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby={titleId} aria-modal="true" className="auth-account" role="dialog">
        <header>
          <div>
            <p className="auth-dialog__eyebrow">Account</p>
            <h2 id={titleId}>Account and security</h2>
            <p>{email}</p>
          </div>
          <button aria-label="Close account settings" className="auth-account__close" onClick={onClose} type="button">x</button>
        </header>

        <div className="auth-account__content">
          <section>
            <h3>Sessions</h3>
            <p>Keep this device signed in, or end access on every other device.</p>
            <div className="auth-account__actions">
              <button className="auth-button auth-button--secondary" disabled={Boolean(pendingAction)} onClick={() => void runAction("sign-out", onSignOut)} type="button">
                {pendingAction === "sign-out" ? "Signing out..." : "Sign out"}
              </button>
              <button className="auth-button auth-button--secondary" disabled={Boolean(pendingAction)} onClick={() => void runAction("all-devices", onSignOutAllDevices)} type="button">
                {pendingAction === "all-devices" ? "Ending sessions..." : "Sign out all devices"}
              </button>
            </div>
          </section>

          <section className="auth-account__danger">
            <h3>Delete account</h3>
            <p>This permanently removes your account. Type {DELETE_ACCOUNT_CONFIRMATION} to enable deletion.</p>
            <form onSubmit={requestDelete}>
              <label>
                <span>Confirmation</span>
                <input
                  aria-invalid={Boolean(error)}
                  disabled={Boolean(pendingAction)}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    setError("");
                  }}
                  ref={confirmationRef}
                  value={confirmation}
                />
              </label>
              <button className="auth-button auth-button--danger" disabled={!canDeleteAccount({ confirmation }) || Boolean(pendingAction)} type="submit">
                {pendingAction === "delete" ? "Deleting..." : "Delete account"}
              </button>
            </form>
          </section>

          {error ? <p className="auth-dialog__error" role="alert">{error}</p> : null}
          {message ? <p className="auth-dialog__notice" role="status">{message}</p> : null}
        </div>
      </section>
    </div>
  );
}
