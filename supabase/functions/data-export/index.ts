import { createUserClient, requireAuthenticatedUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  readJsonRecord,
  requireId,
} from "../_shared/validation.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);

  try {
    const body = await readJsonRecord(request);
    const client = createUserClient(request);
    const user = await requireAuthenticatedUser(client);
    await enforceRateLimit(client, `data-export:${user.id}`, 3, 86_400);

    const { data, error } = await client.rpc("create_data_export", {
      p_workspace_id: requireId(body, "workspaceId"),
    });
    if (error) throw error;

    // The RPC must return a short-lived signed download URL, never raw secrets.
    return jsonResponse({ export: data }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
