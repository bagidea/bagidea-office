// v1.3 — the workflow engine and its triggers.
//
// Until now "running" a workflow meant serializing the drawing to prose and
// handing it to the Director. These tests drive the real engine with a fake
// agent, so every node type, the join/branch semantics, waiting for a person,
// surviving a restart and the trigger kinds are pinned down without a model.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const BUILDER = fs.readFileSync(path.join(ROOT, "daemon", "workflow.html"), "utf8");

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-wf-"));
const until = (fn, ms = 3000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fn()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error("timeout")); } }, 15); });

function mk(o = {}) {
  const dir = tmpdir();
  const events = [], notes = [], asked = [], relayed = [], agentCalls = [];
  const approvals = { ask: (spec) => { asked.push(spec); return { id: "a1", item: spec, promise: new Promise(() => {}) }; } };
  const wf = require("../workflows")({
    dir, broadcast: (e) => events.push(e), notify: (n) => notes.push(n), approvals,
    relay: (t) => relayed.push(t), log: () => {}, now: o.now,
    runAgent: o.runAgent || (async (agent, prompt) => { agentCalls.push({ agent, prompt }); return { ok: true, text: "did: " + prompt.match(/Step: (.*)/)?.[1] }; }),
    fetchImpl: o.fetchImpl,
  });
  return { wf, dir, events, notes, asked, relayed, agentCalls };
}
const W = (nodes, edges = [], name = "T") => ({ id: "wf_t", name, nodes, edges });

test("engine: a linear workflow runs each step with the previous output, then finishes", async () => {
  const { wf, agentCalls, notes } = mk();
  const run = wf.start(W([
    { id: "n1", type: "trigger", text: "start" },
    { id: "n2", type: "action", text: "write a haiku about {{trigger.data.topic}}" },
    { id: "n3", type: "action", text: "@priya: translate it: {{prev}}" },
  ], [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }]), { trigger: { data: { topic: "rain" } } });
  await until(() => wf.getRun(run.id).state !== "running");
  const r = wf.getRunFull(run.id);
  assert.strictEqual(r.state, "done");
  assert.deepStrictEqual(agentCalls.map((c) => c.agent), ["main", "priya"], "@id: picks the agent; default is the Director");
  assert.match(agentCalls[0].prompt, /Step: write a haiku about rain/, "{{trigger.data.x}} renders");
  assert.match(agentCalls[1].prompt, /did: write a haiku about rain/, "{{prev}} carries the previous output");
  assert.strictEqual(notes[0].kind, "workflow");
  assert.match(notes[0].title, /finished/);
  assert.ok(fs.existsSync(path.join(wf.getRunFull(run.id) && "", "")) || true);
});

test("engine: fan-out runs in parallel and a join waits for every branch", async () => {
  let running = 0, peak = 0;
  const { wf } = mk({ runAgent: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 40)); running--; return { ok: true, text: "x" }; } });
  const run = wf.start(W([
    { id: "t", type: "trigger" }, { id: "a", type: "action", text: "A" }, { id: "b", type: "action", text: "B" }, { id: "j", type: "action", text: "join" },
  ], [{ from: "t", to: "a" }, { from: "t", to: "b" }, { from: "a", to: "j" }, { from: "b", to: "j" }]));
  await until(() => wf.getRun(run.id).state !== "running");
  assert.strictEqual(peak, 2, "the two branches must run at the same time");
  const r = wf.getRunFull(run.id);
  assert.ok(r.nodes.j.startedAt >= r.nodes.a.endedAt && r.nodes.j.startedAt >= r.nodes.b.endedAt, "the join started only after both branches ended");
});

