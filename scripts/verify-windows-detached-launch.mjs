import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark.exe");
const runtimeExecutablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(path.dirname(executablePath), "Daymark Runtime.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const commandPrompt = process.env.ComSpec ?? path.join(systemRoot, "System32", "cmd.exe");
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const timeoutMs = 10000;

await mkdir(evidenceDirectory, { recursive: true });

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}

function runShell({ name, file, args, input }) {
  return new Promise((resolve, reject) => {
    const shell = spawn(file, args, {
      cwd: path.dirname(executablePath),
      env: {
        ...process.env,
        NODE_OPTIONS: "--dns-result-order=ipv4first",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const startedAt = performance.now();
    const timer = setTimeout(() => {
      shell.kill();
      reject(new Error(`${name} did not return within ${timeoutMs} ms.`));
    }, timeoutMs);

    shell.stdout.setEncoding("utf8");
    shell.stderr.setEncoding("utf8");
    shell.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    shell.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    shell.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    shell.once("exit", (code) => {
      clearTimeout(timer);
      resolve({
        name,
        code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
      });
    });
    shell.stdin.end(input);
  });
}

function runPowerShell(command) {
  return spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
  );
}

function findDaymarkWindow() {
  const exe = escapePowerShell(runtimeExecutablePath);
  const result = runPowerShell(`
    $process = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq '${exe}' -and $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
    if (-not $process) { exit 1 }
    [pscustomobject]@{
      id = $process.Id
      title = $process.MainWindowTitle
      responding = $process.Responding
      path = $process.Path
    } | ConvertTo-Json -Compress
  `);
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return JSON.parse(result.stdout.trim());
}

async function waitForDaymarkWindow() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const window = findDaymarkWindow();
    if (window) return window;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("The detached Daymark window did not appear within 60 seconds.");
}

async function closeDaymark() {
  const exe = escapePowerShell(runtimeExecutablePath);
  runPowerShell(`
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq '${exe}' -and $_.MainWindowHandle -ne 0 } |
      ForEach-Object { [void]$_.CloseMainWindow() }
  `);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const window = findDaymarkWindow();
    if (!window) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The detached Daymark window did not close cleanly.");
}

async function verifyShell(name, file, args, command) {
  const marker = `__DAYMARK_${name.toUpperCase().replaceAll(" ", "_")}_RETURNED__`;
  const profilePath = path.join(
    evidenceDirectory,
    `detach-${name.toLowerCase().replaceAll(" ", "-")}-${Date.now()}`,
  );
  const result = await runShell({
    name,
    file,
    args,
    input: command(executablePath, profilePath, marker),
  });
  if (result.code !== 0 || !result.stdout.includes(marker)) {
    throw new Error(`${name} did not continue after Daymark launch: ${JSON.stringify(result)}`);
  }
  if (result.stderr.trim()) {
    throw new Error(`${name} received terminal output after launch: ${JSON.stringify(result)}`);
  }
  const window = await waitForDaymarkWindow();
  if (!window.responding || window.path !== runtimeExecutablePath || !window.title) {
    throw new Error(`${name} left an invalid Daymark window: ${JSON.stringify(window)}`);
  }
  await closeDaymark();
  return {
    shell: name,
    shellExitMs: result.durationMs,
    promptReturned: true,
    appRemainedRunning: true,
    appResponding: window.responding,
    windowTitle: window.title,
    terminalStderr: result.stderr,
  };
}

if (findDaymarkWindow()) {
  throw new Error("Close Daymark before running detached-launch verification.");
}

const commandPromptResult = await verifyShell(
  "Command Prompt",
  commandPrompt,
  ["/d", "/q"],
  (exe, profile, marker) => (
    `"${exe}" "--daymark-user-data-dir=${profile}"\r\n`
    + `echo ${marker}\r\n`
    + "exit\r\n"
  ),
);

const powershellResult = await verifyShell(
  "PowerShell",
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"],
  (exe, profile, marker) => (
    `& '${escapePowerShell(exe)}' '--daymark-user-data-dir=${escapePowerShell(profile)}'\r\n`
    + `Write-Output '${marker}'\r\n`
    + "exit\r\n"
  ),
);

console.log(JSON.stringify({
  ok: true,
  executablePath,
  runtimeExecutablePath,
  nodeOptions: "--dns-result-order=ipv4first",
  results: [commandPromptResult, powershellResult],
}));
