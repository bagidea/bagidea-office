// BagIdea Office — Codex as a system tool (v1.4, design G2).
//
// The office drives OpenAI's Codex CLI itself, so it can watch it, budget it and
// record it: `codex exec --json` in a project directory, the JSONL streamed into
// a live run record, the last message and a diff summary returned. It is never
// the office's brain — persona, memory, skills and permissions stay on the
// agent that CALLED it. Codex is a tool that happens to be an agent.
//
//   exec({ task, dir, agent, project, sandbox, model })  → { ok, text, usage, diff, … }
//   review({ dir, uncommitted|base|commit, instructions }) → the same, from `codex exec review`
//
// Needs: `codex` on PATH (npm i -g @openai/codex) and a login (`codex login`) or
// OPENAI_API_KEY. Local models: settings.oss + localProvider ("ollama"/"lmstudio").
// Zero dependencies; the binary and spawn are injectable for tests.

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];

module.exports = function initCodex(ctx) {
  const reg = ctx.reg || {};
  const saveReg = ctx.saveReg || (() => {});
  const broadcast = ctx.broadcast || (() => {});
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const spawnImpl = ctx.spawn || spawn;
  const spawnSyncImpl = ctx.spawnSync || spawnSync;   // detect() — injectable for tests
  const bin = ctx.bin || process.env.BAGIDEA_CODEX_BIN || "codex";
  const onUsage = ctx.onUsage || (() => {});       // (agent, project, inTok, outTok) → attribute cost
  const isolate = ctx.isolate || null;             // (dir, id) → { dir, settle() } when ghost isolation is on
  const MAX_RUNS = 60;

  const runs = [];                                 // newest last
  const procs = new Map();                         // id -> child
  let seq = 0;
  let cached = null, cachedAt = 0;

  function settings() {
    const c = reg.codex || {};
    return {
      sandbox: SANDBOXES.includes(c.sandbox) ? c.sandbox : "workspace-write",
      model: String(c.model || ""),
      oss: !!c.oss,
      localProvider: c.localProvider === "lmstudio" ? "lmstudio" : "ollama",
      maxMinutes: Math.max(1, Math.min(120, Number(c.maxMinutes) || 20)),
      enabled: c.enabled !== false,
    };
  }
  function setSettings(patch) {
    const s = settings(); const p = patch || {};
    const next = {
      sandbox: SANDBOXES.includes(p.sandbox) ? p.sandbox : s.sandbox,
      model: p.model !== undefined ? String(p.model || "").slice(0, 60) : s.model,
      oss: p.oss !== undefined ? !!p.oss : s.oss,
      localProvider: p.localProvider !== undefined ? (p.localProvider === "lmstudio" ? "lmstudio" : "ollama") : s.localProvider,
      maxMinutes: p.maxMinutes !== undefined ? Math.max(1, Math.min(120, Number(p.maxMinutes) || 20)) : s.maxMinutes,
      enabled: p.enabled !== undefined ? !!p.enabled : s.enabled,
    };
    reg.codex = next; saveReg();
    return next;
  }

  // Is codex installed? Cached for a minute — it is asked on every prompt.
  function detect() {
    if (cached && now() - cachedAt < 60000) return cached;
    let r = { installed: false, version: "", bin };
    try {
      const out = spawnSyncImpl(bin, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true, shell: process.platform === "win32" });
      if (out.status === 0) r = { installed: true, version: String(out.stdout || "").trim().replace(/^codex-cli\s*/, ""), bin };
    } catch {}
    cached = r; cachedAt = now();
    return r;
  }
  function status() {
    return { ...detect(), settings: settings(), runs: runs.slice(-20).map(pub).reverse(), running: procs.size };
  }

  function pub(r) {
    return { id: r.id, agent: r.agent, project: r.project, dir: r.dir, kind: r.kind, state: r.state, startedAt: r.startedAt, endedAt: r.endedAt,
             task: r.task.slice(0, 200), text: r.text.slice(0, 4000), usage: r.usage, diff: r.diff, error: r.error, steps: r.steps.slice(-30), exit: r.exit };
  }
  function push(r) { runs.push(r); while (runs.length > MAX_RUNS) runs.shift(); }
  function emit(r) { broadcast({ type: "codex.run", run: pub(r) }, false); }

  function gitSummary(dir) {
    try {
      // Scoped to the directory Codex worked in (`-- .`): a workspace inside a larger
      // repository must not report the whole repository's changes as Codex's.
      const st = spawnSync("git", ["status", "--porcelain", "--", "."], { cwd: dir, encoding: "utf8", timeout: 8000, windowsHide: true });
      if (st.status !== 0) return null;
      const files = String(st.stdout || "").split("\n").filter(Boolean);
      const ds = spawnSync("git", ["diff", "--shortstat", "--", "."], { cwd: dir, encoding: "utf8", timeout: 8000, windowsHide: true });
      return { files: files.length, changed: files.slice(0, 40).map((l) => l.trim()), summary: String(ds.stdout || "").trim() };
    } catch { return null; }
  }

  function args(kind, o, s) {
    const a = ["exec"];
    if (kind === "review") {
      a.push("review");
      if (o.commit) a.push("--commit", String(o.commit));
      else if (o.base) a.push("--base", String(o.base));
      else a.push("--uncommitted");
    }
    a.push("--json", "-C", o.dir, "--skip-git-repo-check");
    if (kind !== "review") { a.push("-s", o.sandbox || s.sandbox, "--ephemeral"); }
    const model = o.model || s.model; if (model) a.push("-m", model);
    if (o.oss !== undefined ? o.oss : s.oss) a.push("--oss", "--local-provider", s.localProvider);
    for (const img of o.images || []) a.push("-i", String(img));
    a.push("-");                                       // the prompt comes on stdin: no shell quoting, no codepage damage
    return a;
  }

  // One run. Resolves — never rejects — with the run's public record.
  function run(kind, o) {
    const s = settings();
    const det = detect();
    const id = "cx" + now().toString(36) + (seq++ ? seq.toString(36) : "");
    const r = { id, kind, agent: o.agent || "main", project: o.project || "", dir: o.dir, task: String(o.task || o.instructions || ""),
                state: "running", startedAt: now(), endedAt: 0, text: "", usage: null, diff: null, error: "", steps: [], exit: null, threadId: "" };
    push(r);
    if (!s.enabled) return Promise.resolve(finish(r, false, "Codex is switched off in ⚙ → 🧑‍💻 CODEX"));
    if (!det.installed) return Promise.resolve(finish(r, false, "codex is not installed (npm i -g @openai/codex) or not on PATH"));
    if (!r.dir || !fs.existsSync(r.dir)) return Promise.resolve(finish(r, false, "no such directory: " + r.dir));
    let iso = null;
    if (isolate && o.isolate) { try { iso = isolate(r.dir, id); if (iso) r.dir = iso.dir; } catch (e) { log("[codex] isolate: " + e.message); } }
    emit(r);
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(bin, args(kind, { ...o, dir: r.dir }, s), { cwd: r.dir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: process.platform === "win32",
          env: { ...process.env, ...(o.env || {}) } });
      } catch (e) { return resolve(finish(r, false, "spawn failed: " + e.message)); }
      procs.set(id, child);
      const prompt = kind === "review" ? String(o.instructions || "") : String(o.task || "");
      try { child.stdin.write(prompt || (kind === "review" ? "Review the changes." : "")); child.stdin.end(); } catch {}
      let buf = "", err = "";
      const timer = setTimeout(() => { r.error = `stopped after ${s.maxMinutes} min`; try { child.kill(); } catch {} }, s.maxMinutes * 60000);
      child.stdout.on("data", (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(r, line); }
      });
      child.stderr.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
      child.on("error", (e) => { clearTimeout(timer); procs.delete(id); resolve(settle(finish(r, false, "codex failed to start: " + e.message), iso)); });
      child.on("close", (code) => {
        clearTimeout(timer); procs.delete(id);
        if (buf.trim()) handle(r, buf.trim());
        r.exit = code;
        const ok = code === 0 && !r.error;
        if (!ok && !r.error) r.error = (err.split("\n").filter((l) => /error|failed|denied|not logged|login/i.test(l)).pop() || err.trim().split("\n").pop() || `exit ${code}`).slice(0, 400);
        r.diff = gitSummary(r.dir);
        resolve(settle(finish(r, ok, r.error), iso));
      });
    });
  }
  function settle(rec, iso) {
    if (iso && iso.settle) { try { const note = iso.settle(); if (note) rec.text = rec.text + "\n\n" + note; } catch (e) { log("[codex] settle: " + e.message); } }
    return rec;
  }
  function finish(r, ok, error) {
    r.state = ok ? "done" : "failed"; r.endedAt = now(); if (error) r.error = error;
    if (r.usage) { try { onUsage(r.agent, r.project, r.usage.input_tokens || 0, r.usage.output_tokens || 0); } catch {} }
    emit(r);
    return { ok, ...pub(r) };
  }

  // The JSONL protocol of `codex exec --json` (0.1xx): thread.started, turn.started,
  // item.started/completed { item: { type: agent_message|command_execution|file_change|reasoning… } },
  // turn.completed { usage }, turn.failed { error }, error { message }.
  function handle(r, line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const t = ev.type || "";
    if (t === "thread.started") r.threadId = ev.thread_id || "";
    else if (t === "item.completed" || t === "item.started") {
      const it = ev.item || {};
      if (it.type === "agent_message" && t === "item.completed") { r.text = String(it.text || ""); step(r, "💬 " + r.text.slice(0, 160)); }
      else if (it.type === "command_execution") step(r, (t === "item.started" ? "▶ " : (it.exit_code === 0 ? "✓ " : "✗ ")) + String(it.command || "").slice(0, 160));
      else if (it.type === "file_change") step(r, "✎ " + (it.changes || []).map((c) => c.path).join(", ").slice(0, 160));
      else if (it.type === "reasoning" && t === "item.completed") step(r, "… " + String(it.text || "").slice(0, 120));
      else if (it.type === "error") { r.error = String(it.message || "error").slice(0, 400); }
    } else if (t === "turn.completed") r.usage = ev.usage || null;
    else if (t === "turn.failed") r.error = String((ev.error && ev.error.message) || "turn failed").slice(0, 400);
    else if (t === "error") r.error = String(ev.message || "error").slice(0, 400);
  }
  function step(r, s) { r.steps.push({ at: now(), text: s }); if (r.steps.length > 200) r.steps.shift(); broadcast({ type: "codex.step", id: r.id, agent: r.agent, text: s }, false); }

  function exec(o) { if (!o || !String(o.task || "").trim()) return Promise.resolve({ ok: false, error: "task is required" }); return run("exec", o); }
  function review(o) { return run("review", o || {}); }
  function cancel(id) { const c = procs.get(id); if (!c) return false; const r = runs.find((x) => x.id === id); if (r) r.error = "cancelled"; try { c.kill(); } catch {} return true; }
  function list() { return runs.slice().reverse().map(pub); }
  function get(id) { const r = runs.find((x) => x.id === id); return r ? pub(r) : null; }

  // Told to agents only when it exists.
  function agentNote() {
    if (!settings().enabled || !detect().installed) return "";
    return `
- 🧑‍💻 Codex (a second coding agent you can call in for a self-contained sub-task — it edits the project directly in a ${settings().sandbox} sandbox; you stay responsible for the result):
    curl -s -X POST http://127.0.0.1:8787/codex/exec -H "content-type: application/json" -d '{"task":"<clear, self-contained task>","project":"<project name or path>"}'
  → {"ok":true,"text":"<its final message>","diff":{"files":N,"summary":"…"}}. It can take minutes; the call returns when it finishes.
  A second opinion on a change: curl -s -X POST http://127.0.0.1:8787/codex/review -H "content-type: application/json" -d '{"project":"<name>","instructions":"<what to look for>"}'`;
  }

  return { exec, review, cancel, list, get, status, settings, setSettings, detect, agentNote, SANDBOXES, _args: args, _handle: handle };
};
