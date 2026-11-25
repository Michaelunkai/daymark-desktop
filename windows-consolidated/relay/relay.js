#!/usr/bin/env node
// v2 — every-button-perfect
// daymark-relay: enforces Daymark control-panel orders (pause/resume, ack light) on this PC.
// Zero npm dependencies. Plain node:http(s). Single instance via lock file.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const RELAY_DIR = __dirname;
const ZCODE_DIR = 'C:\\Users\\Admin\\.zcode';
const SYNCKEY_FILE = path.join(ZCODE_DIR, 'synckey.txt');
const REGISTRY_FILE = path.join(ZCODE_DIR, 'control-registry.json');
const STATE_FILE = path.join(ZCODE_DIR, 'relay-state.json');
// The bridge's launch map: every spawned session pid, used as a force-pause
// fallback when a paused card has no control-registry entry.
const BRIDGE_STATE_FILE = 'F:\\backup\\windowsapps\\installed\\daymark\\bridges\\zcode\\state.json';
const LOCK_FILE = path.join(RELAY_DIR, 'relay.lock');
const LOG_FILE = path.join(RELAY_DIR, 'daymark-relay.log');
const SUSPEND_PS1 = path.join(RELAY_DIR, 'suspend-tree.ps1');
// BACKEND LAW (2026-10-23): local server on this PC is the permanent backend
// (cloud origin is dead for writes; no Codex / ChatGPT account ever needed).
const API_BASE = 'http://127.0.0.1:18780';
const POLL_MS = 2000;
const JOURNAL_RE = /^—\s*([A-Za-z]+)\s+(\d{1,2}:\d{2})\s+—\s*(.*)$/;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    try { if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (e) {}
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { /* keep running */ }
  console.log(line);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- single instance ----------
function acquireLock() {
  try {
    const existing = readJson(LOCK_FILE, null);
    if (existing && existing.pid) {
      try { process.kill(existing.pid, 0); } catch (e) {
        log(`stale lock from pid ${existing.pid}; taking over`);
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        return true;
      }
      log(`another instance already running (pid ${existing.pid}); exiting`);
      return false;
    }
  } catch (e) { /* fall through */ }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return true;
}

// ---------- sync fetch ----------
function fetchSync() {
  return new Promise((resolve, reject) => {
    let key;
    try { key = fs.readFileSync(SYNCKEY_FILE, 'utf8').trim(); } catch (e) {
      return reject(new Error('synckey.txt unreadable: ' + e.message));
    }
    if (!key) return reject(new Error('synckey.txt empty'));
    const req = http.request(API_BASE + '/api/sync/' + encodeURIComponent(key), { method: 'GET', timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`sync GET ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('sync JSON parse: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('sync GET timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ---------- journal parsing ----------
// Journal lines sit at the top of description; newest line is topmost.
// Returns array of {word, time, text} in top-down (newest-first) order.
function journalLines(description) {
  const out = [];
  const text = typeof description === 'string' ? description : '';
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(JOURNAL_RE);
    if (!m) {
      if (out.length > 0) break; // journal block ended
      continue;
    }
    out.push({ word: m[1].toLowerCase(), time: m[2], text: m[3], raw: line.trim() });
  }
  return out;
}

function latestOf(lines, words) {
  for (const l of lines) if (words.includes(l.word)) return l;
  return null;
}

// ---------- process tree ----------
function listProcesses() {
  return new Promise((resolve, reject) => {
    // pid -> parentPid, via PowerShell CIM (wmic is deprecated)
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        let arr = JSON.parse(stdout);
        if (!Array.isArray(arr)) arr = [arr];
        resolve(arr.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: String(p.Name || '') })));
      } catch (e) { reject(e); }
    });
  });
}

function pidAlive(pid, procs) { return procs.some((p) => p.pid === pid); }

// Cached process sweep: flip DETECTION tolerates a few seconds of staleness,
// but suspend/resume actions must call getProcs(0) for a fresh sweep.
let procsCache = { at: 0, list: [] };
async function getProcs(maxAgeMs = 8000) {
  if (Date.now() - procsCache.at <= maxAgeMs) return procsCache.list;
  try {
    const list = await listProcesses();
    procsCache = { at: Date.now(), list };
  } catch (e) {
    // A hung/failed sweep must never freeze the poll loop: reuse the last
    // good sweep (possibly empty) and try again next round.
    log(`process sweep failed (${e.message}); reusing cached sweep`);
  }
  return procsCache.list;
}

// Processes we must NEVER suspend. Anything else may be suspended while walking
// the chain upward; ZCode.exe and system-level processes hard-stop the walk.
const CRITICAL_NAMES = new Set([
  'zcode.exe', 'svchost.exe', 'services.exe', 'wininit.exe', 'winlogon.exe',
  'csrss.exe', 'lsass.exe', 'smss.exe', 'system', 'registry', 'memcompression',
]);

// Suspensible set: DESCENDANTS-ONLY of the innermost registered pid. Never
// walks ancestors — an upward walk once cross-froze unrelated tasks sharing a
// parent, and must not be restored.
function chainSuspendSet(entry, procs, excludePids) {
  const out = [];
  const seen = new Set();
  const excluded = excludePids instanceof Set ? excludePids : new Set();
  const consider = (pid) => {
    if (!pid || seen.has(pid) || excluded.has(pid)) return false;
    const p = procs.find((x) => x.pid === pid);
    if (!p) return false;
    const name = (p.name || '').toLowerCase();
    if (CRITICAL_NAMES.has(name)) return false; // hard stop, do not suspend
    seen.add(pid);
    out.push(pid);
    return true;
  };
  // descendants of the innermost process (the session's own child tree)
  const innermost = (typeof entry.pid === 'number' && entry.pid) || (Array.isArray(entry.chain) && entry.chain[0] && entry.chain[0].pid);
  if (!innermost) return [];
  const queue = [innermost];
  while (queue.length) {
    const cur = queue.shift();
    if (!seen.has(cur)) consider(cur);
    for (const p of procs) if (p.ppid === cur && !CRITICAL_NAMES.has((p.name || '').toLowerCase())) queue.push(p.pid);
  }
  return out;
}

function applyPidsOp(pids, resume) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SUSPEND_PS1, '-PidsCsv', pids.join(',')];
    if (resume) args.push('-Resume');
    execFile('powershell.exe', args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

// ---------- registry ----------
function pruneRegistry(procs) {
  const reg = readJson(REGISTRY_FILE, null);
  if (reg === null) {
    writeJsonAtomic(REGISTRY_FILE, {});
    log('registry missing; created empty control-registry.json');
    return {};
  }
  const CRIT = ['zcode.exe', 'svchost.exe', 'services.exe', 'wininit.exe', 'winlogon.exe', 'csrss.exe', 'lsass.exe', 'smss.exe', 'system'];
  let changed = false;
  for (const taskId of Object.keys(reg)) {
    const e = reg[taskId];
    if (!e) { delete reg[taskId]; changed = true; continue; }
    // Entry is alive if its innermost pid is alive, or any non-critical chain link is alive.
    let alive = typeof e.pid === 'number' && pidAlive(e.pid, procs);
    if (!alive && Array.isArray(e.chain)) {
      alive = e.chain.some((link) => {
        if (!link || typeof link.pid !== 'number') return false;
        const p = procs.find((x) => x.pid === link.pid);
        return p && !CRIT.includes((p.name || '').toLowerCase());
      });
    }
    if (!alive) {
      log(`registry prune: ${taskId} no live pid in entry (chain ${Array.isArray(e.chain) ? e.chain.length : 0} links)`);
      delete reg[taskId];
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(REGISTRY_FILE, reg);
  return reg;
}

// ---------- watchdog heartbeat (user demand: every In Progress task always shows fresh life) ----------
// Writes go through dm-ops.mjs, which owns the authenticated agent credential.
const DM_OPS = 'F:\\backup\\windowsapps\\installed\\daymark\\skills\\mark\\scripts\\dm-ops.mjs';
function localHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function journalAgeMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  return (now - (h * 60 + m) + 1440) % 1440;
}
function readTaskDescription(taskId, cb) {
  execFile('node', [DM_OPS, 'api', 'GET', '//api/agent/v1/tasks/' + taskId], { timeout: 30000 }, (err, stdout) => {
    if (err) return cb(err);
    try { cb(null, JSON.parse(stdout).result.task.description || ''); } catch (e) { cb(e); }
  });
}

function writeTaskDescription(taskId, description, cb) {
  // Raw agent-API PATCH (NOT `dm-ops update tasks`, whose carried
  // projectId/sectionId can trip server schema/conflict validation on some
  // records) — proven reliable for description-only writes.
  // BOARD CAP: descriptions over ~20k chars are rejected with a schema error.
  // When that happens, compress the OLDEST (bottom) lines into one summary
  // line and retry once — the watchdog can never be silenced by a full card.
  const attempt = (desc, retry) => {
    const payload = path.join(process.env.TEMP || RELAY_DIR, 'relay-hb-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.json');
    fs.writeFileSync(payload, JSON.stringify({ description: desc, idempotencyKey: 'relay-' + Date.now() + '-' + taskId }));
    execFile('node', [DM_OPS, 'api', 'PATCH', '//api/agent/v1/tasks/' + taskId, payload], { timeout: 30000 }, (err, stdout) => {
      try { fs.unlinkSync(payload); } catch (e) {}
      const out = String(stdout || '') + String(err && err.message || '');
      if (err && retry && (/schema/i.test(out) || desc.length > 19000)) {
        const lines = desc.split('\n');
        const keepHead = lines.slice(0, Math.max(4, Math.floor(lines.length * 0.3)));
        const compressed = keepHead.join('\n') + '\n— update — older activity compressed to stay under the board size cap.';
        log(`writeTaskDescription ${taskId}: board cap hit — compressing ${lines.length} -> ${compressed.split('\n').length} lines and retrying`);
        return attempt(compressed, false);
      }
      cb(err, stdout);
    });
  };
  attempt(description, true);
}

// ---------- main poll ----------
let busy = false;
let lastPollLog = { rev: null, at: 0 };
let lastPollDone = Date.now();
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const state = readJson(STATE_FILE, { suspendedTrees: {}, ackedLines: [] });
    // 2s cadence: enumerate processes only when the registry or suspended
    // state actually needs pid checks — a CIM sweep every poll would churn.
    const registryCount = Object.keys(readJson(REGISTRY_FILE, {})).length;
    const needProcs = registryCount > 0 || Object.keys(state.suspendedTrees).length > 0;
    const procs = needProcs ? await getProcs() : [];
    // Never prune against an empty/failed sweep — that would wipe the registry.
    const registry = needProcs && procs.length ? pruneRegistry(procs) : readJson(REGISTRY_FILE, {});
    if (!state.suspendedTrees) state.suspendedTrees = {};
    if (!state.ackedLines) state.ackedLines = [];
    if (!state.lastPauseState) state.lastPauseState = {};
    if (!state.resumeOrders) state.resumeOrders = {};
    if (!state.handEscalated) state.handEscalated = {};

    const sync = await fetchSync();
    const projects = Object.values(sync.state.projects || {}).filter((p) => p && p.name === 'AIControlPanel');
    const projectIds = new Set(projects.map((p) => p.id));
    // sections: top-level map (project sections are nested but ids are global)
    const sectionNames = {};
    for (const s of Object.values(sync.state.sections || {})) if (s && s.id) sectionNames[s.id] = s.name;
    // tasks: state.tasks is flat with projectId; dedupe by task id across both AIControlPanel projects
    const tasksById = new Map();
    for (const t of Object.values(sync.state.tasks || {})) {
      if (t && t.id && projectIds.has(t.projectId) && !tasksById.has(t.id)) tasksById.set(t.id, t);
    }
    if (sync.revision !== lastPollLog.rev || Date.now() - lastPollLog.at > 60000) {
      log(`poll: revision ${sync.revision} ${projects.length} AIControlPanel project(s), ${tasksById.size} task(s), registry ${Object.keys(registry).length}`);
      lastPollLog = { rev: sync.revision, at: Date.now() };
    }

    // Newly-paused tasks collected during this pass; suspended in ONE batch
    // after the loop (user law: pause-all freezes every session with zero
    // delay — a serial sweep+suspend per task stretched a multi-session
    // pause to tens of seconds).
    const pendingSuspends = [];

    for (const task of tasksById.values()) {
      const lines = journalLines(task.description);
      if (process.env.RELAY_DEBUG) log(`debug task=${task.id} lines=${JSON.stringify(lines.map((l) => l.word))} reg=${!!registry[task.id]}`);
      const paused = latestOf(lines, ['paused']);
      const resumed = latestOf(lines, ['resumed']);
      const newestPause = (paused && resumed) ? (lines.indexOf(paused) < lines.indexOf(resumed) ? paused : resumed) : (paused || resumed);
      // FORCE-PAUSE coverage (user law: pause-all suspends EVERY session, no
      // exceptions): the registry is the primary PID source; when a paused task
      // has no registry entry, fall back to the bridge's own launch map
      // (state.json) which records every spawned session pid.
      if (newestPause && newestPause.word === 'paused' && !registry[task.id]) {
        try {
          const bridgeState = readJson(BRIDGE_STATE_FILE, { launched: {} });
          const rec = (bridgeState.launched || {})[task.id];
          if (rec && Number.isInteger(rec.pid) && rec.pid > 0) {
            registry[task.id] = { pid: rec.pid, name: 'bridge-fallback', chain: [{ pid: rec.pid }] };
            log(`registry fallback for ${task.id}: pid ${rec.pid} from bridge state`);
          }
        } catch (e) { log(`registry fallback read ERR: ${e.message}`); }
      }

      if (newestPause && newestPause.word === 'paused' && registry[task.id]) {
        const entry = registry[task.id];
        const innerPid = (typeof entry.pid === 'number' && entry.pid) || (Array.isArray(entry.chain) && entry.chain[0] && entry.chain[0].pid);
        if (!innerPid || !pidAlive(innerPid, procs)) { if (process.env.RELAY_DEBUG) log(`debug task=${task.id} inner pid missing/dead`); continue; }
        if (state.suspendedTrees[task.id]) continue; // already suspended
        pendingSuspends.push({ taskId: task.id, entry });
      } else if (newestPause && newestPause.word === 'resumed' && state.suspendedTrees[task.id]) {
        // RESUME-CONTINUITY ENFORCER: a session coming back from a force-pause
        // gets ONE explicit order (once per pause episode) to resume exactly
        // where the journal left off — no shortcuts, no repeated work.
        if (state.lastPauseState[task.id] === 'paused' && state.resumeOrders[task.id] !== newestPause.raw) {
          state.resumeOrders[task.id] = newestPause.raw;
          const resumeOrder = '— ORDER ' + localHHMM() + ' — resumed: continue EXACTLY where the ledger below left off — re-read the full description, quote the newest concrete line in your first update, and continue that work with zero shortcuts and zero repeated work.';
          log(`resume-order ${task.id}`);
          writeTaskDescription(task.id, resumeOrder + '\n' + (task.description || ''), () => {});
        }
        const rec = state.suspendedTrees[task.id];
        const freshProcs = await getProcs(0);
        const livePids = (rec.pids || []).filter((p) => pidAlive(p, freshProcs));
        if (livePids.length) {
          const r = await applyPidsOp(livePids, true);
          log(`RESUME task=${task.id} pids=[${livePids.join(' ')}] result=[${r.stdout.replace(/\s+/g, ' ')}]${r.err ? ' ERR=' + r.err.message : ''}${r.stderr ? ' STDERR=' + r.stderr : ''}`);
        } else {
          log(`RESUME task=${task.id} tracked pids gone; clearing state`);
        }
        delete state.suspendedTrees[task.id];
      }

      state.lastPauseState[task.id] = newestPause ? newestPause.word : null;

      // ACK LIGHT: message/ORDER newer than newest update/heartbeat/ack
      const order = latestOf(lines, ['message', 'order']);
      if (order) {
        const ack = latestOf(lines, ['update', 'heartbeat', 'ack']);
        const isNewer = !ack || lines.indexOf(order) < lines.indexOf(ack);
        if (isNewer && !state.ackedLines.includes(order.raw)) {
          state.ackedLines.push(order.raw);
          if (state.ackedLines.length > 500) state.ackedLines = state.ackedLines.slice(-500);
          log(`unhandled-order ${task.id}`);
        }
      }

      // UNANSWERED-DEMAND ENFORCER (user demand: every button demand gets an
      // IMMEDIATE reply, always, machine-wide — not only when the session
      // remembers). Demand formats covered:
      //   — message HH:MM —
      //   — update HH:MM — user message:
      //   — ORDER HH:MM — sub-agents:
      //   — ORDER HH:MM — do this now:
      // Machine-originated lines (watchdog escalation / nudge / ack-now) are
      // excluded so the relay never answers itself. Unanswered = the demand line
      // sits above the newest update/ack/heartbeat line. After 2+ minutes,
      // prepend ONE demanding ORDER per distinct demand (tracked via ackedLines).
      const isDemandLine = (l) => {
        if (!l) return false;
        const t = (l.text || '');
        if (/watchdog escalation|unanswered message nudge|ack-now/i.test(t)) return false;
        if (l.word === 'message') return true;
        if (l.word === 'update') return /^user message:/i.test(t);
        if (l.word === 'order') return /^(sub-agents:|do this now:|hand:)/i.test(t);
        return false;
      };
      const demandKey = (l) => l.word + ' ' + l.time + ' — ' + (l.text || '').slice(0, 60);
      // A force-paused card gets NO machine chatter: no reply-nudge, no watchdog
      // heartbeat/escalation — the session is suspended on purpose; the paused
      // gate above already froze it, nags here would just pile garbage.
      const pausedNow = newestPause && newestPause.word === 'paused';
      if (sectionNames[task.sectionId] === 'In Progress' && !pausedNow) {
        const pendingDemand = lines.find(isDemandLine); // newest-first: first match is newest
        const isHandDemand = pendingDemand && /hand:/i.test(pendingDemand.text || '');
        if (pendingDemand) {
          const answered = latestOf(lines, ['update', 'heartbeat', 'ack']);
          const isNewer = !answered || lines.indexOf(pendingDemand) < lines.indexOf(answered);
          const orderAge = journalAgeMinutes(pendingDemand.time);
          if (isNewer && orderAge >= 1 && !state.ackedLines.includes(demandKey(pendingDemand))) {
            state.ackedLines.push(demandKey(pendingDemand));
            if (state.ackedLines.length > 500) state.ackedLines = state.ackedLines.slice(-500);
            const nudge = isHandDemand
              ? '— ORDER ' + localHHMM() + ' — hand order: run /handoff now (the handoff skill: perfect continuation handoff — write the full handoff prompt, move the task to Finished, stop) and prepend an ack.'
              : '— ORDER ' + localHHMM() + ' — REPLY NOW to the ' + pendingDemand.word + ' above ("' + (pendingDemand.text || '').slice(0, 40) + '"): prepend an ack stating how you will work per this demand. Silence keeps escalating.';
            log(`reply-nudge ${task.id}${isHandDemand ? ' (hand)' : ''}`);
            writeTaskDescription(task.id, nudge + '\n' + (task.description || ''), () => {});
          }
          // HAND ESCALATION: hand demand acknowledged but the card is still In
          // Progress 5 minutes later — ONE absolute re-order per demand.
          if (isHandDemand && !isNewer && orderAge >= 5 && !state.handEscalated[demandKey(pendingDemand)]) {
            state.handEscalated[demandKey(pendingDemand)] = true;
                        const nudge = '\u2014 ORDER ' + localHHMM() + ' \u2014 hand escalation: /handoff was ordered \u2014 save the handoff NOW, prepend \u201c/hand <handoff name>\u201d as this card\u2019s very first line, move this card to To do, and stop; a hand order is absolute.';
            log(`hand-escalation ${task.id}`);
            writeTaskDescription(task.id, nudge + '\n' + (task.description || ''), () => {});
          }
        }
      }

      // WATCHDOG (user demand: real, NON-REPEATING, non-generic progress visible at
      // all times). Cases:
      //  A) only generic boilerplate on record -> escalate demanding real work.
      //  B) real work exists -> heartbeat quoting the NEWEST concrete line that has
      //     NOT been quoted before (non-repetition law). If every concrete line was
      //     already quoted, escalate for fresh narration instead of repeating.
      const GENERIC_RE = /(pinned|has been launched|its working session will update|session assigned|still in progress|alive in progress|watchdog: task|no journal lines yet)/i;
      const sectionName = sectionNames[task.sectionId] || '';
      if (sectionName === 'In Progress' && !(newestPause && newestPause.word === 'paused')) {
        if (!state.lastHeartbeat) state.lastHeartbeat = {};
        if (!state.lastEscalation) state.lastEscalation = {};
        if (!state.quotedLines) state.quotedLines = {};
        const newest = lines[0];
        const age = newest ? journalAgeMinutes(newest.time) : 999;
        const stale = age >= 2;
        if (stale && age <= 600) {
          const lastHb = state.lastHeartbeat[task.id] || 0;
          const quoted = state.quotedLines[task.id] || [];
          const concreteLines = lines.filter((l) => ['update', 'ack', 'done', 'reopened'].includes(l.word) && !GENERIC_RE.test(l.text || ''));
          const fresh = concreteLines.find((l) => !quoted.includes((l.text || '').slice(0, 60)));
          const onlyGeneric = lines.every((l) => GENERIC_RE.test(l.text || '') || ['heartbeat', 'pinned', 'paused', 'resumed'].includes(l.word) || !(l.text || '').trim());
          let kind = null, lineText = '';
          if (false) {
            // ESCALATION WRITES BANNED (user law: 'watchdog escalation' boilerplate is
            // forbidden forever; machine nudges count as silence). Silence enforcement
            // belongs to the bridge's kill+relaunch chain, not journal spam.
            kind = 'escalation';
            state.lastEscalation[task.id] = Date.now();
            lineText = '— ORDER ' + localHHMM() + ' — watchdog escalation: post a fresh concrete update now — the exact step you are executing this minute and its actual output, new facts only.';
          } else if (fresh && Date.now() - lastHb >= 2 * 60 * 1000) {
            kind = 'heartbeat';
            quoted.push((fresh.text || '').slice(0, 60));
            state.quotedLines[task.id] = quoted.length > 50 ? quoted.slice(-50) : quoted;
            // Word-boundary trim: a quote cut mid-word reads as gibberish on the card.
            let quote = (fresh.text || '');
            if (quote.length > 100) {
              quote = quote.slice(0, 100);
              const cut = Math.max(quote.lastIndexOf(' '), quote.lastIndexOf('—'));
              if (cut > 50) quote = quote.slice(0, cut);
              quote = quote.replace(/[\s,;:—-]+$/, '') + '…';
            }
            lineText = '— heartbeat ' + localHHMM() + ' — live: "' + quote + '"';
          }
          if (kind) {
            const snapshotTop = (task.description || '').split(/\r?\n/)[0];
            // Fresh-read guard: re-GET right before writing; if the session added lines
            // since our snapshot, skip this cycle so nothing can ever be clobbered.
            readTaskDescription(task.id, (rerr, freshDesc) => {
              if (rerr) { log(`watchdog ${task.id} re-read ERR: ${rerr.message}`); return; }
              const freshLines = journalLines(freshDesc);
              const freshNewest = freshLines[0];
              if (freshNewest && freshNewest.raw !== (newest ? newest.raw : '') && !GENERIC_RE.test(freshNewest.text || '')) { log(`watchdog ${task.id} skipped: session posted fresh lines`); return; }
              writeTaskDescription(task.id, lineText + '\n' + freshDesc, (err) => {
                if (err) {
                  log(`watchdog ${kind} ${task.id} ERR: ${err.message} — will retry next poll`);
                } else {
                  if (kind === 'heartbeat') state.lastHeartbeat[task.id] = Date.now();
                  log(`watchdog ${kind} ${task.id} written`);
                }
                writeJsonAtomic(STATE_FILE, state);
              });
            });
          }
        }
      }
    }

    // BATCHED FORCE-PAUSE: one fresh process sweep and ONE suspend operation
    // for every newly-paused task collected above — all trees freeze in the
    // same instant instead of one-at-a-time. Pids are claimed per task so two
    // cards sharing a chain ancestor never race for the same pid.
    if (pendingSuspends.length) {
      const freshProcs = await getProcs(0);
      // Re-read the registry from disk right before acting: the sweep above can
      // take seconds, and the relay must never suspend a tree the registry no
      // longer lists as the live session for that task.
      const freshRegistry = readJson(REGISTRY_FILE, {});
      const claimed = new Set();
      const batches = [];
      for (const item of pendingSuspends) {
        const diskEntry = freshRegistry[item.taskId];
        if (!diskEntry && item.entry.name !== 'bridge-fallback') {
          log(`SUSPEND task=${item.taskId}: registry no longer lists this task; skipped`);
          continue;
        }
        const checkEntry = diskEntry || item.entry;
        const innerNow = (typeof checkEntry.pid === 'number' && checkEntry.pid) || (Array.isArray(checkEntry.chain) && checkEntry.chain[0] && checkEntry.chain[0].pid);
        if (!innerNow || !pidAlive(innerNow, freshProcs)) {
          log(`SUSPEND task=${item.taskId}: registered pid ${innerNow} not alive in fresh sweep; skipped`);
          continue;
        }
        // Exclude pids registered to OTHER tasks (cross-task freeze fix).
        const otherTaskPids = new Set();
        for (const [otherId, otherEntry] of Object.entries(freshRegistry)) {
          if (otherId === item.taskId) continue;
          const op = (typeof otherEntry.pid === 'number' && otherEntry.pid) || (Array.isArray(otherEntry.chain) && otherEntry.chain[0] && otherEntry.chain[0].pid);
          if (op) otherTaskPids.add(op);
        }
        const pids = chainSuspendSet(checkEntry, freshProcs, otherTaskPids).filter((p) => !claimed.has(p));
        if (!pids.length) { log(`SUSPEND task=${item.taskId}: no safely suspensible pids (chain guards); skipped`); continue; }
        for (const p of pids) claimed.add(p);
        batches.push({ taskId: item.taskId, pids });
      }
      const allPids = batches.flatMap((b) => b.pids);
      if (allPids.length) {
        const r = await applyPidsOp(allPids, false);
        if (process.env.RELAY_DEBUG) log(`debug raw out=${JSON.stringify(r.stdout)} errset=${!!r.err}`);
        log(`SUSPEND-BATCH tasks=[${batches.map((b) => b.taskId).join(' ')}] pids=[${allPids.join(' ')}] result=[${r.stdout.replace(/\s+/g, ' ')}]${r.err ? ' ERR=' + r.err.message : ''}${r.stderr ? ' STDERR=' + r.stderr : ''}`);
        if (!r.err && r.stdout.includes('suspended')) {
          for (const b of batches) state.suspendedTrees[b.taskId] = { pids: b.pids, rootPid: b.pids[0], at: new Date().toISOString() };
        }
      }
    }

    // drop suspended state for pids that died
    for (const taskId of Object.keys(state.suspendedTrees)) {
      const rec = state.suspendedTrees[taskId];
      if (!pidAlive(rec.rootPid, procs)) {
        log(`suspended tree for ${taskId} exited; clearing state`);
        delete state.suspendedTrees[taskId];
      }
    }
    writeJsonAtomic(STATE_FILE, state);
  } catch (e) {
    log(`poll error: ${e.message}`);
  } finally {
    busy = false;
    lastPollDone = Date.now();
  }
}

function main() {
  if (!acquireLock()) process.exit(0);
  log(`relay v2 started pid=${process.pid}`);
  process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (e) {} });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try { process.on(sig, () => process.exit(0)); } catch (e) {}
  }
  poll();
  setInterval(poll, POLL_MS);
  // Stall guard: if a poll ever hangs past every timeout, exit so the
  // supervised launcher restarts us instead of freezing silently.
  setInterval(() => {
    if (Date.now() - lastPollDone > 90000) {
      log('FATAL: poll loop stalled >90s; exiting for supervisor restart');
      process.exit(1);
    }
  }, 15000);
}
main();
