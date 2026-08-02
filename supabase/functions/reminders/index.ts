import { createUserClient, requireAuthenticatedUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  HttpError,
  errorResponse,
  isRecord,
  jsonResponse,
  optionsResponse,
  readJsonRecord,
  requireDateTime,
  requireEmail,
  requireId,
  requireString,
  requireTimeZone,
} from "../_shared/validation.ts";

export type EmailReminderRequest = {
  idempotencyKey: string;
  recipient: { email: string; userId?: string };
  reminder: { id: string; taskId: string; taskTitle: string };
  scheduledFor: string;
  timezone: string;
};

// W73 consumes this provider-neutral queue contract.
export function createEmailReminderRequest(
  reminder: Record<string, unknown>,
  recipient: Record<string, unknown>,
  options: { timezone: string },
): EmailReminderRequest {
  const reminderId = requireId(reminder, "id");
  const taskId = requireId(reminder, "taskId");
  const taskTitle = requireString(reminder, "taskTitle", 500);
  const scheduledFor = requireDateTime(reminder, "scheduledFor");
  const email = requireEmail(recipient);
  const userId = recipient.userId === undefined ? undefined : requireId(recipient, "userId");
  const timezone = requireTimeZone({ timezone: options.timezone });

  return {
    idempotencyKey: `email-reminder:${reminderId}:${email}:${scheduledFor}`,
    recipient: { email, ...(userId ? { userId } : {}) },
    reminder: { id: reminderId, taskId, taskTitle },
    scheduledFor,
    timezone,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);

  try {
    const body = await readJsonRecord(request);
    if (!isRecord(body.reminder) || !isRecord(body.recipient)) {
      throw new HttpError(400, "reminder and recipient are required objects.", "invalid_payload");
    }

    const client = createUserClient(request);
    const user = await requireAuthenticatedUser(client);
    await enforceRateLimit(client, `reminders:${user.id}`, 60, 3_600);

    const delivery = createEmailReminderRequest(body.reminder, body.recipient, {
      timezone: requireTimeZone(body),
    });
    const { data, error } = await client.rpc("enqueue_reminder_delivery", {
      p_idempotency_key: delivery.idempotencyKey,
      p_recipient: delivery.recipient,
      p_reminder: delivery.reminder,
      p_scheduled_for: delivery.scheduledFor,
      p_timezone: delivery.timezone,
    });
    if (error) throw error;

    return jsonResponse({ delivery: data, scheduledFor: delivery.scheduledFor }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
