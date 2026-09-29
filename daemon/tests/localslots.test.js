// 🧠 Local-model slot gate — cap on concurrent LM Studio spawns.
//
// Field evidence (25 Sep 2026, ~/.lmstudio/server-logs/2026-09/2026-09-25.4.log):
// agents-a1-4b-fable-preview-heretic (unified KV cache, 262144 ctx, 8 slots) logged
// 36× "failed to decode, ret = 1" when eight delegates each opened with a ~60k-token
// prompt at once. The daemon only throttled SCHEDULED jobs (dispatchJob/reg.maxJobs).
// These tests pin: default cap 4, registry/env tuning, FIFO queueing with automatic
// start as slots free, the exact "waiting for a local-model slot" phrase, cancel, and
// the server.js wiring (gate before any task row / child, release in every end funnel).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const L = require("../localslots");

// ── limit resolution ────────────────────────────────────────────────────
test("default cap is 4 for lmstudio, and only lmstudio is gated", () => {
  assert.strictEqual(L.limitFor("lmstudio", {}, {}), 4);
  assert.strictEqual(L.isGated("lmstudio"), true);
  assert.strictEqual(L.isGated("claude"), false);
  assert.strictEqual(L.isGated("openai"), false);
  assert.strictEqual(L.limitFor("claude", {}, {}), 0, "non-gated → 0 (no cap)");
});

test("LMSTUDIO_MAX_CONCURRENT tunes the cap; the registry wins over env", () => {
  assert.strictEqual(L.limitFor("lmstudio", {}, { LMSTUDIO_MAX_CONCURRENT: "2" }), 2);
  const reg = { providerConfig: { lmstudio: { maxConcurrent: 6 } } };
  assert.strictEqual(L.limitFor("lmstudio", reg, { LMSTUDIO_MAX_CONCURRENT: "2" }), 6);
});

test("0 means uncapped (opt out); garbage falls back to the default", () => {
  assert.strictEqual(L.limitFor("lmstudio", { providerConfig: { lmstudio: { maxConcurrent: 0 } } }, {}), 0);
  assert.strictEqual(L.limitFor("lmstudio", {}, { LMSTUDIO_MAX_CONCURRENT: "0" }), 0);
  assert.strictEqual(L.limitFor("lmstudio", {}, { LMSTUDIO_MAX_CONCURRENT: "lots" }), 4);
  assert.strictEqual(L.limitFor("lmstudio", { providerConfig: { lmstudio: { maxConcurrent: -3 } } }, {}), 4);
  assert.strictEqual(L.limitFor("lmstudio", {}, { LMSTUDIO_MAX_CONCURRENT: "2.9" }), 2, "floored");
});

// ── the gate ────────────────────────────────────────────────────────────
function harness(limit) {
  const gate = new L.SlotGate("lmstudio", () => limit.n);
  const started = [];
  const releases = {};
  const enter = (id) => gate.enter({ agent: id }, (release) => { started.push(id); releases[id] = release; });
  return { gate, started, releases, enter };
}

test("the first N runs start at once; the (N+1)th queues with its position", () => {
  const h = harness({ n: 2 });
  assert.deepStrictEqual(h.enter("a"), { queued: false, running: 1, limit: 2 });
  assert.deepStrictEqual(h.enter("b"), { queued: false, running: 2, limit: 2 });
  const c = h.enter("c");
  assert.deepStrictEqual(c, { queued: true, position: 1, running: 2, limit: 2 });
  assert.strictEqual(h.enter("d").position, 2);
  assert.deepStrictEqual(h.started, ["a", "b"]);
  assert.deepStrictEqual(h.gate.state(), { running: 2, queued: 2, limit: 2 });
});

test("a release starts the next queued run automatically, in FIFO order", () => {
  const h = harness({ n: 1 });
  h.enter("a"); h.enter("b"); h.enter("c");
  assert.deepStrictEqual(h.started, ["a"]);
  h.releases.a();
  assert.deepStrictEqual(h.started, ["a", "b"], "b started the moment a finished");
  assert.strictEqual(h.gate.state().running, 1);
  h.releases.b();
  assert.deepStrictEqual(h.started, ["a", "b", "c"]);
  h.releases.c();
  assert.deepStrictEqual(h.gate.state(), { running: 0, queued: 0, limit: 1 });
});

