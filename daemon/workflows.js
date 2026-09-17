// BagIdea Office — the workflow engine.
//
// Until v1.3, "running" a workflow meant serializing the drawing to prose and
// handing it to the Director as one big order. It was a drawing, not a machine:
// no node ran on its own, nothing had state, nothing could wait for a person,
// a restart forgot everything, and there was no record of what happened.
//
// This executes the graph the builder already saves — { nodes:[{id,type,text,
// x,y,cfg?}], edges:[{from,to,label?}] } — one node at a time, in parallel
// where the edges allow, with a persisted record per run that a daemon restart
// resumes rather than forgets.
//
// Node types (the five the builder always had, plus the ones that make it a
// machine):
//   trigger    starts the run; its output is the trigger payload
//   action     hand the text to an agent as a real turn ("@id:" picks one;
//              default the Director, with DELEGATE power)   [alias: agent]
//   fetch      HTTP request; text = URL; output { status, body }
//   decision   "{{path}} == value"-style expression, or a plain-language
//              question judged by the Director → { ok }; edges labelled
//              yes/no (or first = yes, second = no) pick the branch
//   approval   stop and wait for a person via the inbox; resumes on approve
//   notify     send through the notification rules (kind: workflow)
//   delay      wait "10m" / "2h" / "until 09:00"; survives a restart
//   output     record the result; "file:<path>" writes it, "channel:" relays it
//   note       documentation on the canvas; skipped
//
// Data flows down the edges. Any text field may use {{trigger.data.x}},
// {{n3.output}}, {{prev}} (all upstream outputs, joined) — small and explicit,
// no scripting language.
//
// Zero dependencies.

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const MAX_RUNS = 200;
const AGENT_TYPES = new Set(["action", "agent"]);
const BUILTIN = ["trigger", "action", "fetch", "decision", "approval", "notify", "delay", "output", "note"];

