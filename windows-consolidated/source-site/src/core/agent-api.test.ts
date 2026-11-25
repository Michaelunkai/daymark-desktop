import assert from "node:assert/strict";
import test from "node:test";
import { DAYMARK_AI_SCOPES, provisionTaskAssistant } from "./agent-api";

test("provisionTaskAssistant keeps the generated secret client-side and sends only its hash", async () => {
  let capturedRequest: Request | null = null;
  const response = await provisionTaskAssistant({
    syncKey: "daymark-sync-key-12345",
    randomBytes: () => new Uint8Array(32).fill(7),
    fetchImpl: async (input, init) => {
      capturedRequest = new Request(new URL(String(input), "https://daymark.test"), init);
      return new Response(JSON.stringify({
        key: {
          id: "agent-key-12345678-1234-1234-1234-123456789012",
          name: "Codex task assistant",
          scopes: [...DAYMARK_AI_SCOPES],
          createdAt: "2026-08-09T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.match(response.token, /^dmk_live_/);
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.headers.get("authorization"), "Bearer daymark-sync-key-12345");
  const payload = await capturedRequest.json() as { tokenHash: string; scopes: string[] };
  assert.match(payload.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(payload.tokenHash, response.token);
  assert.deepEqual(payload.scopes, DAYMARK_AI_SCOPES);
});