test("release is idempotent — a double release cannot over-admit", () => {
  const h = harness({ n: 1 });
  h.enter("a"); h.enter("b"); h.enter("c");
  h.releases.a(); h.releases.a(); h.releases.a();
  assert.deepStrictEqual(h.started, ["a", "b"], "only ONE slot was freed");
  assert.strictEqual(h.gate.state().running, 1);
});

test("regression: 8 delegates on a cap of 4 never exceed 4 concurrent, and all 8 run", () => {
  const gate = new L.SlotGate("lmstudio", () => 4);
  let running = 0, peak = 0, finished = 0;
  const rel = [];
  for (let i = 0; i < 8; i++) {
    gate.enter({ agent: "d" + i }, (release) => {
      running++; peak = Math.max(peak, running);
      rel.push(() => { running--; finished++; release(); });
    });
  }
  assert.strictEqual(peak, 4);
  assert.strictEqual(gate.state().queued, 4);
  // finish them one by one; each end admits exactly one more
  while (rel.length) { rel.shift()(); assert.ok(running <= 4, "cap held at " + running); peak = Math.max(peak, running); }
  assert.strictEqual(peak, 4, "the cap was never exceeded");
  assert.strictEqual(finished, 8, "every delegate eventually ran");
  assert.deepStrictEqual(gate.state(), { running: 0, queued: 0, limit: 4 });
});

test("the limit is read live — raising it drains the queue on the next release; 0 = no queueing", () => {
  const lim = { n: 1 };
  const h = harness(lim);
  h.enter("a"); h.enter("b"); h.enter("c"); h.enter("d");
  lim.n = 3;
  h.releases.a();
  assert.deepStrictEqual(h.started, ["a", "b", "c", "d"], "one release + a wider cap admits everyone that fits");
  lim.n = 0;
  assert.strictEqual(h.enter("e").queued, false, "uncapped never queues");
});

test("lowering the limit under running work just stops admitting until it drains", () => {
  const lim = { n: 3 };
  const h = harness(lim);
  h.enter("a"); h.enter("b"); h.enter("c");
  lim.n = 1;
  h.enter("d");
  h.releases.a();
  assert.deepStrictEqual(h.started, ["a", "b", "c"], "still 2 running > cap 1 → d waits");
  h.releases.b();
  assert.deepStrictEqual(h.started, ["a", "b", "c"], "1 running = cap 1 → d still waits");
  h.releases.c();
  assert.deepStrictEqual(h.started, ["a", "b", "c", "d"], "now 0 running → d admitted");
});

test("cancel removes queued runs without ever starting them", () => {
  const h = harness({ n: 1 });
  h.enter("a"); h.enter("b"); h.enter("c");
  const gone = h.gate.cancel((m) => m.agent === "b");
  assert.strictEqual(gone.length, 1);
  assert.strictEqual(gone[0].meta.agent, "b");
  h.releases.a();
  assert.deepStrictEqual(h.started, ["a", "c"], "b was skipped, c started");
});

test("a start() that throws gives its slot back", () => {
  const gate = new L.SlotGate("lmstudio", () => 1);
  assert.throws(() => gate.enter({}, () => { throw new Error("boom"); }));
  assert.strictEqual(gate.state().running, 0);
  let ok = false;
  gate.enter({}, () => { ok = true; });
  assert.ok(ok, "the next run is not wedged behind a dead slot");
});

test("createSlots follows the live registry and keeps one lane per provider", () => {
  const reg = { providerConfig: {} };
  const slots = L.createSlots({ getReg: () => reg, env: {} });
  assert.strictEqual(slots.laneFor("claude"), null, "Claude is never gated");
  const lane = slots.laneFor("lmstudio");
  assert.strictEqual(lane, slots.laneFor("lmstudio"), "same lane object");
  assert.strictEqual(lane.limit(), 4);
  reg.providerConfig.lmstudio = { maxConcurrent: 2 };
  assert.strictEqual(lane.limit(), 2, "a registry edit applies without a restart");
  assert.deepStrictEqual(slots.snapshot(), { lmstudio: { running: 0, queued: 0, limit: 2 } });
});

// ── the visible state ───────────────────────────────────────────────────
test("the queued line carries the exact phrase the session log must show", () => {
  const line = L.waitLine("lmstudio", { queued: true, position: 3, running: 4, limit: 4 });
  assert.ok(line.includes("waiting for a local-model slot"), line);
  assert.ok(line.includes("4/4"), "says how full the model is");
  assert.ok(line.includes("2 ahead"), "says where in line");
  assert.ok(L.waitLine("lmstudio", { position: 1, running: 4, limit: 4 }).includes("next in line"));
  assert.match(L.startLine("lmstudio", 42_000), /slot free/);
  assert.match(L.startLine("lmstudio", 42_000), /waited 42s/);
});

