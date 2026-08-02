import {
  createUserClient,
  requireAuthenticatedUser,
  requireWorkspaceRole,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  readJsonRecord,
  requireAction,
  requireEmail,
  requireId,
  requireString,
} from "../_shared/validation.ts";

const INVITATION_ROLES = ["viewer", "editor"] as const;

function invitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);

  try {
    const body = await readJsonRecord(request);
    const client = createUserClient(request);
    const user = await requireAuthenticatedUser(client);
    await enforceRateLimit(client, `invitations:${user.id}`, 20, 3_600);

    const action = requireAction(body, ["create", "accept", "transfer_ownership"]);
    if (action === "create") {
      const workspaceId = requireId(body, "workspaceId");
      const email = requireEmail(body);
      const role = requireString(body, "role", 16);
      if (!INVITATION_ROLES.includes(role as (typeof INVITATION_ROLES)[number])) {
        return jsonResponse({ error: { code: "invalid_payload", message: "role must be viewer or editor." } }, 400);
      }
      await requireWorkspaceRole(client, workspaceId, "owner");

      const token = invitationToken();
      const { data, error } = await client.rpc("create_workspace_invitation", {
        p_workspace_id: workspaceId,
        p_email: email,
        p_role: role,
        p_token_hash: await tokenHash(token),
      });
      if (error) throw error;
      return jsonResponse({ invitation: data, token }, 201);
    }

    if (action === "accept") {
      const token = requireString(body, "token", 256);
      const { data, error } = await client.rpc("accept_workspace_invitation", {
        p_token_hash: await tokenHash(token),
      });
      if (error) throw error;
      return jsonResponse({ membership: data });
    }

    const workspaceId = requireId(body, "workspaceId");
    const successorUserId = requireId(body, "successorUserId");
    await requireWorkspaceRole(client, workspaceId, "owner");
    const { data, error } = await client.rpc("transfer_workspace_ownership", {
      p_workspace_id: workspaceId,
      p_successor_user_id: successorUserId,
    });
    if (error) throw error;
    return jsonResponse({ transfer: data });
  } catch (error) {
    return errorResponse(error);
  }
});
