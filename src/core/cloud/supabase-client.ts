import type { PublicCloudEnvironment } from "./env";

export type AuthSession = {
  access_token: string;
  expires_at?: number;
  refresh_token?: string;
  user: { id: string; email?: string | null };
};

export type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

export type SupabaseAuthResult<T> = Promise<{ data: T; error: Error | null }>;

export interface SupabaseAuthClient {
  getSession(): SupabaseAuthResult<{ session: AuthSession | null }>;
  signInWithPassword(credentials: { email: string; password: string }): SupabaseAuthResult<{ session: AuthSession | null; user: AuthSession["user"] | null }>;
  signInWithOtp(input: { email: string; options?: { emailRedirectTo?: string } }): SupabaseAuthResult<{ user: AuthSession["user"] | null }>;
  signOut(): SupabaseAuthResult<Record<string, never>>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: AuthSession | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

export type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

export interface SupabaseRealtimeChannel {
  on(
    type: "postgres_changes",
    filter: { event: "*"; schema: string; table: string; filter?: string },
    callback: (payload: RealtimePayload) => void,
  ): SupabaseRealtimeChannel;
  subscribe(): SupabaseRealtimeChannel;
  unsubscribe(): void | Promise<void>;
}

export interface SupabaseRpcClient {
  rpc<T>(functionName: string, params?: Record<string, unknown>): SupabaseAuthResult<T>;
  channel(name: string): SupabaseRealtimeChannel;
  removeChannel?(channel: SupabaseRealtimeChannel): void | Promise<void>;
}

export type SupabaseBrowserClient = SupabaseRpcClient & { auth: SupabaseAuthClient };

export type SupabaseClientFactory = (url: string, anonKey: string, options: {
  auth: { persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean };
}) => SupabaseBrowserClient;

export function createSupabaseBrowserClient(
  environment: PublicCloudEnvironment,
  createClient: SupabaseClientFactory,
): SupabaseBrowserClient {
  if (typeof window === "undefined") {
    throw new Error("Supabase browser client creation requires a browser environment.");
  }

  return createClient(environment.url, environment.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