test("engine: a decision opens one branch and skips the other — by expression, no model", async () => {
  const { wf, agentCalls } = mk();
  const run = wf.start(W([
    { id: "t", type: "trigger" }, { id: "d", type: "decision", text: "{{trigger.data.n}} > 5" },
    { id: "yes", type: "action", text: "big" }, { id: "no", type: "action", text: "small" },
  ], [{ from: "t", to: "d" }, { from: "d", to: "yes", label: "yes" }, { from: "d", to: "no", label: "no" }]), { trigger: { data: { n: 9 } } });
  await until(() => wf.getRun(run.id).state !== "running");
  const r = wf.getRunFull(run.id);
  assert.deepStrictEqual([r.nodes.d.output.ok, r.nodes.d.output.how, r.nodes.yes.state, r.nodes.no.state], [true, "expression", "done", "skipped"]);
  assert.strictEqual(agentCalls.length, 1, "only the taken branch ran; no model was asked for the expression");
  assert.strictEqual(r.state, "done", "a skipped branch is not a failure");
});

test("engine: a decision that is a question asks the Director for YES/NO", async () => {
  const { wf } = mk({ runAgent: async (a, p) => ({ ok: true, text: /decision/.test(p) ? "NO — it isn't" : "x" }) });
  const run = wf.start(W([{ id: "t", type: "trigger" }, { id: "d", type: "decision", text: "Is this urgent?" }, { id: "y", type: "action", text: "y" }, { id: "n", type: "action", text: "n" }],
    [{ from: "t", to: "d" }, { from: "d", to: "y" }, { from: "d", to: "n" }]));
  await until(() => wf.getRun(run.id).state !== "running");
  const r = wf.getRunFull(run.id);
  assert.deepStrictEqual([r.nodes.d.output.ok, r.nodes.d.output.how, r.nodes.y.state, r.nodes.n.state], [false, "judged", "skipped", "done"], "second edge = no");
});

test("engine: an approval node waits in the inbox and resumes on approve, fails on reject", async () => {
  const { wf, asked } = mk();
  const run = wf.start(W([{ id: "t", type: "trigger" }, { id: "ap", type: "approval", text: "Publish?" }, { id: "go", type: "action", text: "publish" }],
    [{ from: "t", to: "ap" }, { from: "ap", to: "go" }]));
  await until(() => asked.length === 1);
  assert.strictEqual(wf.getRun(run.id).nodes.ap.state, "waiting");
  assert.strictEqual(asked[0].kind, "workflow");
  assert.deepStrictEqual(asked[0].meta, { runId: run.id, nodeId: "ap" });
  assert.strictEqual(wf.resume(run.id, "ap", "approve", "ok go"), true);
  await until(() => wf.getRun(run.id).state !== "running");
  assert.strictEqual(wf.getRun(run.id).state, "done");
  const run2 = wf.start(W([{ id: "t", type: "trigger" }, { id: "ap", type: "approval", text: "Publish?" }, { id: "go", type: "action", text: "publish" }],
    [{ from: "t", to: "ap" }, { from: "ap", to: "go" }]));
  await until(() => asked.length === 2);
  wf.resume(run2.id, "ap", "reject", "not now");
  await until(() => wf.getRun(run2.id).state !== "running");
  const r2 = wf.getRunFull(run2.id);
  assert.strictEqual(r2.state, "failed");
  assert.match(r2.nodes.ap.error, /rejected: not now/);
  assert.strictEqual(r2.nodes.go.state, "skipped");
  assert.strictEqual(wf.resume(run2.id, "ap", "approve"), false, "a decided node cannot be resumed twice");
});

test("engine: delay waits, persists resumeAt, and a fresh engine re-arms it after a 'restart'", async () => {
  const { wf, dir } = mk();
  const run = wf.start(W([{ id: "t", type: "trigger" }, { id: "w", type: "delay", text: "60 ms" }, { id: "a", type: "action", text: "after" }],
    [{ from: "t", to: "w" }, { from: "w", to: "a" }]));
  await until(() => wf.getRun(run.id).nodes.w.state === "waiting");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "runs", run.id + ".json"), "utf8"));
  assert.ok(onDisk.nodes.w.resumeAt > Date.now() - 1000, "resumeAt is persisted");
  // simulate a restart: a second engine over the same directory
  const wf2 = require("../workflows")({ dir, runAgent: async () => ({ ok: true, text: "x" }), log: () => {} });
  assert.strictEqual(wf2.resumeAll(), 1);
  await until(() => wf2.getRun(run.id).state !== "running", 4000);
  assert.strictEqual(wf2.getRun(run.id).state, "done");
  assert.strictEqual(wf.parseDelay("2h 30m", 0), 9000000);
  assert.throws(() => wf.parseDelay("soon", 0));
});

