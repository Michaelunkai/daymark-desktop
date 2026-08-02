import {
  HttpError,
  requireDateTime,
  requireEmail,
  requireId,
  requireTimeZone,
} from "./_shared/validation.ts";
import { hasMinimumWorkspaceRole } from "./_shared/auth.ts";
import { parseRateLimitResult } from "./_shared/rate-limit.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(action: () => unknown, expectedCode: string): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof HttpError, "Expected HttpError.");
    assert(error.code === expectedCode, `Expected ${expectedCode}.`);
    return;
  }
  throw new Error("Expected action to throw.");
}

Deno.test("validates bounded identifiers, email, timestamp, and timezone", () => {
  assert(requireId({ workspaceId: "workspace_01" }, "workspaceId") === "workspace_01");
  assert(requireEmail({ email: "PERSON@EXAMPLE.COM" }) === "person@example.com");
  assert(requireDateTime({ scheduledFor: "2026-08-02T09:00:00-04:00" }, "scheduledFor") === "2026-08-02T13:00:00.000Z");
  assert(requireTimeZone({ timezone: "America/New_York" }) === "America/New_York");
  assertThrows(() => requireId({ workspaceId: "bad id" }, "workspaceId"), "invalid_payload");
  assertThrows(() => requireEmail({ email: "not-email" }), "invalid_payload");
});

Deno.test("requires a valid distributed rate-limit result", () => {
  assert(parseRateLimitResult({ allowed: true, retry_after_seconds: 0 }).allowed);
  const denied = parseRateLimitResult({ allowed: false, retry_after_seconds: 1.2 });
  assert(!denied.allowed);
  assert(denied.retryAfterSeconds === 2);
  assertThrows(() => parseRateLimitResult({}), "rate_limit_unavailable");
});

Deno.test("requires active workspace roles to meet the requested minimum", () => {
  assert(hasMinimumWorkspaceRole("viewer", "viewer"));
  assert(!hasMinimumWorkspaceRole("viewer", "editor"));
  assert(hasMinimumWorkspaceRole("owner", "editor"));
  assert(!hasMinimumWorkspaceRole(null, "viewer"));
  assert(!hasMinimumWorkspaceRole("deleted", "viewer"));
});

/*
Deployment handoff for W79:
1. Implement the called RPCs and RLS policies from the W61 schema contract.
2. Set ALLOWED_ORIGIN and the required Supabase secrets in the project.
3. Run: supabase functions deploy invitations reminders data-export account-delete
4. Run: deno test supabase/functions/functions.test.ts
*/
