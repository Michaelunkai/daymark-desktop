// NVIDIA in-process agent runner for the Daymark bridge.
// Cards whose model line is nvidia-nim/<model> run HERE — a real agent loop
// against the local rotating-key proxy (127.0.0.1:3460) — instead of the
// zcode CLI, whose headless launcher cannot be forced onto a specific model.
// Guarantees: the inference model is EXACTLY the card's chosen NVIDIA model;
// key rotation/cooldown is inherited from the proxy; the loop is step- and
// wall-capped; the card is re-checked between steps so paused/moved cards
// stop the run; progress is journaled after every step with concrete facts.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const PROXY_URL = "http://127.0.0.1:3460/v1/chat/completions";
const MAX_STEPS = 40;
const MAX_WALL_MS = 25 * 60_000;
const CALL_TIMEOUT_MS = 180_000;
const HISTORY_KEEP = 44; // messages kept besides the system prompt (context-overflow proof)

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_cmd",
      description: "Run a Windows shell command (cmd.exe) in the work directory and return stdout/stderr (truncated to 4000 chars).",
      parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file (first 8000 chars).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a text file (create or overwrite).",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List a directory's entries with sizes.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish_session",
      description: "Call when the demand is fully achieved and verified live: reports the final summary and ends the session.",
      parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    },
  },
];

function clip(s, n) { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + `…(+${t.length - n} chars)` : t; }

async function chat(proxyUrl, model, messages, log) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer nvapi-proxy" },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 2048, temperature: 0.3 }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${clip(text, 200)}`);
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`bad JSON: ${clip(text, 120)}`); }
  const msg = d.choices?.[0]?.message;
  if (!msg) throw new Error(`no choices: ${clip(text, 160)}`);
  return msg;
}

async function execTool(name, args, cwd) {
  switch (name) {
    case "run_cmd": {
      try {
        const { stdout, stderr } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", args.cmd], {
          cwd, timeout: 180_000, maxBuffer: 1024 * 1024, windowsHide: true,
        });
        return clip(stdout, 3500) + (stderr ? `\n[stderr] ${clip(stderr, 800)}` : "");
      } catch (e) {
        // Nonzero exit still carries output — the agent must SEE it to adapt.
        return `[exit ${e.code ?? "?"}] ${clip(e.stdout, 3000)}` + (e.stderr ? `\n[stderr] ${clip(e.stderr, 800)}` : "");
      }
    }
    case "read_file":
      return clip(await readFile(args.path, "utf8"), 8000);
    case "write_file":
      await writeFile(args.path, args.content, "utf8");
      return `written: ${args.path} (${args.content.length} chars)`;
    case "list_dir": {
      const entries = await readdir(args.path, { withFileTypes: true });
      const lines = [];
      for (const e of entries.slice(0, 60)) {
        let size = "";
        try { if (!e.isDirectory()) size = String((await stat(`${args.path}/${e.name}`)).size); } catch {}
        lines.push(`${e.isDirectory() ? "DIR " : "FILE"} ${e.name} ${size}`);
      }
      return lines.join("\n") || "(empty)";
    }
    default:
      return `unknown tool ${name}`;
  }
}

/**
 * Run one NVIDIA agent session to completion.
 * @param {object} p
 * @param {string} p.taskId        Daymark task id
 * @param {string} p.modelId       NVIDIA model id (e.g. nvidia/nemotron-3-ultra-550b-a55b)
 * @param {string} p.demand        The full demand text (the card's prompt)
 * @param {string} p.cwd           Working directory for tools
 * @param {(line: string) => Promise<void>} p.journal   Prepend a progress line to the card
 * @param {() => Promise<boolean>} p.shouldStop    True when the card left In Progress / was paused
 * @param {(summary: string) => Promise<void>} p.onFinished  Called with the final summary
 */
export async function runNvidiaAgent(p) {
  const { taskId, modelId, demand, cwd, journal, shouldStop, onFinished } = p;
  const hhmm = () => {
    const d = new Date(Date.now() + 2 * 3600_000); // device-local (UTC+2) stamps like the rest of the board
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const messages = [{
    role: "system",
    content:
      `You are an autonomous Windows agent working a Daymark card. Current local time is ${hhmm()}.\n` +
      `Execute the DEMAND completely, using the tools. Rules:\n` +
      `(1) Work step by step; after each tool result, state in one line what you verified and what is next.\n` +
      `(2) Never ask the user anything; never stop until the demand is fully achieved AND verified with a real command output.\n` +
      `(3) Prefer concrete evidence: run commands, read real files, quote outputs.\n` +
      `(4) When everything is done and verified, call finish_session with a compact summary.\n` +
      `\nDEMAND:\n${demand}`,
  }, { role: "user", content: "Begin. First, survey what already exists (list_dir / read_file), then execute the demand." }];

  const started = Date.now();
  let step = 0;
  for (; step < MAX_STEPS; step += 1) {
    if (Date.now() - started > MAX_WALL_MS) { await journal(`time budget ${Math.round(MAX_WALL_MS / 60000)} min elapsed — stopping with partial results`); break; }
    if (await shouldStop()) { await journal("card left In Progress — NVIDIA agent stopping"); break; }

    let msg;
    try {
      msg = await chat(PROXY_URL, modelId, messages, console);
    } catch (e) {
      await journal(`model call failed (${clip(e.message, 90)}) — retrying next poll cycle`);
      throw e; // let the bridge's retry/failover machinery handle it
    }

    const toolCalls = msg.tool_calls ?? [];
    if (msg.content && String(msg.content).trim()) {
      await journal(`step ${step + 1}: ${clip(msg.content, 160)}`);
    }
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
    if (msg.reasoning_content) messages[messages.length - 1].reasoning_content = undefined; // keep history lean

    if (!toolCalls.length) {
      // Model answered without a tool call: treat as interim narration; nudge once, else finish.
      if (step >= 2) {
        const summary = clip(msg.content, 400);
        await journal(`session wrapping up: ${summary}`);
        await onFinished(summary);
        return summary;
      }
      messages.push({ role: "user", content: "Continue executing the demand with the tools. If it is complete, call finish_session." });
      continue;
    }

    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch {}
      if (call.function?.name === "finish_session") {
        const summary = clip(args.summary ?? "completed", 400);
        await journal(`FINISHED — ${summary}`);
        await onFinished(summary);
        return summary;
      }
      let result;
      try { result = await execTool(call.function?.name, args, cwd); }
      catch (e) { result = `tool error: ${clip(e.message, 200)}`; }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
      await journal(`${call.function?.name}: ${clip(result, 140)}`);
    }

    while (messages.length > HISTORY_KEEP + 1) messages.splice(1, 2); // keep system + trim oldest pairs
  }
  const partial = `step budget reached (${step}/${MAX_STEPS}) — continuing on the next relaunch carries state via the card journal`;
  await journal(partial);
  return partial;
}
