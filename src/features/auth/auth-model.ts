export type AuthMode = "sign-in" | "sign-up" | "magic-link";

export type AuthSessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "offline" }
  | {
      status: "authenticated";
      user: {
        email: string;
        displayName?: string | null;
      };
    };

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthRequestResult {
  ok: boolean;
  message?: string;
}

export interface DeleteAccountDraft {
  confirmation: string;
}

export const DELETE_ACCOUNT_CONFIRMATION = "DELETE";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Enter a valid email address.";
  }
  return "";
}

export function validatePassword(password: string, mode: AuthMode) {
  if (mode === "magic-link") return "";
  if (!password) return "Enter your password.";
  if (mode === "sign-up" && password.length < 8) {
    return "Use at least 8 characters for your password.";
  }
  return "";
}

export function validateAuthCredentials(
  mode: AuthMode,
  credentials: AuthCredentials,
): Partial<Record<keyof AuthCredentials, string>> {
  const email = validateEmail(credentials.email);
  const password = validatePassword(credentials.password, mode);

  return {
    ...(email ? { email } : {}),
    ...(password ? { password } : {}),
  };
}

export function canDeleteAccount(draft: DeleteAccountDraft) {
  return draft.confirmation.trim() === DELETE_ACCOUNT_CONFIRMATION;
}

export function authStatusMessage(session: AuthSessionState) {
  if (session.status === "loading") return "Checking your session.";
  if (session.status === "offline") return "You are working offline.";
  return "";
}
