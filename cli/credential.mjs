import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DaymarkCliError } from "./client.mjs";

const credentialDirectory = join(process.env.APPDATA || process.env.HOME || ".", "Daymark", "cli");
const credentialFile = join(credentialDirectory, "credential.dpapi");

export async function getAgentToken() {
  if (process.env.DAYMARK_AI_TOKEN) return process.env.DAYMARK_AI_TOKEN.trim();
  let protectedText;
  try { protectedText = await readFile(credentialFile, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") throw new DaymarkCliError("No Daymark AI key is configured. Run 'daymark auth login' or set DAYMARK_AI_TOKEN.", { code: "missing_credential" });
    throw error;
  }
  if (process.platform !== "win32") throw new DaymarkCliError("The stored key uses Windows DPAPI. Set DAYMARK_AI_TOKEN on this platform.");
  const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$base64=[IO.File]::ReadAllText($env:DAYMARK_CREDENTIAL_FILE).Trim();$protected=[Convert]::FromBase64String($base64);$plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($plain)";
  const result = runPowerShell(script, { DAYMARK_CREDENTIAL_FILE: credentialFile });
  if (result.status !== 0 || !result.stdout.trim()) throw new DaymarkCliError("The saved Daymark key could not be unlocked for this Windows account.");
  return result.stdout.trim();
}

export async function saveAgentTokenInteractively() {
  if (process.platform !== "win32") throw new DaymarkCliError("Interactive key storage requires Windows DPAPI. Set DAYMARK_AI_TOKEN instead.");
  if (!process.stdin.isTTY) throw new DaymarkCliError("Run 'daymark auth login' in an interactive terminal, or set DAYMARK_AI_TOKEN.");
  const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=Read-Host 'Paste Daymark AI key from Settings' -AsSecureString;if($s.Length -lt 20){exit 2};$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);$bytes=[Text.Encoding]::UTF8.GetBytes($plain);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);$encrypted=[Convert]::ToBase64String($protected);$dir=Split-Path -Parent $env:DAYMARK_CREDENTIAL_FILE;[IO.Directory]::CreateDirectory($dir)|Out-Null;[IO.File]::WriteAllText($env:DAYMARK_CREDENTIAL_FILE,$encrypted+[Environment]::NewLine,[Text.Encoding]::UTF8)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}";
  const result = runPowerShell(script, { DAYMARK_CREDENTIAL_FILE: credentialFile }, true);
  if (result.status !== 0) {
    throw new DaymarkCliError("No valid key was entered; the existing credential was left unchanged.");
  }
  return credentialFile;
}

export function credentialStatus() {
  return {
    environment: Boolean(process.env.DAYMARK_AI_TOKEN),
    credentialFile,
  };
}

function runPowerShell(script, extraEnvironment = {}, interactive = false) {
  const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return spawnSync(executable, ["-NoProfile", ...(interactive ? [] : ["-NonInteractive"]), "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
    stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: !interactive,
    maxBuffer: 64 * 1024,
  });
}
