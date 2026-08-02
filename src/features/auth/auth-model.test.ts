import {
  DELETE_ACCOUNT_CONFIRMATION,
  canDeleteAccount,
  normalizeEmail,
  validateAuthCredentials,
} from "./auth-model";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, body: () => void) {
  try {
    body();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : "failed"}`);
  }
}

test("normalizes email without changing the user's password", () => {
  expect(normalizeEmail("  ME@Example.com ") === "me@example.com", "email should be normalized");
});

test("requires a password for password authentication", () => {
  const errors = validateAuthCredentials("sign-in", { email: "me@example.com", password: "" });
  expect(errors.password === "Enter your password.", "password error should be exposed");
});

test("accepts a magic-link request without a password", () => {
  const errors = validateAuthCredentials("magic-link", { email: "me@example.com", password: "" });
  expect(!errors.password, "magic links should not require a password");
});

test("requires exact deletion confirmation", () => {
  expect(!canDeleteAccount({ confirmation: "delete" }), "lowercase confirmation should be rejected");
  expect(canDeleteAccount({ confirmation: DELETE_ACCOUNT_CONFIRMATION }), "exact confirmation should be accepted");
});
