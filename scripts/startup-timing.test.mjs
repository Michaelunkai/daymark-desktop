import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  measureStartup,
  PACKAGED_RUNTIME_NAME,
  REQUIRED_ITERATIONS,
  resolvePackagedRuntime,
  STARTUP_EVENT_NAME,
  STARTUP_THRESHOLD_MS,
} from "./measure-startup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(new URL("./measure-startup.mjs", import.meta.url), "utf8");

test("startup proof requires exactly 30 samples and a sub-second threshold", async () => {
  await assert.rejects(
    measureStartup({ iterations: REQUIRED_ITERATIONS - 1 }),
    /iterations must be exactly 30/,
  );
  assert.equal(REQUIRED_ITERATIONS, 30);
  assert.equal(STARTUP_THRESHOLD_MS, 1_000);
});

test("startup proof rejects web-only and synthetic paths before launching", async () => {
  await assert.rejects(
    measureStartup({
      iterations: REQUIRED_ITERATIONS,
      runtimePath: path.join(root, "dist", "client", "index.html"),
    }),
    new RegExp(`only accepts ${PACKAGED_RUNTIME_NAME.replace(".", "\\.")}`),
  );
  assert.match(source, /DAYMARK_STARTUP_TRACE/);
  assert.match(source, /Daymark Runtime\.exe/);
  assert.match(source, /startup:renderer-ready-visible/);
  assert.doesNotMatch(source, /spawnSync\(process\.execPath/);
  assert.doesNotMatch(source, /readFileSync\(.*index\.html/);
});

const packagedRuntimeAvailable = (() => {
  try {
    resolvePackagedRuntime({ rootDirectory: root });
    return true;
  } catch {
    return false;
  }
})();

test(
  "packaged runtime produces 30 measured cold and warm samples under one second",
  { skip: !packagedRuntimeAvailable || process.env.DAYMARK_RUN_PACKAGED_STARTUP_TEST !== "1" },
  async () => {
    const result = await measureStartup({ rootDirectory: root });
    assert.equal(result.iterations, 30);
    assert.equal(result.measurement, "packaged-native-runtime-process");
    assert.equal(result.event, STARTUP_EVENT_NAME);
    assert.equal(result.synthetic, false);
    assert.equal(result.webOnly, false);
    assert.equal(result.cold.samples.length, 30);
    assert.equal(result.warm.samples.length, 30);
    assert.equal(result.cold.measured, true);
    assert.equal(result.warm.measured, true);
    assert.equal(result.cold.samples.every((sample) => sample < STARTUP_THRESHOLD_MS), true);
    assert.equal(result.warm.samples.every((sample) => sample < STARTUP_THRESHOLD_MS), true);
    assert.equal(result.passed, true);
  },
);

test("source-only checkout does not accidentally count as packaged runtime proof", () => {
  if (existsSync(path.join(root, "release", "windows", "win-unpacked", PACKAGED_RUNTIME_NAME))) {
    return;
  }
  assert.throws(
    () => resolvePackagedRuntime({ rootDirectory: root }),
    /Packaged runtime is missing or invalid/,
  );
});
