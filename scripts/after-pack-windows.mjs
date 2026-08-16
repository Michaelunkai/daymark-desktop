import { access, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const RUNTIME_NAME = "Daymark Runtime.exe";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDirectory = context.packager.projectDir;
  const appDirectory = context.appOutDir;
  const launcherPath = path.join(appDirectory, "Daymark.exe");
  const runtimePath = path.join(appDirectory, RUNTIME_NAME);
  const sourcePath = path.join(projectDirectory, "desktop", "windows-launcher.cs");
  const iconPath = path.join(projectDirectory, "desktop", "assets", "daymark.ico");
  const resourceEditorPath = path.join(
    projectDirectory,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe",
  );
  const versionParts = context.packager.appInfo.version.split("-")[0].split(".").slice(0, 4);
  while (versionParts.length < 4) versionParts.push("0");
  const windowsVersion = versionParts.join(".");
  const frameworkDirectory = process.env.Framework64
    ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64");
  const compilerPath = path.join(frameworkDirectory, "v4.0.30319", "csc.exe");

  await Promise.all([access(compilerPath), access(resourceEditorPath), access(iconPath)]);
  await rename(launcherPath, runtimePath);

  const resourceResult = spawnSync(
    resourceEditorPath,
    [
      runtimePath,
      "--set-icon",
      iconPath,
      "--set-version-string",
      "FileDescription",
      "Daymark",
      "--set-version-string",
      "ProductName",
      "Daymark",
      "--set-version-string",
      "CompanyName",
      "Michael Fedorovsky",
      "--set-version-string",
      "InternalName",
      "Daymark Runtime",
      "--set-version-string",
      "OriginalFilename",
      RUNTIME_NAME,
      "--set-file-version",
      windowsVersion,
      "--set-product-version",
      windowsVersion,
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (resourceResult.error) throw resourceResult.error;
  if (resourceResult.status !== 0) {
    throw new Error(
      `Daymark runtime resource update failed (${resourceResult.status}).\n`
      + `${resourceResult.stdout}\n${resourceResult.stderr}`,
    );
  }

  const launcherResult = spawnSync(
    compilerPath,
    [
      "/nologo",
      "/target:winexe",
      "/platform:anycpu",
      `/win32icon:${iconPath}`,
      `/out:${launcherPath}`,
      sourcePath,
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (launcherResult.error) throw launcherResult.error;
  if (launcherResult.status !== 0) {
    throw new Error(
      `Daymark launcher compilation failed (${launcherResult.status}).\n`
      + `${launcherResult.stdout}\n${launcherResult.stderr}`,
    );
  }

  await Promise.all([access(launcherPath), access(runtimePath)]);
}