// ── server.js wiring (code shape, like field-issue-52) ──────────────────
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").split("\r").join("");
const block = (from, to) => {
  const i = SERVER.indexOf(from);
  assert.ok(i > -1, "block not found: " + from.slice(0, 50));
  const j = SERVER.indexOf(to, i + from.length);
  return SERVER.slice(i, j > -1 ? j : i + 4000);
};

test("runClaude takes a slot BEFORE any project counter, task row or child exists", () => {
  const run = block("function runClaude(agent, prompt, opts = {}) {", "const child = spawnAgent(agent, args, {");
  const gate = run.indexOf("localSlots.laneFor(effProvider)");
  assert.ok(gate > -1, "the gate is in runClaude");
  assert.ok(gate < run.indexOf("projRuns[projId] = (projRuns[projId] || 0) + 1"), "before the project run counter");
  assert.ok(gate < run.indexOf('broadcast({ type: "task.started"'), "before the task row");
  assert.ok(gate < run.indexOf("if (opts.resumable) pauseActive("), "before the ACTIVE bookkeeping");
  // the queued branch parks and returns — nothing half-starts
  const queued = block("if (res.queued) {\n        parked = { at: Date.now() };", "if (projId) {");
  assert.match(queued, /localslots\.waitLine\(effProvider, res\)/);
  assert.match(queued, /entry\.log\.push\(\{ who: "agent", text: line, ts: Date\.now\(\), queued: true \}\)/, "visible in the session log");
  assert.match(queued, /saveSess\(\);/, "…and persisted");
  assert.match(queued, /if \(opts\.resumable\) pauseActive\(/, "a queued delegate survives a restart");
  assert.match(queued, /return task;/);
});

test("the slot is released from every end funnel — never leaked", () => {
  assert.match(block("const fireDone = (text, ok) => {", "if (opts.onDone)"), /releaseSlot\(\);/, "fireDone");
  assert.match(block("const maybeRecover = (rtext) => {", "autoRecoverOverflow("), /releaseSlot\(\);/, "overflow recovery");
  assert.match(block("const tryFailover = (st) => {", "killTree(child)"), /releaseSlot\(\);/, "brain failover");
  assert.match(block("if (!m.is_error && subTasks.length) {", "runSubAgents("), /releaseSlot\(\);/, "SUB: split hand-off");
  assert.match(block("const gate = budget.check(agent, projId);", "return task;"), /slot\.release\(\)/, "budget refusal on re-entry");
  assert.match(block("overBudget(agent, entry, cwd)) {", "return task;"), /slot\.release\(\)/, "compaction on re-entry");
});

test("a re-entered run reuses the queued thread and logs the prompt only once", () => {
  const head = block("function runClaude(agent, prompt, opts = {}) {", "// Project binding:");
  assert.match(head, /entry = slot\.entry; isNew = slot\.isNew;/);
  const logBlock = block("// The prompt is logged ONCE", "// Persona + assigned skills");
  assert.match(logBlock, /if \(!slot \|\| entry !== slot\.entry\) \{/);
  assert.match(logBlock, /entry\.log\.push\(\{ who: "you"/);
  assert.match(block("if (slot) {\n    releaseSlot = slot.release;", "} else {"), /localslots\.startLine\(slot\.provider/, "says when it finally started");
});

test("ghosts (SUB: split) and the stop route honour the gate too", () => {
  const sub = block("function runSub(parentId, subId, taskText, entry, onDone) {", "function runSubNow(");
  assert.match(sub, /localSlots\.laneFor\(prov\)/);
  assert.match(sub, /localslots\.waitLine\(prov, res\)/);
  assert.match(block("const finish = (ok) => {\n    if (finished) return;", "onDone(lastText, ok);"), /releaseSlot\(\)/, "a ghost frees its slot when it ends");
  const stop = block('req.url === "/task/stop"', 'res.writeHead(200); res.end("ok");');
  assert.match(stop, /lane\.cancel\(/, "stopping an agent also drops its queued runs");
  assert.match(stop, /onCancel\(/, "…and finishes them as failed so the Director hears back");
});

test("the scheduled-job throttle is untouched (this cap is additional, not a replacement)", () => {
  assert.match(block("function dispatchJob(job) {", "agentBusy.add(job.agent);"), /reg\.maxJobs \|\| 3/);
});
