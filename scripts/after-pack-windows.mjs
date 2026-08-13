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
  const frameworkDirectory = process.env.Framework64
    ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64");
  const compilerPath = path.join(frameworkDirectory, "v4.0.30319", "csc.exe");

  await access(compilerPath);
  await rename(launcherPath, runtimePath);

  const result = spawnSync(
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

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Daymark launcher compilation failed (${result.status}).\n${result.stdout}\n${result.stderr}`,
    );
  }

  await Promise.all([access(launcherPath), access(runtimePath)]);
}
