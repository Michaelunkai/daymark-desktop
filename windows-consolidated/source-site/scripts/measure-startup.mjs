import { performance } from "node:perf_hooks";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STARTUP_THRESHOLD_MS = 1_000;
export const REQUIRED_ITERATIONS = 30;
export const STARTUP_EVENT_NAME = "startup:renderer-ready-visible";
export const PACKAGED_RUNTIME_NAME = "Daymark Runtime.exe";
export const PACKAGED_LAUNCHER_NAME = "Daymark.exe";
export const STARTUP_TRACE_PREFIX = "DAYMARK_STARTUP_TRACE ";

const STARTUP_ARGUMENT = "--daymark-detached-child";
const STARTUP_WAIT_TIMEOUT_MS = STARTUP_THRESHOLD_MS;
const PROCESS_CLEANUP_TIMEOUT_MS = 1_500;
const MAX_OUTPUT_BYTES = 64 * 1024;

function readPackage(rootDirectory) {
  const packagePath = path.join(rootDirectory, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(`Package manifest is missing: ${packagePath}`);
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`Package manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error("Package manifest does not declare a release version.");
  }
  const packagedFiles = packageJson.build?.files;
  if (
    !Array.isArray(packagedFiles)
    || !packagedFiles.includes("desktop/**/*")
    || !packagedFiles.includes("dist/client/**/*")
  ) {
    throw new Error("Package manifest does not include the desktop runtime and built client.");
  }

  return { packagePath, packageJson };
}

function regularFile(pathname, label) {
  try {
    const stats = statSync(pathname);
    if (!stats.isFile()) throw new Error("not a regular file");
    return stats;
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${pathname} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function packagedRuntimePath(rootDirectory, runtimePath) {
  return path.resolve(
    runtimePath
      ?? process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
      ?? path.join(rootDirectory, "release", "windows", "win-unpacked", PACKAGED_RUNTIME_NAME),
  );
}

export function resolvePackagedRuntime({
  rootDirectory = root,
  runtimePath,
} = {}) {
  if (process.platform !== "win32") {
    throw new Error("Packaged Windows startup proof requires a Windows host.");
  }

  const resolvedRoot = path.resolve(rootDirectory);
  const { packagePath, packageJson } = readPackage(resolvedRoot);
  const executablePath = packagedRuntimePath(resolvedRoot, runtimePath);
  if (path.basename(executablePath) !== PACKAGED_RUNTIME_NAME) {
    throw new Error(`Startup proof only accepts ${PACKAGED_RUNTIME_NAME}.`);
  }

  const applicationDirectory = path.dirname(executablePath);
  const launcherPath = path.join(applicationDirectory, PACKAGED_LAUNCHER_NAME);
  const appAsarPath = path.join(applicationDirectory, "resources", "app.asar");
  const runtimeStats = regularFile(executablePath, "Packaged runtime");
  const launcherStats = regularFile(launcherPath, "Packaged launcher");
  const appAsarStats = regularFile(appAsarPath, "Packaged app.asar");

  if (runtimeStats.size < 1 || launcherStats.size < 1 || appAsarStats.size < 1) {
    throw new Error("Packaged runtime provenance files must be non-empty.");
  }

  return {
    rootDirectory: resolvedRoot,
    packagePath,
    packageVersion: packageJson.version,
    executablePath,
    launcherPath,
    appAsarPath,
  };
}

export function parseStartupTraceLine(line) {
  if (!line.startsWith(STARTUP_TRACE_PREFIX)) return null;
  try {
    const event = JSON.parse(line.slice(STARTUP_TRACE_PREFIX.length));
    if (!event || typeof event !== "object") return null;
    return event;
  } catch {
    return null;
  }
}

function appendOutput(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function forceStopChildTree(child) {
  if (process.platform !== "win32" || !Number.isInteger(child?.pid)) {
    try {
      child?.kill();
    } catch {
      // The process may have exited between cleanup attempts.
    }
    return;
  }

  const taskkill = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "taskkill.exe",
  );
  spawnSync(
    taskkill,
    ["/PID", String(child.pid), "/T", "/F"],
    { stdio: "ignore", timeout: PROCESS_CLEANUP_TIMEOUT_MS, windowsHide: true },
  );
}

async function stopChild(child, closePromise) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    child.kill();
  } catch {
    // The process may have exited between the state check and kill.
  }
  const closed = await Promise.race([
    closePromise.then(() => true),
    wait(PROCESS_CLEANUP_TIMEOUT_MS).then(() => false),
  ]);
  if (closed || child.exitCode !== null || child.signalCode !== null) return true;

  forceStopChildTree(child);
  return Promise.race([
    closePromise.then(() => true),
    wait(PROCESS_CLEANUP_TIMEOUT_MS).then(() => false),
  ]);
}

function startupEnvironment(profileDirectory) {
  const environment = {
    ...process.env,
    DAYMARK_ACCEPTANCE_EVENTS: "1",
    DAYMARK_STARTUP_TRACE: "1",
    DAYMARK_VERIFY_EXIT: "1",
    DAYMARK_USER_DATA_DIR: profileDirectory,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

export async function runPackagedStartupSample({
  runtime,
  profileDirectory,
  kind,
  iteration,
  timeoutMs = STARTUP_WAIT_TIMEOUT_MS,
}) {
  mkdirSync(profileDirectory, { recursive: true });
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let pendingOutput = "";
    let closeResult = null;
    let closeResolve;
    let timeoutHandle;
    const closePromise = new Promise((resolveClose) => {
      closeResolve = resolveClose;
    });

    const finish = async (error, event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      const observedElapsedMs = Number((performance.now() - startedAt).toFixed(3));
      const stopped = await stopChild(child, closePromise);

      if (error) {
        const detail = stderr.trim() || stdout.trim();
        const suffix = detail ? ` Output: ${detail.slice(-1_000)}` : "";
        const cleanupSuffix = stopped ? "" : " Launched runtime did not exit within the cleanup deadline.";
        reject(new Error(`${kind} startup sample ${iteration} failed: ${error.message}${cleanupSuffix}${suffix}`));
        return;
      }
      if (!stopped) {
        reject(new Error(
          `${kind} startup sample ${iteration} failed: launched runtime did not exit within the cleanup deadline.`,
        ));
        return;
      }

      resolve({
        kind,
        iteration,
        profileMode: kind === "cold" ? "fresh-profile" : "reused-profile",
        pid: child.pid,
        elapsedMs: observedElapsedMs,
        nativeTrace: true,
        event: {
          name: event.name,
          version: event.version,
          elapsedMs: event.elapsedMs,
          at: event.at,
        },
        exit: closeResult,
      });
    };

    const consume = (chunk) => {
      stdout = appendOutput(stdout, chunk);
      pendingOutput = appendOutput(pendingOutput, chunk);
      const lines = pendingOutput.split(/\r?\n/);
      pendingOutput = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseStartupTraceLine(line);
        if (!event || event.name !== STARTUP_EVENT_NAME) continue;
        if (event.version !== runtime.packageVersion) {
          void finish(new Error(
            `Native startup trace version ${JSON.stringify(event.version)} does not match package ${runtime.packageVersion}.`,
          ));
          return;
        }
        if (
          typeof event.elapsedMs !== "number"
          || !Number.isFinite(event.elapsedMs)
          || event.elapsedMs < 0
        ) {
          void finish(new Error("Native startup trace has an invalid elapsedMs value."));
          return;
        }
        void finish(null, event);
        return;
      }
    };

    try {
      child = spawn(
        runtime.executablePath,
        [
          STARTUP_ARGUMENT,
          `--daymark-user-data-dir=${profileDirectory}`,
        ],
        {
          cwd: path.dirname(runtime.executablePath),
          env: startupEnvironment(profileDirectory),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      void finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", consume);
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      void finish(error);
    });
    child.once("close", (code, signal) => {
      closeResult = { code, signal };
      closeResolve(closeResult);
      if (!settled) {
        void finish(new Error(`Process exited before ${STARTUP_EVENT_NAME} was observed.`));
      }
    });
    timeoutHandle = setTimeout(() => {
      void finish(new Error(
        `Native startup trace was not observed within ${timeoutMs} ms.`,
      ));
    }, timeoutMs);
  });
}

function summarize(records) {
  const samples = records.map((record) => record.elapsedMs);
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return {
    samples,
    records,
    sampleCount: records.length,
    maxMs: Math.max(...samples),
    p95Ms: percentile,
    meanMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
    measured: records.length === REQUIRED_ITERATIONS
      && records.every((record) => (
        record.nativeTrace
        && record.event?.name === STARTUP_EVENT_NAME
        && record.profileMode
        && Number.isFinite(record.elapsedMs)
      )),
    underThreshold: samples.length === REQUIRED_ITERATIONS
      && samples.every((value) => Number.isFinite(value) && value < STARTUP_THRESHOLD_MS),
  };
}

async function removeProfile(profileDirectory) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      if (!existsSync(profileDirectory)) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  const suffix = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(`Could not remove isolated startup profile: ${profileDirectory}${suffix}`);
}

export async function measureStartup({
  iterations = REQUIRED_ITERATIONS,
  rootDirectory = root,
  runtimePath,
} = {}) {
  if (!Number.isInteger(iterations) || iterations !== REQUIRED_ITERATIONS) {
    throw new TypeError(`iterations must be exactly ${REQUIRED_ITERATIONS} for acceptance proof`);
  }

  const runtime = resolvePackagedRuntime({ rootDirectory, runtimePath });
  const evidenceDirectory = mkdtempSync(path.join(os.tmpdir(), "daymark-startup-proof-"));
  const coldRecords = [];
  const warmRecords = [];
  const warmProfile = path.join(evidenceDirectory, "warm-profile");

  try {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const coldProfile = path.join(evidenceDirectory, `cold-profile-${iteration}`);
      coldRecords.push(await runPackagedStartupSample({
        runtime,
        profileDirectory: coldProfile,
        kind: "cold",
        iteration,
      }));
      await removeProfile(coldProfile);
    }

    await runPackagedStartupSample({
      runtime,
      profileDirectory: warmProfile,
      kind: "warmup",
      iteration: 0,
    });
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      warmRecords.push(await runPackagedStartupSample({
        runtime,
        profileDirectory: warmProfile,
        kind: "warm",
        iteration,
      }));
    }
  } finally {
    await removeProfile(evidenceDirectory);
  }

  const cold = summarize(coldRecords);
  const warm = summarize(warmRecords);
  return {
    proofVersion: 2,
    platform: process.platform,
    iterations,
    thresholdMs: STARTUP_THRESHOLD_MS,
    event: STARTUP_EVENT_NAME,
    measurement: "packaged-native-runtime-process",
    synthetic: false,
    webOnly: false,
    runtime: {
      executablePath: runtime.executablePath,
      launcherPath: runtime.launcherPath,
      appAsarPath: runtime.appAsarPath,
      packageVersion: runtime.packageVersion,
      packagePath: runtime.packagePath,
    },
    cold,
    warm,
    passed: cold.measured
      && warm.measured
      && cold.underThreshold
      && warm.underThreshold,
  };
}

function parseArgs(args) {
  const options = { iterations: REQUIRED_ITERATIONS };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--iterations") options.iterations = Number(args[++index]);
    if (args[index] === "--json") options.json = true;
    if (args[index] === "--runtime") options.runtimePath = args[++index];
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await measureStartup(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`cold max=${result.cold.maxMs}ms p95=${result.cold.p95Ms}ms samples=${result.cold.sampleCount}`);
      console.log(`warm max=${result.warm.maxMs}ms p95=${result.warm.p95Ms}ms samples=${result.warm.sampleCount}`);
      console.log(`packaged native startup threshold <${result.thresholdMs}ms: ${result.passed ? "PASS" : "FAIL"}`);
    }
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
