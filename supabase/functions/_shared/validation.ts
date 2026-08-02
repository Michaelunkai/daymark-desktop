export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "bad_request",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type JsonRecord = Record<string, unknown>;

export function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
    vary: "Origin",
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, details: error.details } },
      error.status,
    );
  }

  console.error("Unhandled edge-function error", error);
  return jsonResponse(
    { error: { code: "internal_error", message: "An unexpected error occurred." } },
    500,
  );
}

export async function readJsonRecord(request: Request): Promise<JsonRecord> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(415, "Expected an application/json request body.", "unsupported_media_type");
  }

  try {
    const value: unknown = await request.json();
    if (!isRecord(value)) {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

export function requireAction(
  body: JsonRecord,
  allowed: readonly string[],
): string {
  const action = requireString(body, "action", 64);
  if (!allowed.includes(action)) {
    throw new HttpError(400, "Unsupported action.", "unsupported_action");
  }
  return action;
}

export function requireString(
  body: JsonRecord,
  field: string,
  maxLength = 256,
): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required.`, "invalid_payload");
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} is too long.`, "invalid_payload");
  }
  return normalized;
}

export function optionalString(
  body: JsonRecord,
  field: string,
  maxLength = 256,
): string | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requireString(body, field, maxLength);
}

export function requireEmail(body: JsonRecord, field = "email"): string {
  const email = requireString(body, field, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, `${field} must be a valid email address.`, "invalid_payload");
  }
  return email;
}

export function requireId(body: JsonRecord, field: string): string {
  const value = requireString(body, field, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, `${field} has an invalid format.`, "invalid_payload");
  }
  return value;
}

export function requireDateTime(body: JsonRecord, field: string): string {
  const value = requireString(body, field, 64);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new HttpError(400, `${field} must be an ISO-8601 timestamp.`, "invalid_payload");
  }
  return new Date(timestamp).toISOString();
}

export function requireTimeZone(body: JsonRecord, field = "timezone"): string {
  const timezone = requireString(body, field, 128);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new HttpError(400, `${field} must be a valid IANA timezone.`, "invalid_payload");
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
