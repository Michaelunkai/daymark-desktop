import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const reportPath = resolve(root, "artifacts/release-readiness.json");
const requiredEnv = {
  VITE_SUPABASE_URL: (value) => /^https:\/\/[a-z0-9-]+\.supabase\.co(?:\/.*)?$/i.test(value ?? ""),
  VITE_SUPABASE_ANON_KEY: (value) => typeof value === "string" && value.length >= 20,
  SUPABASE_ACCESS_TOKEN: (value) => typeof value === "string" && value.length >= 20,
  SUPABASE_PROJECT_REF: (value) => /^[a-z0-9-]{10,}$/i.test(value ?? ""),
  VERCEL_TOKEN: (value) => typeof value === "string" && value.length >= 10,
  VERCEL_ORG_ID: (value) => typeof value === "string" && value.length >= 3,
  VERCEL_PROJECT_ID: (value) => typeof value === "string" && value.length >= 3,
};

function run(command, args) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  return {
    command: [executable, ...args].join(" "),
    ok: result.status === 0,
    exitCode: result.status ?? 1,
  };
}

function git(args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

const branch = git(["branch", "--show-current"]).stdout.trim();
const commit = git(["rev-parse", "HEAD"]).stdout.trim();
const integrationCommit =
  process.env.DAYMARK_INTEGRATION_COMMIT ?? "9b721a04286bae770cdb76f32d937b9f734dbbe1";
const integrationCommitIsAncestor =
  git(["merge-base", "--is-ancestor", integrationCommit, "HEAD"]).status === 0;
const porcelain = git(["status", "--porcelain"]).stdout
  .split(/\r?\n/)
  .filter((line) => line && !line.endsWith("artifacts/release-readiness.json"))
  .join("\n");
const environment = Object.fromEntries(
  Object.entries(requiredEnv).map(([name, validate]) => [
    name,
    {
      present: Boolean(process.env[name]),
      validShape: validate(process.env[name]),
    },
  ]),
);

const checks = [
  run(process.execPath, ["scripts/validate-env.mjs"]),
  run("npm", ["run", "lint"]),
  run("npm", ["run", "typecheck"]),
  run("npm", ["test"]),
  run("npm", ["run", "rebuild"]),
  run("npm", ["run", "audit"]),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: {
    branch,
    commit,
    integrationCommit,
    integrationCommitIsAncestor,
    clean: porcelain.length === 0,
  },
  environment,
  localVerification: checks,
  externalReleaseReady: Object.values(environment).every(({ present, validShape }) => present && validShape),
  localVerificationPassed: checks.every(({ ok }) => ok),
};

report.releaseReady =
  report.repository.branch === "codex/recovery-daymark-9b721a0" &&
  report.repository.integrationCommitIsAncestor &&
  report.repository.clean &&
  report.externalReleaseReady &&
  report.localVerificationPassed;

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`RELEASE_PREFLIGHT_REPORT ${reportPath}`);
console.log(`RELEASE_PREFLIGHT_READY ${report.releaseReady ? "true" : "false"}`);
process.exitCode = report.releaseReady ? 0 : 1;