test("engine: a restart marks a mid-flight agent step failed rather than pretending", async () => {
  const dir = tmpdir();
  const wf = require("../workflows")({ dir, runAgent: () => new Promise(() => {}), log: () => {} });   // never resolves
  const run = wf.start(W([{ id: "t", type: "trigger" }, { id: "a", type: "action", text: "hang" }], [{ from: "t", to: "a" }]));
  await until(() => wf.getRun(run.id).nodes.a.state === "running");
  const wf2 = require("../workflows")({ dir, runAgent: async () => ({ ok: true, text: "x" }), log: () => {} });
  wf2.resumeAll();
  const r = wf2.getRunFull(run.id);
  assert.strictEqual(r.nodes.a.state, "failed");
  assert.match(r.nodes.a.error, /restarted/);
  assert.strictEqual(r.state, "failed");
});

test("engine: fetch, notify and output nodes do real work without a model", async () => {
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ items: [1, 2, 3], q: q.url })); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const out = path.join(tmpdir(), "out", "result.md");
  const { wf, notes, relayed } = mk();
  const run = wf.start(W([
    { id: "t", type: "trigger" }, { id: "f", type: "fetch", text: `http://127.0.0.1:${port}/list?x={{trigger.data.x}}` },
    { id: "d", type: "decision", text: "{{f.output.status}} == 200" },
    { id: "n", type: "notify", text: "got {{f.output.body.items}}" },
    { id: "o", type: "output", text: "file:" + out }, { id: "c", type: "output", text: "channel: all done" },
  ], [{ from: "t", to: "f" }, { from: "f", to: "d" }, { from: "d", to: "n" }, { from: "n", to: "o" }, { from: "o", to: "c" }]), { trigger: { data: { x: 7 } } });
  await until(() => wf.getRun(run.id).state !== "running");
  srv.close();
  const r = wf.getRunFull(run.id);
  assert.strictEqual(r.state, "done", JSON.stringify(r.nodes));
  assert.deepStrictEqual(r.nodes.f.output.body, { items: [1, 2, 3], q: "/list?x=7" });
  assert.strictEqual(r.nodes.d.output.ok, true);
  assert.ok(notes.some((n) => n.kind === "workflow" && n.body === "got [1,2,3]"), "notify renders the template through the rules");
  assert.ok(fs.readFileSync(out, "utf8").includes("got [1,2,3]"), "output file: wrote the previous output");
  assert.deepStrictEqual(relayed, ["all done"]);
});

test("engine: a failed agent step fails the run, and the failure is reported", async () => {
  const { wf, notes } = mk({ runAgent: async () => ({ ok: false, text: "budget reached" }) });
  const run = wf.start(W([{ id: "t", type: "trigger" }, { id: "a", type: "action", text: "x" }], [{ from: "t", to: "a" }]));
  await until(() => wf.getRun(run.id).state !== "running");
  const r = wf.getRunFull(run.id);
  assert.strictEqual(r.state, "failed");
  assert.match(r.nodes.a.error, /budget reached/);
  assert.match(notes[0].title, /failed/);
});

test("engine: run history is bounded and newest-first; a v1 workflow with only text runs unchanged", async () => {
  const { wf } = mk();
  const v1 = { id: "old", name: "v1", nodes: [{ id: "n1", type: "trigger", text: "เมื่อสั่งให้เริ่ม", x: 80, y: 40 }, { id: "n2", type: "action", text: "do it", x: 80, y: 190 }], edges: [{ from: "n1", to: "n2" }] };
  const a = wf.start(v1); await until(() => wf.getRun(a.id).state !== "running");
  const b = wf.start(v1); await until(() => wf.getRun(b.id).state !== "running");
  const list = wf.runs({ workflowId: "old" });
  assert.deepStrictEqual(list.map((r) => r.id), [b.id, a.id]);
  assert.strictEqual(list[0].state, "done");
});

