#!/usr/bin/env node
// mark skill helper — universal Daymark CLI runner.
// Fixes at the root the two recurring write failures:
//   1. shells (PowerShell 5.1) that mangle `--data '{...}'` / `--data @file.json`
//   2. BOM-prefixed payload files that break JSON.parse
// Usage: node dm.mjs <any Daymark CLI arguments>   (`--data @file` is expanded here; --json is appended if absent)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

delete process.env.DAYMARK_AI_TOKEN;
delete process.env.DAYMARK_API_URL;

const cliDirectory = String.raw`F:\backup\windowsapps\installed\daymark\cli`;
const { run } = await import(pathToFileURL(join(cliDirectory, "daymark.mjs")).href);

const raw = process.argv.slice(2);
const args = [];
for (let i = 0; i < raw.length; i += 1) {
  if (raw[i] === "--data" && typeof raw[i + 1] === "string" && raw[i + 1].startsWith("@")) {
    let text = await readFile(raw[i + 1].slice(1), "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    args.push("--data", JSON.stringify(JSON.parse(text)));
    i += 1;
  } else {
    args.push(raw[i]);
  }
}
if (!args.includes("--json")) args.push("--json");

try {
  await run(args);
} catch (error) {
  console.error(`Mark: ${error.message}`);
  process.exitCode = 1;
}
