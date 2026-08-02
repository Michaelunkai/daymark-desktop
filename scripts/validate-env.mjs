import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envPath = resolve(root, ".env");
const exposedSecretPattern = /^VITE_.*(?:SECRET|TOKEN|PASSWORD|PRIVATE|KEY)/i;

if (process.env.NODE_ENV && !["development", "production", "test"].includes(process.env.NODE_ENV)) {
  throw new Error("NODE_ENV must be development, production, or test when set.");
}

if (!existsSync(envPath)) {
  console.log("ENV_CHECK_OK (no local .env file)");
  process.exit(0);
}

const unsafeLines = readFileSync(envPath, "utf8")
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => line && !line.startsWith("#"))
  .map(({ line, number }) => ({ key: line.split("=", 1)[0].trim(), number }))
  .filter(({ key, number }) => !key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || exposedSecretPattern.test(key))
  .map(({ key, number }) => `line ${number}${key ? ` (${key})` : ""}`);

if (unsafeLines.length > 0) {
  throw new Error(
    `Invalid or unsafe .env entries: ${unsafeLines.join(", ")}. VITE_ values are public client-side values.`,
  );
}

console.log("ENV_CHECK_OK");
