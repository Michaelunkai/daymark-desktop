#!/usr/bin/env node
/**
 * Verification harness for the AIControlPanel live-board features.
 *
 *   node scripts/verify-control-features.mjs --baseline  build + suites must be green (repo not broken)
 *   node scripts/verify-control-features.mjs --full      baseline + dist bundle contains every feature marker
 *   node scripts/verify-control-features.mjs --help
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const STEPS = [
  { name: 'vite build', cmd: ['npx', 'vite', 'build'] },
  { name: 'test:features', cmd: ['npm', 'run', 'test:features'] },
  { name: 'test:shell', cmd: ['npm', 'run', 'test:shell'] },
  { name: 'control-panel contract', cmd: ['node', '--test', 'src/control-panel-contract.test.mjs'] },
];

const BUNDLE_MARKERS = [
  'control-panel__finished-delete-all',
  'control-card--paused',
  'control-card__age',
  'usage-meter',
  '5-min law',
  'PAUSED',
];

const WORKSPACE_FILES = [
  'src/features/workspace/board-model.ts',
  'src/features/workspace/health.ts',
  'src/features/workspace/icons.tsx',
  'src/features/workspace/UsageMeters.tsx',
  'src/features/workspace/scroll.ts',
  'src/features/workspace/usage-source.ts',
];

function run(label, args) {
  try {
    execFileSync(args[0], args.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    console.log(`PASS  ${label}`);
    return true;
  } catch (error) {
    console.log(`FAIL  ${label}`);
    const tail = String(error.stderr || error.stdout || '')
      .trim()
      .split(/\r?\n/)
      .slice(-15)
      .join('\n');
    if (tail) console.log(tail.split('\n').map((line) => `      ${line}`).join('\n'));
    return false;
  }
}

function readDistBundles() {
  const dir = join(ROOT, 'dist');
  if (!existsSync(dir)) return '';
  const chunks = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) chunks.push(readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return chunks.join('\n');
}

const mode = process.argv[2] ?? '--baseline';
if (mode === '--help' || mode === '-h') {
  console.log('Usage: node scripts/verify-control-features.mjs [--baseline | --full]');
  process.exit(0);
}

let ok = true;
for (const step of STEPS) ok = run(step.name, step.cmd) && ok;

if (mode === '--full') {
  const bundles = readDistBundles();
  for (const marker of BUNDLE_MARKERS) {
    const pass = bundles.includes(marker);
    console.log(`${pass ? 'PASS' : 'FAIL'}  dist bundle contains "${marker}"`);
    ok = pass && ok;
  }
  for (const file of WORKSPACE_FILES) {
    const pass = existsSync(join(ROOT, file));
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${file} exists`);
    ok = pass && ok;
  }
}

console.log(ok ? 'RESULT: all checks passed' : 'RESULT: failures above');
process.exit(ok ? 0 : 1);

// SLICE-DONE: qa-tester
