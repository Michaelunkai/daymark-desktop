import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./validation.ts";

type MembershipRow = { role: string };

const roleRank: Record<string, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function createUserClient(request: Request): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? requiredEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function createAdminClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function requireAuthenticatedUser(
  client: SupabaseClient,
): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "Authentication is required.", "unauthorized");
  }
  return data.user;
}

export async function requireWorkspaceRole(
  client: SupabaseClient,
  workspaceId: string,
  minimumRole: "viewer" | "editor" | "owner",
): Promise<string> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .maybeSingle<MembershipRow>();

  if (error) throw new HttpError(503, "Could not verify workspace access.", "authorization_unavailable");
  const role = data?.role;
  if (!role || (roleRank[role] ?? 0) < roleRank[minimumRole]) {
    throw new HttpError(403, "You do not have permission for this workspace.", "forbidden");
  }
  return role;
}
