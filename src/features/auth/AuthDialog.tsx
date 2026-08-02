import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  normalizeEmail,
  validateAuthCredentials,
  type AuthCredentials,
  type AuthMode,
  type AuthRequestResult,
} from "./auth-model";

export interface AuthDialogProps {
  isOpen: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
  onSignIn: (credentials: AuthCredentials) => Promise<AuthRequestResult>;
  onSignUp: (credentials: AuthCredentials) => Promise<AuthRequestResult>;
  onMagicLink: (email: string) => Promise<AuthRequestResult>;
}

const copy: Record<AuthMode, { title: string; detail: string; action: string }> = {
  "sign-in": {
    title: "Welcome back",
    detail: "Sign in to keep your plans in sync.",
    action: "Sign in",
  },
  "sign-up": {
    title: "Start with Daymark",
    detail: "Create an account to keep your workspace close.",
    action: "Create account",
  },
  "magic-link": {
    title: "Email me a link",
    detail: "We will send a one-time sign-in link to your inbox.",
    action: "Send magic link",
  },
};

export function AuthDialog({
  isOpen,
  initialMode = "sign-in",
  onClose,
  onSignIn,
  onSignUp,
  onMagicLink,
}: AuthDialogProps) {
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [credentials, setCredentials] = useState<AuthCredentials>({ email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof AuthCredentials, string>>>({});
  const [requestError, setRequestError] = useState("");
  const [notice, setNotice] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    const frame = window.requestAnimationFrame(() => emailRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const setAuthMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrors({});
    setRequestError("");
    setNotice("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateAuthCredentials(mode, credentials);
    setErrors(nextErrors);
    setRequestError("");
    setNotice("");
    if (Object.keys(nextErrors).length) return;

    setIsPending(true);
    try {
      const result = mode === "sign-in"
        ? await onSignIn({ ...credentials, email: normalizeEmail(credentials.email) })
        : mode === "sign-up"
          ? await onSignUp({ ...credentials, email: normalizeEmail(credentials.email) })
          : await onMagicLink(normalizeEmail(credentials.email));

      if (!result.ok) {
        setRequestError(result.message || "We could not complete that request. Try again.");
        return;
      }

      if (mode === "magic-link") {
        setNotice(result.message || "Check your email for a secure sign-in link.");
      } else {
        setNotice(result.message || "You are signed in.");
      }
    } catch {
      setRequestError("We could not reach the service. Your details are still here, so you can try again.");
    } finally {
      setIsPending(false);
    }
  };

  const content = copy[mode];

  return (
    <div className="auth-dialog__backdrop">
      <section aria-labelledby={titleId} aria-modal="true" className="auth-dialog" role="dialog">
        <div className="auth-dialog__brand" aria-hidden="true">D</div>
        <p className="auth-dialog__eyebrow">Daymark</p>
        <h1 id={titleId}>{content.title}</h1>
        <p className="auth-dialog__detail">{content.detail}</p>

        <div className="auth-dialog__mode" aria-label="Authentication method" role="group">
          <button aria-pressed={mode === "sign-in"} onClick={() => setAuthMode("sign-in")} type="button">
            Sign in
          </button>
          <button aria-pressed={mode === "sign-up"} onClick={() => setAuthMode("sign-up")} type="button">
            Sign up
          </button>
          <button aria-pressed={mode === "magic-link"} onClick={() => setAuthMode("magic-link")} type="button">
            Magic link
          </button>
        </div>

        <form className="auth-dialog__form" onSubmit={submit} noValidate>
          <label>
            <span>Email address</span>
            <input
              aria-describedby={errors.email ? `${errorId}-email` : undefined}
              aria-invalid={Boolean(errors.email)}
              autoComplete="email"
              disabled={isPending}
              onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
              ref={emailRef}
              type="email"
              value={credentials.email}
            />
            {errors.email ? <small id={`${errorId}-email`}>{errors.email}</small> : null}
          </label>
          {mode !== "magic-link" ? (
            <label>
              <span>Password</span>
              <input
                aria-describedby={errors.password ? `${errorId}-password` : undefined}
                aria-invalid={Boolean(errors.password)}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                disabled={isPending}
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
                type="password"
                value={credentials.password}
              />
              {errors.password ? <small id={`${errorId}-password`}>{errors.password}</small> : null}
            </label>
          ) : null}

          {requestError ? <p className="auth-dialog__error" role="alert">{requestError}</p> : null}
          {notice ? <p className="auth-dialog__notice" role="status">{notice}</p> : null}

          <button className="auth-button auth-button--primary" disabled={isPending} type="submit">
            {isPending ? "Working..." : content.action}
          </button>
        </form>

        <button className="auth-dialog__close" onClick={onClose} type="button">Continue without an account</button>
      </section>
    </div>
  );
}
