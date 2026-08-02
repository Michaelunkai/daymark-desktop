import { createAuthService } from "./auth-service";
import { validatePublicCloudEnvironment } from "./env";
import { createSupabaseRepository } from "./supabase-repository";
import type { AuthChangeEvent, AuthSession, SupabaseBrowserClient, SupabaseRealtimeChannel } from "./supabase-client";
import { createWorkspaceService } from "./workspace-service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const session: AuthSession = { access_token: "token", user: { id: "user-1", email: "person@example.com" } };
let authListener: ((event: AuthChangeEvent, session: AuthSession | null) => void) | undefined;
let realtimeListener: ((payload: any) => void) | undefined;
let passwordRequest: { email: string; password: string } | undefined;
let magicLinkRequest: { email: string; options?: { emailRedirectTo?: string } } | undefined;
let lastRpc: { name: string; params?: Record<string, unknown> } | undefined;
const channel: SupabaseRealtimeChannel = {
  on: (_type, _filter, callback) => { realtimeListener = callback; return channel; },
  subscribe: () => channel,
  unsubscribe: () => undefined,
};
const client: SupabaseBrowserClient = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInWithPassword: async (input) => {
      passwordRequest = input;
      return { data: { session, user: session.user }, error: null };
    },
    signInWithOtp: async (input) => {
      magicLinkRequest = input;
      return { data: { user: null }, error: null };
    },
    signOut: async () => ({ data: {}, error: null }),
    onAuthStateChange: (listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: () => { authListener = undefined; } } } };
    },
  },
  rpc: async (name, params) => {
    lastRpc = { name, params };
    if (name === "daymark_get_workspace_snapshot") return { data: { revision: 4, state: {} } as any, error: null };
    if (name === "daymark_bootstrap_workspace") {
      return { data: { id: "workspace-1", ownerId: "user-1", name: "Personal", createdAt: "2026-08-02T14:00:00.000Z" }, error: null };
    }
    return { data: { revision: 5, state: {} } as any, error: null };
  },
  channel: () => channel,
};

const env = validatePublicCloudEnvironment({ url: "https://example.supabase.co/", anonKey: "public-anon-key" });
assert(env.url === "https://example.supabase.co", "Environment should normalize the URL.");
let rejectedServiceRole = false;
try {
  validatePublicCloudEnvironment({ url: "https://example.supabase.co", anonKey: "service_role_secret" });
} catch {
  rejectedServiceRole = true;
}
assert(rejectedServiceRole, "Service-role values must be rejected.");

const auth = createAuthService(client.auth);
assert((await auth.recoverSession())?.user.id === "user-1", "Session recovery should use the auth client.");
await auth.signInWithPassword(" person@example.com ", "password");
assert(passwordRequest?.email === "person@example.com", "Password sign-in should normalize email addresses.");
await auth.sendMagicLink("person@example.com", { emailRedirectTo: "https://daymark.example/auth/callback" });
assert(magicLinkRequest?.options?.emailRedirectTo === "https://daymark.example/auth/callback", "Magic links should preserve the redirect URL.");
let signedIn = false;
const stopAuth = auth.subscribe((state) => { signedIn = state.event === "SIGNED_IN" && state.session?.user.id === "user-1"; });
authListener?.("SIGNED_IN", session);
assert(signedIn, "Auth changes should be relayed.");
stopAuth();

const repository = createSupabaseRepository(client, { workspaceId: "workspace-1", clientId: "client-1" });
const snapshot = await repository.pull();
assert(snapshot.revision === 4, "Repository should pull the RPC snapshot.");
assert(
  lastRpc?.name === "daymark_get_workspace_snapshot" &&
    lastRpc.params?.p_workspace_id === "workspace-1",
  "Snapshot RPC parameters must match the database function signature.",
);
await repository.push([{
  id: "mutation-1",
  clientId: "client-1",
  type: "task.update",
  payload: {},
  occurredAt: "2026-08-02T14:00:00.000Z",
}], 4);
assert(
  lastRpc?.name === "daymark_apply_workspace_mutations" &&
    lastRpc.params?.p_workspace_id === "workspace-1" &&
    lastRpc.params?.p_client_id === "client-1" &&
    lastRpc.params?.p_expected_revision === 4 &&
    Array.isArray(lastRpc.params?.p_mutations),
  "Mutation RPC parameters must match the database function signature.",
);
const workspace = await createWorkspaceService(client).bootstrap({ name: " Personal " });
assert(workspace.id === "workspace-1", "Workspace bootstrap should return the created workspace.");
assert(
  lastRpc?.name === "daymark_bootstrap_workspace" &&
    lastRpc.params?.p_workspace_name === "Personal",
  "Workspace bootstrap parameters must match the database function signature.",
);
let changeCount = 0;
const stopRealtime = repository.subscribe(() => { changeCount += 1; });
const event = {
  eventType: "INSERT" as const,
  old: {},
  new: {
    id: "change-1",
    workspace_id: "workspace-1",
    client_id: "client-2",
    revision: 5,
    mutation: { id: "mutation-1", clientId: "client-2", type: "task.update", payload: {}, occurredAt: "2026-08-02T14:00:00.000Z" },
  },
};
realtimeListener?.(event);
realtimeListener?.(event);
assert(changeCount === 1, "Duplicate realtime events must be ignored.");
realtimeListener?.({ ...event, new: { ...event.new, id: "change-local", client_id: "client-1" } });
assert(changeCount === 1, "Local optimistic events must not be replayed.");
stopRealtime();

console.log("CLOUD_SERVICES_TESTS_OK");
