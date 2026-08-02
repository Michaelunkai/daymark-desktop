import type { AuthChangeEvent, AuthSession, SupabaseAuthClient } from "./supabase-client";

export type AuthState = {
  event: AuthChangeEvent;
  session: AuthSession | null;
};

export type MagicLinkOptions = {
  emailRedirectTo?: string;
};

export interface AuthService {
  recoverSession(): Promise<AuthSession | null>;
  signInWithPassword(email: string, password: string): Promise<AuthSession | null>;
  sendMagicLink(email: string, options?: MagicLinkOptions): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (state: AuthState) => void): () => void;
}

export function createAuthService(client: Pick<SupabaseAuthClient, "getSession" | "signInWithPassword" | "signInWithOtp" | "signOut" | "onAuthStateChange">): AuthService {
  return {
    async recoverSession() {
      const { data, error } = await client.getSession();
      if (error) throw error;
      return data.session;
    },
    async signInWithPassword(email, password) {
      requireValue(email, "Email");
      requireValue(password, "Password");
      const { data, error } = await client.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      return data.session;
    },
    async sendMagicLink(email, options) {
      requireValue(email, "Email");
      const { error } = await client.signInWithOtp({
        email: email.trim(),
        options: options?.emailRedirectTo ? { emailRedirectTo: options.emailRedirectTo } : undefined,
      });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.signOut();
      if (error) throw error;
    },
    subscribe(listener) {
      const { data } = client.onAuthStateChange((event, session) => listener({ event, session }));
      return () => data.subscription.unsubscribe();
    },
  };
}

function requireValue(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required.`);
}
