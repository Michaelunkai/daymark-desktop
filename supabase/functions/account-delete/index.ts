import {
  createAdminClient,
  createUserClient,
  requireAuthenticatedUser,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  readJsonRecord,
  requireAction,
  requireString,
} from "../_shared/validation.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);

  try {
    const body = await readJsonRecord(request);
    const client = createUserClient(request);
    const user = await requireAuthenticatedUser(client);
    await enforceRateLimit(client, `account-delete:${user.id}`, 3, 86_400);

    const action = requireAction(body, ["request", "confirm"]);
    const idempotencyKey = requireString(body, "idempotencyKey", 128);
    const { data, error } = await client.rpc(
      action === "request" ? "request_account_deletion" : "confirm_account_deletion",
      { p_idempotency_key: idempotencyKey },
    );
    if (error) throw error;

    if (action === "request") return jsonResponse({ deletion: data }, 202);

    // The database contract performs short, retry-safe data cleanup first and
    // rejects confirmation until any workspace ownership has been transferred.
    const admin = createAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, true);
    if (deleteError) throw deleteError;
    return jsonResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});