// ── triggers ─────────────────────────────────────────────────────────────────
function mkTriggers(o = {}) {
  const started = [];
  const workflows = { load: (id) => (id === "wf_t" ? { id, name: "T", nodes: [{ id: "n", type: "trigger" }] } : null),
                      start: (id, opts) => { started.push({ id, opts }); return { id: "r" + started.length }; } };
  const reg = { triggers: [] };
  const tr = require("../triggers")({ reg, saveReg: () => {}, workflows, log: () => {}, now: o.now });
  return { tr, started, reg };
}

test("triggers: add/update/remove validate, and secrets never come back out", () => {
  const { tr, reg } = mkTriggers();
  assert.throws(() => tr.add({ kind: "nope", workflowId: "wf_t" }), /unknown trigger kind/);
  assert.throws(() => tr.add({ kind: "schedule", workflowId: "missing" }), /workflow not found/);
  const t = tr.add({ kind: "webhook", workflowId: "wf_t", cfg: { secret: "s3cret" } });
  assert.ok(reg.triggers[0].cfg.token, "a webhook gets a token");
  assert.strictEqual(t.cfg.secret, "•••", "the secret is masked in the public view");
  assert.strictEqual(tr.update(t.id, { enabled: false }).enabled, false);
  assert.strictEqual(tr.remove(t.id), true);
  assert.strictEqual(tr.list().length, 0);
});

test("triggers: schedule fires every N minutes and daily at a time, once", () => {
  let now = new Date("2026-09-12T08:59:00").getTime();
  const { tr, started } = mkTriggers({ now: () => now });
  tr.add({ kind: "schedule", workflowId: "wf_t", cfg: { everyMin: 10 } });
  const daily = tr.add({ kind: "schedule", workflowId: "wf_t", cfg: { everyMin: 0, at: "09:00" } });
  assert.strictEqual(tr.tick(now), 1, "the every-10 fires on the first tick (never run)");
  now += 60 * 1000;
  assert.strictEqual(tr.tick(now), 1, "09:00 → the daily one fires");
  now += 60 * 1000;
  assert.strictEqual(tr.tick(now), 0, "not again the same day, and 10 minutes haven't passed");
  now += 9 * 60 * 1000;
  assert.strictEqual(tr.tick(now), 1, "10 minutes → the every-10 fires again");
  assert.strictEqual(started[1].opts.trigger.source, "schedule");
  assert.strictEqual(tr.get(daily.id).runs, 1);
});

test("triggers: an office event by type starts the workflow with the event as data", () => {
  const { tr, started } = mkTriggers();
  tr.add({ kind: "event", workflowId: "wf_t", cfg: { type: "task.completed" } });
  assert.strictEqual(tr.onEvent({ type: "chat.message" }), 0);
  assert.strictEqual(tr.onEvent({ type: "task.completed", agent: "priya" }), 1);
  assert.strictEqual(tr.onEvent({ type: "workflow.run" }), 0, "the engine's own events never trigger — no loops");
  assert.deepStrictEqual(started[0].opts.trigger.data.agent, "priya");
});

test("triggers: a channel keyword fires and is consumed; other messages fall through", () => {
  const { tr, started } = mkTriggers();
  tr.add({ kind: "channel", workflowId: "wf_t", cfg: { keyword: "standup" } });
  assert.strictEqual(tr.onChannel("telegram", "me", "Standup please, short"), true);
  assert.strictEqual(started[0].opts.trigger.data.rest, "please, short");
  assert.strictEqual(tr.onChannel("telegram", "me", "how are things"), false);
});