module.exports = function initWorkflows(ctx) {
  const DIR = ctx.dir;                                   // workspace/workflows
  const RUNS = path.join(DIR, "runs");
  const EXAMPLES = ctx.examplesDir || null;
  const broadcast = ctx.broadcast || (() => {});
  const notify = ctx.notify || (() => {});
  const approvals = ctx.approvals || null;
  const runAgent = ctx.runAgent;                         // (agentId, prompt, opts) => Promise<{ ok, text }>
  const relay = ctx.relay || (() => {});
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const fetchImpl = ctx.fetchImpl || httpFetch;

  fs.mkdirSync(RUNS, { recursive: true });
  const live = new Map();          // runId -> run (in memory while active)
  const timers = new Map();        // runId|nodeId -> delay timer
  // Node types contributed by the office (codex) or by plugins (design H):
  // kind -> { impl(node, helpers) → output | Promise, label, hint, owner }
  const custom = new Map();
  function registerNode(kind, impl, meta) {
    const k = String(kind || "").trim().toLowerCase();
    if (!/^[a-z][\w-]{1,30}$/.test(k)) throw new Error("bad node kind: " + kind);
    if (BUILTIN.includes(k)) throw new Error("node kind is built in: " + k);
    if (typeof impl !== "function") throw new Error("a node kind needs impl(node, helpers)");
    custom.set(k, { impl, label: (meta && meta.label) || k, hint: (meta && meta.hint) || "", owner: (meta && meta.owner) || "" });
    return k;
  }
  function unregisterOwner(owner) { for (const [k, v] of [...custom.entries()]) if (v.owner === owner) custom.delete(k); }
  function nodeTypes() {
    return BUILTIN.map((k) => ({ kind: k, builtin: true }))
      .concat([...custom.entries()].map(([k, v]) => ({ kind: k, builtin: false, label: v.label, hint: v.hint, owner: v.owner })));
  }

  // ---- storage ----------------------------------------------------------------
  // Write a workflow file (plugins install their templates this way). An id that
  // starts with "example-" is read-only; a missing id gets one.
  function save(wf, opts = {}) {
    let id = String((wf && wf.id) || "").replace(/[^\w-]/g, "");
    if (!id || id.startsWith("example-")) id = "wf_" + now();
    const file = path.join(DIR, id + ".json");
    if (opts.ifMissing && fs.existsSync(file)) return { id, existed: true };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id, name: (wf && wf.name) || "Workflow", nodes: (wf && wf.nodes) || [], edges: (wf && wf.edges) || [] }, null, 2));
    return { id, existed: false };
  }
  function exists(id) { const clean = String(id || "").replace(/[^\w-]/g, ""); return !!clean && fs.existsSync(path.join(DIR, clean + ".json")); }
  function load(id) {
    const clean = String(id || "").replace(/[^\w-]/g, "");
    if (!clean) return null;
    const tryRead = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
    let w = tryRead(path.join(DIR, clean + ".json"));
    if (!w && EXAMPLES) {
      try {
        for (const f of fs.readdirSync(EXAMPLES)) {
          const x = tryRead(path.join(EXAMPLES, f));
          if (x && x.id === clean) { w = x; break; }
        }
      } catch {}
    }
    return w;
  }
  function saveRun(run) {
    try { fs.writeFileSync(path.join(RUNS, run.id + ".json"), JSON.stringify(run, null, 1)); } catch (e) { log("[wf] save run " + e.message); }
  }
  function readRun(id) {
    try { return JSON.parse(fs.readFileSync(path.join(RUNS, String(id).replace(/[^\w-]/g, "") + ".json"), "utf8")); } catch { return null; }
  }
  function prune() {
    try {
      const files = fs.readdirSync(RUNS).filter((f) => f.endsWith(".json")).sort();
      while (files.length > MAX_RUNS) { const f = files.shift(); try { fs.unlinkSync(path.join(RUNS, f)); } catch {} }
    } catch {}
  }
  let seq = 0;
  function newId() {
    const t = now(); let id;
    do { id = "r" + t + (seq ? "-" + seq : ""); seq++; } while (live.has(id) || fs.existsSync(path.join(RUNS, id + ".json")));
    return id;
  }

  // ---- templating -------------------------------------------------------------
  function lookup(obj, pathStr) {
    return String(pathStr).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function scope(run) {
    const nodes = {};
    for (const [id, st] of Object.entries(run.nodes)) nodes[id] = { output: st.output };
    return { trigger: run.trigger || {}, ...nodes, nodes, run: { id: run.id, name: run.name } };
  }
  function render(text, run, nodeId) {
    const sc = scope(run);
    const preds = predecessors(run.graph, nodeId).map((p) => run.nodes[p] && run.nodes[p].output).filter((o) => o != null);
    sc.prev = preds.map((o) => typeof o === "string" ? o : JSON.stringify(o)).join("\n\n");
    return String(text || "").replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, p) => {
      const v = p === "prev" ? sc.prev : lookup(sc, p);
      return v == null ? "" : (typeof v === "string" ? v : JSON.stringify(v));
    });
  }

  // ---- graph helpers ----------------------------------------------------------
  function predecessors(g, id) { return g.edges.filter((e) => e.to === id).map((e) => e.from); }
  function successors(g, id) { return g.edges.filter((e) => e.from === id); }
  function nodeOf(g, id) { return g.nodes.find((n) => n.id === id); }

  // ---- run lifecycle ----------------------------------------------------------
  function start(wfOrId, opts = {}) {
    const wf = typeof wfOrId === "string" ? load(wfOrId) : wfOrId;
    if (!wf || !Array.isArray(wf.nodes) || !wf.nodes.length) throw new Error("workflow not found or empty");
    const run = {
      id: newId(), workflowId: wf.id || "", name: wf.name || "Workflow",
      trigger: { source: (opts.trigger && opts.trigger.source) || "manual", event: (opts.trigger && opts.trigger.event) || "",
                 data: (opts.trigger && opts.trigger.data) || {}, at: now() },
      by: opts.by || "owner",
      startedAt: now(), endedAt: 0, state: "running",
      graph: { nodes: wf.nodes.map((n) => ({ id: n.id, type: n.type || "action", text: n.text || "", cfg: n.cfg || {} })),
               edges: (wf.edges || []).map((e) => ({ from: e.from, to: e.to, label: e.label || "" })) },
      nodes: {},
    };
    for (const n of run.graph.nodes) run.nodes[n.id] = { state: "pending", startedAt: 0, endedAt: 0, output: null, error: "" };
    live.set(run.id, run);
    saveRun(run); prune();
    broadcast({ type: "workflow.run", run: summary(run) }, false);
    // Trigger nodes complete immediately with the payload; everything flows from there.
    const triggers = run.graph.nodes.filter((n) => n.type === "trigger");
    const roots = triggers.length ? triggers : run.graph.nodes.filter((n) => !predecessors(run.graph, n.id).length);
    for (const n of roots) finishNode(run, n.id, n.type === "trigger" ? run.trigger : null);
    schedule(run);
    return run;
  }

  function summary(run) {
    const counts = {};
    for (const st of Object.values(run.nodes)) counts[st.state] = (counts[st.state] || 0) + 1;
    return { id: run.id, workflowId: run.workflowId, name: run.name, state: run.state, trigger: run.trigger,
             startedAt: run.startedAt, endedAt: run.endedAt, counts,
             nodes: Object.fromEntries(Object.entries(run.nodes).map(([id, s]) => [id, { state: s.state, error: s.error,
               output: typeof s.output === "string" ? s.output.slice(0, 400) : s.output }])) };
  }

  function setState(run, nodeId, state, patch = {}) {
    const st = run.nodes[nodeId];
    Object.assign(st, { state }, patch);
    if (state === "running") st.startedAt = now();
    if (["done", "failed", "skipped"].includes(state)) st.endedAt = now();
    saveRun(run);
    broadcast({ type: "workflow.node", run: run.id, node: nodeId, state, error: st.error || "" }, false);
  }
  function finishNode(run, nodeId, output) { setState(run, nodeId, "done", { output }); }
  function failNode(run, nodeId, error) { setState(run, nodeId, "failed", { error: String(error || "failed").slice(0, 600) }); }

  // A node is ready when every predecessor has finished and at least one of them
  // actually leads here (a decision only opens the branch it chose).
  function ready(run, nodeId) {
    const st = run.nodes[nodeId];
    if (st.state !== "pending") return false;
    const preds = predecessors(run.graph, nodeId);
    if (!preds.length) return false;
    if (!preds.every((p) => ["done", "skipped", "failed"].includes(run.nodes[p].state))) return false;
    return preds.some((p) => edgeOpen(run, p, nodeId));
  }
  function edgeOpen(run, from, to) {
    const src = run.nodes[from];
    if (src.state === "skipped" || src.state === "failed") return false;
    const n = nodeOf(run.graph, from);
    if (n.type !== "decision") return true;
    const edges = successors(run.graph, from);
    const chosen = decisionEdge(edges, src.output && src.output.ok);
    return chosen ? chosen.to === to : true;
  }
  function decisionEdge(edges, ok) {
    if (!edges.length) return null;
    const yes = edges.find((e) => /^(yes|true|ok|y)$/i.test(e.label)), no = edges.find((e) => /^(no|false|n)$/i.test(e.label));
    if (yes || no) return ok ? (yes || null) : (no || null);
    return ok ? edges[0] : (edges[1] || null);
  }
  // A pending node none of whose predecessors can ever reach it is skipped.
  function unreachable(run, nodeId) {
    const st = run.nodes[nodeId];
    if (st.state !== "pending") return false;
    const preds = predecessors(run.graph, nodeId);
    if (!preds.length) return false;
    // A failed predecessor (a rejected approval, a refused agent turn) closes its edges
    // like a skipped one — the steps behind it are skipped and the run can settle as failed.
    return preds.every((p) => ["done", "skipped", "failed"].includes(run.nodes[p].state) && !edgeOpen(run, p, nodeId));
  }

  function schedule(run) {
    if (run.state !== "running") return;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const n of run.graph.nodes) {
        if (unreachable(run, n.id)) { setState(run, n.id, "skipped"); progressed = true; }
      }
    }
    for (const n of run.graph.nodes) if (ready(run, n.id)) exec(run, n);
    settle(run);
  }
  function settle(run) {
    const states = Object.values(run.nodes).map((s) => s.state);
    if (states.some((s) => ["pending", "running", "waiting", "ready"].includes(s))) return;
    run.state = states.includes("failed") ? "failed" : "done";
    run.endedAt = now();
    live.delete(run.id);
    saveRun(run);
    broadcast({ type: "workflow.run", run: summary(run) }, false);
    const last = lastOutput(run);
    notify({ kind: "workflow", title: (run.state === "done" ? "🔀 Workflow finished: " : "🔀 Workflow failed: ") + run.name,
             body: run.state === "done" ? String(last || "").slice(0, 300)
                 : Object.entries(run.nodes).filter(([, s]) => s.state === "failed").map(([id, s]) => id + ": " + s.error).join("\n").slice(0, 300),
             link: "workflow:" + run.id });
  }
  function lastOutput(run) {
    const leaves = run.graph.nodes.filter((n) => !successors(run.graph, n.id).length && run.nodes[n.id].state === "done" && n.type !== "note");
    const outs = leaves.map((n) => run.nodes[n.id].output).filter((o) => o != null);
    return outs.map((o) => typeof o === "string" ? o : JSON.stringify(o)).join("\n\n");
  }

  // ---- executors --------------------------------------------------------------
  async function exec(run, n) {
    setState(run, n.id, "running");
    try {
      let out;
      switch (n.type) {
        case "note": out = null; break;
        case "trigger": out = run.trigger; break;
        case "action": case "agent": out = await execAgent(run, n); break;
        case "fetch": out = await execFetch(run, n); break;
        case "decision": out = await execDecision(run, n); break;
        case "approval": return execApproval(run, n);   // resumes via resume()
        case "notify": out = execNotify(run, n); break;
        case "delay": return execDelay(run, n);         // resumes via timer
        case "output": out = await execOutput(run, n); break;
        default:
          if (custom.has(n.type)) {
            const { impl } = custom.get(n.type);
            out = await impl({ ...n, text: render(n.text, run, n.id), raw: n.text }, {
              run: { id: run.id, name: run.name, trigger: run.trigger }, render: (t) => render(t, run, n.id),
              prev: render("{{prev}}", run, n.id), outputs: Object.fromEntries(Object.entries(run.nodes).map(([id, s]) => [id, s.output])),
              agent: (agentId, prompt, o) => runAgent(agentId, prompt, { workflow: run.id, node: n.id, ...(o || {}) }),
              notify: (item) => notify({ kind: "workflow", link: "workflow:" + run.id, ...(item || {}) }),
            });
          } else out = render(n.text, run, n.id);
      }
      finishNode(run, n.id, out);
    } catch (e) {
      failNode(run, n.id, e && e.message);
    }
    schedule(run);
  }

  async function execAgent(run, n) {
    let agent = (n.cfg && n.cfg.agent) || "main";
    let text = n.text || "";
    const m = /^@([\w-]+)\s*:\s*/.exec(text);
    if (m) { agent = m[1]; text = text.slice(m[0].length); }
    const prompt =
      `<workflow-step>\n` +
      `You are carrying out one step of the workflow "${run.name}" (run ${run.id}). ` +
      `Do this step now and reply with its result only — the office passes your reply to the next step.\n` +
      `Step: ${render(text, run, n.id)}\n` +
      (predecessors(run.graph, n.id).length ? `\nResults of the previous steps:\n${render("{{prev}}", run, n.id).slice(0, 6000)}\n` : "") +
      `</workflow-step>`;
    const r = await runAgent(agent, prompt, { workflow: run.id, node: n.id, project: n.cfg && n.cfg.project });
    if (!r || !r.ok) throw new Error((r && r.text) ? String(r.text).slice(0, 300) : "agent turn failed");
    return String(r.text || "");
  }

  async function execFetch(run, n) {
    const url = render(n.text, run, n.id).trim();
    if (!/^https?:\/\//.test(url)) throw new Error("fetch needs an http(s) URL");
    const cfg = n.cfg || {};
    const r = await fetchImpl(url, { method: cfg.method || "GET", headers: cfg.headers || {},
      body: cfg.body ? render(typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body), run, n.id) : undefined, timeout: 20000 });
    let body = r.body;
    try { body = JSON.parse(r.body); } catch {}
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return { status: r.status, body };
  }

  async function execDecision(run, n) {
    const text = render(n.text, run, n.id).trim();
    const m = /^(.+?)\s*(==|!=|>=|<=|>|<|contains|matches)\s*(.+)$/s.exec(text);
    if (m && !/\s(and|or)\s/i.test(text) && text.length < 300) {
      const a = m[1].trim().replace(/^["']|["']$/g, ""), b = m[3].trim().replace(/^["']|["']$/g, "");
      const num = (v) => (v !== "" && !isNaN(v)) ? Number(v) : null;
      const na = num(a), nb = num(b);
      let ok;
      switch (m[2]) {
        case "==": ok = a === b || (na !== null && nb !== null && na === nb); break;
        case "!=": ok = !(a === b || (na !== null && nb !== null && na === nb)); break;
        case ">": ok = na !== null && nb !== null ? na > nb : a > b; break;
        case "<": ok = na !== null && nb !== null ? na < nb : a < b; break;
        case ">=": ok = na !== null && nb !== null ? na >= nb : a >= b; break;
        case "<=": ok = na !== null && nb !== null ? na <= nb : a <= b; break;
        case "contains": ok = a.toLowerCase().includes(b.toLowerCase()); break;
        case "matches": try { ok = new RegExp(b, "i").test(a); } catch { ok = false; } break;
      }
      return { ok: !!ok, how: "expression", left: a, right: b };
    }
    // A plain-language question: the Director judges it. Strictly yes/no.
    const r = await runAgent("main",
      `<workflow-decision>\nWorkflow "${run.name}": decide the following and answer with exactly one word, YES or NO, then one short reason.\n` +
      `Question: ${text}\n` + (predecessors(run.graph, n.id).length ? `Context from the previous steps:\n${render("{{prev}}", run, n.id).slice(0, 4000)}\n` : "") +
      `</workflow-decision>`, { workflow: run.id, node: n.id, noSub: true });
    if (!r || !r.ok) throw new Error("decision turn failed");
    const ok = /^\s*\**\s*yes\b/i.test(String(r.text || ""));
    return { ok, how: "judged", reason: String(r.text || "").slice(0, 300) };
  }

  function execApproval(run, n) {
    if (!approvals) return failNode(run, n.id, "approvals unavailable"), schedule(run);
    const detail = render(n.text, run, n.id);
    setState(run, n.id, "waiting");
    approvals.ask({ kind: "workflow", title: `Workflow "${run.name}" needs your approval`, detail: detail || "Continue?",
      meta: { runId: run.id, nodeId: n.id } });
  }
  // Called by the approvals handler when a person decides.
  function resume(runId, nodeId, decision, note) {
    const run = live.get(runId) || readRun(runId);
    if (!run || !run.nodes[nodeId] || run.nodes[nodeId].state !== "waiting") return false;
    live.set(runId, run);
    if (decision === "approve") finishNode(run, nodeId, { approved: true, note: note || "" });
    else { failNode(run, nodeId, "rejected" + (note ? ": " + note : "")); }
    schedule(run);
    return true;
  }

  function execNotify(run, n) {
    const body = render(n.text, run, n.id);
    notify({ kind: "workflow", title: "🔀 " + run.name, body, link: "workflow:" + run.id });
    return body;
  }

  function parseDelay(text, at) {
    const t = String(text || "").trim().toLowerCase();
    let m;
    if ((m = /^until\s+(\d\d?):(\d\d)$/.exec(t))) {
      const d = new Date(at); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (d.getTime() <= at) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    let ms = 0, any = false;
    for (const part of t.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d)\b/g)) {
      any = true;
      const v = Number(part[1]);
      ms += { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000 }[part[2]] * v;
    }
    if (!any) throw new Error(`can't read delay "${text}" — use 10m, 2h, 30s, or until 09:00`);
    return at + ms;
  }
  function execDelay(run, n) {
    const resumeAt = parseDelay(render(n.text, run, n.id), now());
    setState(run, n.id, "waiting", { resumeAt });
    armDelay(run, n.id, resumeAt);
  }
  function armDelay(run, nodeId, resumeAt) {
    const key = run.id + "|" + nodeId;
    const t = setTimeout(() => {
      timers.delete(key);
      const r = live.get(run.id) || readRun(run.id);
      if (!r || r.nodes[nodeId].state !== "waiting") return;
      live.set(r.id, r);
      finishNode(r, nodeId, { waitedUntil: resumeAt });
      schedule(r);
    }, Math.max(0, resumeAt - now()));
    timers.set(key, t);
  }

  async function execOutput(run, n) {
    const text = render(n.text, run, n.id);
    const m = /^(file|channel)\s*:\s*(.*)$/s.exec(text.trim());
    if (m && m[1] === "file") {
      const p = m[2].trim().split("\n")[0].trim();
      const body = render("{{prev}}", run, n.id);
      if (!p) throw new Error("output file: needs a path");
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
      return { file: p, bytes: Buffer.byteLength(body) };
    }
    if (m && m[1] === "channel") { const body = m[2].trim() || render("{{prev}}", run, n.id); relay(body); return { channel: true, body }; }
    return text || render("{{prev}}", run, n.id);
  }

  // ---- restart ----------------------------------------------------------------
  // Delays re-arm, approvals stay pending in the inbox, and an agent turn that was
  // mid-flight when the daemon died is marked failed (it can't be re-attached).
  function resumeAll() {
    let n = 0;
    try {
      for (const f of fs.readdirSync(RUNS)) {
        if (!f.endsWith(".json")) continue;
        const run = readRun(f.replace(/\.json$/, ""));
        if (!run || run.state !== "running") continue;
        live.set(run.id, run); n++;
        for (const [id, st] of Object.entries(run.nodes)) {
          const node = nodeOf(run.graph, id);
          if (st.state === "running") failNode(run, id, "the office restarted during this step");
          else if (st.state === "waiting" && node.type === "delay" && st.resumeAt) armDelay(run, id, st.resumeAt);
        }
        schedule(run);
      }
    } catch (e) { log("[wf] resume " + e.message); }
    return n;
  }
  function cancel(runId) {
    const run = live.get(runId) || readRun(runId);
    if (!run || run.state !== "running") return false;
    for (const [id, st] of Object.entries(run.nodes)) if (["pending", "running", "waiting", "ready"].includes(st.state)) failNode(run, id, "cancelled");
    for (const [k, t] of timers) if (k.startsWith(run.id + "|")) { clearTimeout(t); timers.delete(k); }
    run.state = "failed"; run.endedAt = now(); live.delete(run.id); saveRun(run);
    broadcast({ type: "workflow.run", run: summary(run) }, false);
    return true;
  }

  function runs(o = {}) {
    let out = [];
    try {
      for (const f of fs.readdirSync(RUNS)) {
        if (!f.endsWith(".json")) continue;
        const r = readRun(f.replace(/\.json$/, ""));
        if (r && (!o.workflowId || r.workflowId === o.workflowId)) out.push(summary(r));
      }
    } catch {}
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out.slice(0, Math.max(1, Math.min(Number(o.limit) || 50, MAX_RUNS)));
  }

  return { load, start, resume, resumeAll, cancel, runs, getRun: (id) => { const r = live.get(id) || readRun(id); return r ? summary(r) : null; },
           getRunFull: (id) => live.get(id) || readRun(id), render, parseDelay, decisionEdge, AGENT_TYPES,
           registerNode, unregisterOwner, nodeTypes, save, exists, dir: DIR, TYPES: BUILTIN };
};
// Plugins may borrow the tiny client (require(path.join(ctx.daemonDir, "workflows")).httpFetch).
module.exports.httpFetch = httpFetch;

// A tiny http(s) client — no dependencies, no redirects beyond one hop.
function httpFetch(url, o = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const data = o.body != null ? Buffer.from(String(o.body)) : null;
    const r = mod.request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: o.method || "GET",
      headers: { "user-agent": "bagidea-office", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}), ...(o.headers || {}) },
      timeout: o.timeout || 20000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && !o._redirected) {
        res.resume();
        return httpFetch(new URL(res.headers.location, url).toString(), { ...o, _redirected: true }).then(resolve, reject);
      }
      let b = ""; res.setEncoding("utf8");
      res.on("data", (c) => { if (b.length < 2_000_000) b += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    r.on("timeout", () => { r.destroy(new Error("timed out")); });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}
module.exports.httpFetch = httpFetch;
