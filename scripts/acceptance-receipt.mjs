import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureStartup } from "./measure-startup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function parseRootMarkers(html) {
  const rootElement = html.match(/<div\s+id="root"([\s\S]*?)>/i)?.[1] ?? "";
  const value = (name, source) => source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
  return {
    release: value("content", html.match(/<meta\s+name="daymark-release"[^>]*>/i)?.[0] ?? ""),
    firstFrame: value("content", html.match(/<meta\s+name="daymark-first-frame"[^>]*>/i)?.[0] ?? ""),
    rootReady: value("data-daymark-ready", rootElement),
    rootFirstFrame: value("data-daymark-first-frame", rootElement),
    rootInteractive: value("data-daymark-interactive", rootElement),
    rootVersion: value("data-daymark-version", rootElement),
  };
}

function startupNotRun() {
  return {
    status: "not-run",
    required: true,
    passed: false,
    measurement: "packaged-native-runtime-process",
    reason: "Packaged Windows cold and warm startup proof was not run.",
  };
}

export async function createAcceptanceReceipt({
  runStartup = true,
  iterations = 30,
  runtimePath,
} = {}) {
  const packageJson = JSON.parse(read("package.json"));
  const html = read("index.html");
  const main = read("src/main.jsx");
  const headers = read("public/_headers");
  const worker = read("worker/index.js");
  const markers = parseRootMarkers(html);
  let startup = startupNotRun();

  if (runStartup) {
    try {
      startup = await measureStartup({ iterations, rootDirectory: root, runtimePath });
    } catch (error) {
      startup = {
        status: "failed",
        required: true,
        passed: false,
        measurement: "packaged-native-runtime-process",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const checks = {
    release: packageJson.version === "1.4.44"
      && markers.release === "1.4.44"
      && markers.rootVersion === "1.4.44",
    firstFrame: markers.firstFrame === "interactive"
      && markers.rootFirstFrame === "interactive"
      && main.includes("setAttribute('data-daymark-interactive', 'true')"),
    androidReady: main.includes("setAttribute('data-daymark-ready', 'true')")
      && main.includes("window.DaymarkAndroid?.onAppReady?.()"),
    cachePolicy: /\/api\/\*\s+Cache-Control: no-store/.test(headers)
      && /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(headers)
      && /max-age=31536000, immutable/.test(worker),
    packIncludesClient: Array.isArray(packageJson.build?.files)
      && packageJson.build.files.includes("dist/client/**/*")
      && packageJson.scripts["desktop:pack"].startsWith("npm run build &&"),
    acceptanceInTestGraph: packageJson.scripts.test.includes("test:acceptance")
      && packageJson.scripts["test:acceptance"].includes("acceptance-receipt.test.mjs"),
    packagedRuntimeStartup: startup.passed === true
      && startup.measurement === "packaged-native-runtime-process"
      && startup.iterations === 30
      && startup.cold?.samples?.length === 30
      && startup.warm?.samples?.length === 30,
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    release: packageJson.version,
    proof: {
      source: "packaged-windows-native-runtime",
      synthetic: false,
      webOnly: false,
      requiredColdSamples: 30,
      requiredWarmSamples: 30,
      threshold: "<1000ms per sample",
    },
    checks,
    startup,
    passed,
  };
}

function parseArgs(args) {
  const options = { runStartup: true, iterations: 30 };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--no-startup") options.runStartup = false;
    if (args[index] === "--iterations") options.iterations = Number(args[++index]);
    if (args[index] === "--runtime") options.runtimePath = args[++index];
    if (args[index] === "--output") options.output = args[++index];
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const receipt = await createAcceptanceReceipt(options);
    const serialized = JSON.stringify(receipt, null, 2);
    if (options.output) writeFileSync(path.resolve(options.output), `${serialized}\n`);
    console.log(serialized);
    if (!receipt.passed) process.exitCode = 1;
  } catch (error) {
    const failure = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      release: existsSync(path.join(root, "package.json"))
        ? JSON.parse(read("package.json")).version
        : null,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
    console.log(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}