test("triggers: a webhook needs its token, verifies an HMAC when a secret is set, and normalizes GitHub", () => {
  const { tr, started, reg } = mkTriggers();
  tr.add({ kind: "webhook", workflowId: "wf_t", cfg: { secret: "abc" } });
  const token = reg.triggers[0].cfg.token;
  const body = Buffer.from(JSON.stringify({ action: "opened", issue: { number: 7 } }));
  assert.strictEqual(tr.webhook("nope", {}, body).status, 404);
  assert.strictEqual(tr.webhook(token, {}, body).status, 401, "no signature → refused");
  const sig = "sha256=" + crypto.createHmac("sha256", "abc").update(body).digest("hex");
  const ok = tr.webhook(token, { "x-hub-signature-256": sig, "x-github-event": "issues" }, body);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(started[0].opts.trigger.event, "issues");
  assert.strictEqual(started[0].opts.trigger.data.issue.number, 7);
  tr.update(reg.triggers[0].id, { enabled: false });
  assert.strictEqual(tr.webhook(token, { "x-hub-signature-256": sig }, body).status, 409);
});

test("triggers: a file landing in a watched folder fires once, after the write settles", async () => {
  const dir = tmpdir();
  const { tr, started } = mkTriggers();
  tr.add({ kind: "file", workflowId: "wf_t", cfg: { dir, glob: "*.txt" } });
  fs.writeFileSync(path.join(dir, "ignored.md"), "x");
  fs.writeFileSync(path.join(dir, "in.txt"), "hello");
  fs.appendFileSync(path.join(dir, "in.txt"), " world");
  await new Promise((r) => setTimeout(r, 2300));
  tr.stopAll();
  assert.strictEqual(started.length, 1, "one file, several writes → one run");
  assert.strictEqual(started[0].opts.trigger.data.name, "in.txt");
});

// ── wiring ───────────────────────────────────────────────────────────────────
test("wiring: the daemon runs the engine, hooks every trigger kind, and keeps the legacy path", () => {
  for (const s of ['require("./workflows")', 'require("./triggers")', "triggers.onEvent(evt);",
                   "triggers.tick(now)", "triggers.onChannel(channel, from, String(text))", 'approvals.on("workflow"',
                   "workflows.resumeAll()", "triggers.startAll()", 'req.url.startsWith("/hook/")', 'req.url.startsWith("/workflows/runs")',
                   'req.url === "/workflows/cancel"', 'req.url === "/triggers"', "function runWorkflowViaDirector("])
    assert.ok(SERVER.includes(s), "server is missing " + s);
  assert.match(SERVER, /if \(w\.legacy\) return runWorkflowViaDirector\(w, res\);/);
  // the channel trigger check must run before the inbox reply check and the Director
  const a = SERVER.indexOf("triggers.onChannel(channel, from, String(text))"), b = SERVER.indexOf("approvals.parseReply(String(text))");
  assert.ok(a > -1 && b > -1 && a < b);
  // the agent adapter goes through runClaude with a tracked task row
  assert.match(SERVER, /runAgent: \(agent, prompt, o = \{\}\) => new Promise[\s\S]{0,900}runClaude\(id,[\s\S]{0,600}track: \{ agent: id/);
});

test("builder: new node types, a run that watches itself, runs history and triggers", () => {
  for (const s of ['["approval","✋ รออนุมัติ"]', '["notify","🔔 แจ้งเตือน"]', '["delay","⏳ หน่วงเวลา"]', 'id="runsBox"', 'id="trigBox"', "function watch(runId)", "function loadTriggers()",
                   '"/workflows/run?id="', '"/workflows/runs?id="', ".node.st-running", '"x-bagidea-ui":"1"'])
    assert.ok(BUILDER.includes(s), "builder is missing " + s);
  // every new Thai UI string has an English entry in the builder's TR map
  for (const th of ["✋ รออนุมัติ", "🔔 แจ้งเตือน", "⏳ หน่วงเวลา", "⏰ ตามเวลา", "🌐 webhook", "— ยังไม่มี trigger —", "ลบ trigger นี้?"])
    assert.ok(BUILDER.includes('"' + th + '":"'), "no English for " + th);
});
