import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAcceptanceReceipt } from "./acceptance-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("acceptance receipt records static contracts but cannot pass without packaged startup proof", async () => {
  const receipt = await createAcceptanceReceipt({ runStartup: false });
  assert.equal(receipt.release, "1.4.44");
  assert.equal(receipt.passed, false);
  assert.equal(receipt.startup.status, "not-run");
  assert.deepEqual(receipt.checks, {
    release: true,
    firstFrame: true,
    androidReady: true,
    cachePolicy: true,
    packIncludesClient: true,
    acceptanceInTestGraph: true,
    packagedRuntimeStartup: false,
  });
  assert.deepEqual(receipt.proof, {
    source: "packaged-windows-native-runtime",
    synthetic: false,
    webOnly: false,
    requiredColdSamples: 30,
    requiredWarmSamples: 30,
    threshold: "<1000ms per sample",
  });
});

test("acceptance receipt fails closed when packaged runtime measurement is unavailable", async () => {
  const receipt = await createAcceptanceReceipt({
    runtimePath: path.join(root, "dist", "client", "index.html"),
  });
  assert.equal(receipt.passed, false);
  assert.equal(receipt.checks.packagedRuntimeStartup, false);
  assert.match(receipt.startup.status, /failed/);
  assert.match(receipt.startup.reason, /Packaged Windows startup proof|Packaged runtime|only accepts|release/);
});
