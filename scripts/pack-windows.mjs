import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
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
const outputName = process.env.DAYMARK_WINDOWS_OUTPUT_NAME;
if (outputName && !/^windows-[a-z0-9-]+$/.test(outputName)) {
  throw new Error("DAYMARK_WINDOWS_OUTPUT_NAME must be a simple windows-* directory name.");
}
const outputDirectory = path.join(root, "release", outputName ?? "windows");
if (existsSync(outputDirectory)) {
  if (outputName) throw new Error(`The selected Windows output already exists: ${outputDirectory}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(outputDirectory, path.join(root, "release", `windows-previous-${stamp}`));
}
const args = [cli, "--win", "nsis", "portable"];
if (outputName) args.push(`--config.directories.output=${path.join("release", outputName)}`);
const result = spawnSync(process.execPath, args, {
  cwd: root,
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
