import "./auth.css";

export { AccountDialog, type AccountDialogProps } from "./AccountDialog";
export { AuthDialog, type AuthDialogProps } from "./AuthDialog";
export { AuthGate, type AuthGateProps } from "./AuthGate";
export {
  DELETE_ACCOUNT_CONFIRMATION,
  authStatusMessage,
  canDeleteAccount,
  normalizeEmail,
  validateAuthCredentials,
  validateEmail,
  validatePassword,
  type AuthCredentials,
  type AuthMode,
  type AuthRequestResult,
  type AuthSessionState,
  type DeleteAccountDraft,
} from "./auth-model";
