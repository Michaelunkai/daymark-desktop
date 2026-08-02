import type { ReactNode } from "react";

import type { AuthSessionState } from "./auth-model";
import { AuthDialog, type AuthDialogProps } from "./AuthDialog";

export interface AuthGateProps {
  children: ReactNode;
  session: AuthSessionState;
  authDialog: Omit<AuthDialogProps, "isOpen" | "onClose">;
  onAnonymousContinue?: () => void;
  onOfflineContinue?: () => void;
}

export function AuthGate({
  children,
  session,
  authDialog,
  onAnonymousContinue,
  onOfflineContinue,
}: AuthGateProps) {
  if (session.status === "authenticated") {
    return <>{children}</>;
  }

  if (session.status === "loading") {
    return (
      <main className="auth-gate" aria-busy="true" aria-live="polite">
        <section className="auth-gate__status">
          <span className="auth-gate__mark" aria-hidden="true">D</span>
          <p>Checking your session...</p>
        </section>
      </main>
    );
  }

  if (session.status === "offline") {
    return (
      <main className="auth-gate" aria-labelledby="auth-offline-title">
        <section className="auth-gate__status">
          <span className="auth-gate__mark" aria-hidden="true">D</span>
          <p className="auth-dialog__eyebrow">Daymark</p>
          <h1 id="auth-offline-title">You are offline</h1>
          <p>Your saved workspace remains available on this device.</p>
          {onOfflineContinue ? (
            <button className="auth-button auth-button--primary" type="button" onClick={onOfflineContinue}>
              Continue offline
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <AuthDialog
      {...authDialog}
      isOpen
      onClose={onAnonymousContinue ?? (() => undefined)}
    />
  );
}
