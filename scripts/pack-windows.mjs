import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const powershellDirectory = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
);
const systemDirectory = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const env = {
  ...process.env,
  PATH: [powershellDirectory, systemDirectory, process.env.PATH ?? ""].join(path.delimiter),
};
const cli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
const result = spawnSync(process.execPath, [cli, "--win", "nsis", "portable"], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
