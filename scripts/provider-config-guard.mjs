#!/usr/bin/env node
// Provider config guard: keeps ZCode CLI built-in provider config present at both search roots.
// Copy-only; never edits content; never deletes anything. Safe to re-run every 5 minutes.
import { existsSync, mkdirSync, copyFileSync, statSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SOURCE = 'F:/backup/windowsapps/installed/ZCode/resources/config/provider/zcode-builtin.json';
const LOG = 'F:/backup/ai/daymark-zcode-bridge/provider-guard.log';
const ROOTS = [
  'F:/backup/windowsapps/installed/ZCode/resources/glm/provider/zcode-builtin.json',
  'F:/backup/config/provider/zcode-builtin.json',
];
const TOLERANCE = 0.10; // >10% size drift triggers restore

function log(msg) {
  appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
  console.log(msg);
}

if (!existsSync(SOURCE)) {
  log('FATAL: known-good source missing: ' + SOURCE + ' — not guessing another source. Exit 1.');
  process.exit(1);
}
const srcSize = statSync(SOURCE).size;

let failures = 0;
for (const root of ROOTS) {
  try {
    let needsCopy = false;
    let reason = '';
    if (!existsSync(root)) {
      needsCopy = true;
      reason = 'missing';
    } else {
      const size = statSync(root).size;
      const drift = Math.abs(size - srcSize) / srcSize;
      if (drift > TOLERANCE) {
        needsCopy = true;
        reason = `size drift ${(drift * 100).toFixed(1)}% (${size} vs ${srcSize})`;
      }
    }
    if (needsCopy) {
      mkdirSync(dirname(root), { recursive: true });
      copyFileSync(SOURCE, root);
      log(`REPAIRED ${root} (${reason}); copied from ${SOURCE}`);
    } else {
      log(`OK ${root}`);
    }
  } catch (err) {
    failures++;
    log(`ERROR handling ${root}: ${err && err.message}`);
  }
}

if (failures > 0) {
  log(`Done with ${failures} error(s). Exit 1.`);
  process.exit(1);
}
log('All roots valid. Exit 0.');
