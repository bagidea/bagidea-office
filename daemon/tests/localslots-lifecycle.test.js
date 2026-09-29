const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const localslots = require("../localslots");
const { runIdleMsFor, runTotalMsFor } = require("../watchdog");

// Run the actual admission, child tracking, completion and stop-route code.
// server.js listens on import, so evaluate these two handlers with inert process
// and persistence adapters. No daemon, CLI, model or live office state is used.
function harness() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const runStart = source.indexOf("function runClaude(agent, prompt, opts = {}) {");
  const runEnd = source.indexOf("// Summarize a thread's visible history", runStart);
  const stopStart = source.indexOf('// ⏹ Cancel a running agent task mid-flight');
  const stopEnd = source.indexOf('} else if (req.method === "POST" && req.url === "/projects/stopwork")', stopStart);
  assert.ok(runStart >= 0 && runEnd > runStart && stopStart >= 0 && stopEnd > stopStart);
  const events = [], children = [], killed = [];
  const reg = {
    agents: { worker: { name: "Worker", provider: "lmstudio" } },
    providerConfig: { lmstudio: { maxConcurrent: 1 } },
    nativeSkills: false, tts: false, mcpServers: {},
  };
  const slots = localslots.createSlots({ getReg: () => reg, env: {} });
  const ctx = {
    reg, localslots, localSlots: slots, taskCounter: 0, sess: {},
    WORKSPACE: "unused", runChildren: new Map(), projRuns: {}, projAgents: {},
    path, fs, process: { env: {} },
    console: { log() {}, error() {} },
    latestSession() { return null; }, projectDir() { return null; },
    budget: { check() { return { ok: true }; } },
    saveSess() {}, statBump() {}, projectNote() { return ""; },
    modelTag() { return "lmstudio"; },
    brainRoute() { return { ok: true, modelArgs: [], env: {} }; },
    broadcast(event) { events.push(event); },
    maxout: require("../maxout"),
    RUN_IDLE_MS: 300000, RUN_TOTAL_MS: 1800000, LOCAL_RUN_TOTAL_MS: 3600000,
    runIdleMsFor, runTotalMsFor,
    RunWatchdog: class { start() {} clear() {} },
    SUB_NOTE: "", isOverflowError() { return false; },
    spawnAgent(agent, args, options) {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdin.resume();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.task = options.env.OFFICE_TASK;
      children.push(child);
      return child;
    },
    killTree(child) { killed.push(child); child.emit("close"); },
    readBody(req, callback) { callback(JSON.stringify(req.body)); },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(runStart, runEnd) +
    "\nfunction stopTask(req, res) {\n" + source.slice(stopStart, stopEnd) + "\n}", ctx);
  const stop = (task) => {
    let status, body;
    ctx.stopTask({ headers: { "x-bagidea-ui": "1" }, body: { task } }, {
      writeHead(value) { status = value; }, end(value) { body = value; },
    });
    assert.equal(status, 200, body);
  };
  return { ctx, events, children, killed, slots, stop };
}

test("a queued task keeps its returned ID and can be stopped by that ID after admission", () => {
  const h = harness();
  const first = h.ctx.runClaude("worker", "first", { session: "new" });
  let settled = 0;
  const queued = h.ctx.runClaude("worker", "queued", {
    session: "new", onDone() { settled++; },
  });
  assert.notEqual(first, queued);
  assert.equal(h.children.length, 1, "the second run is still queued");
  assert.equal(h.events.find((e) => e.type === "task.queued").task, queued);

  h.children[0].emit("close");
  assert.equal(h.children.length, 2, "completion admits the queued run");
  assert.equal(h.children[1].task, queued, "the child uses the ID returned to /chat");
  assert.equal(h.events.filter((e) => e.type === "task.started")[1].task, queued);
  assert.equal(h.ctx.runChildren.get(queued).child, h.children[1]);

  h.stop(queued); // Deliberately no agent fallback: only the original task ID.
  assert.deepEqual(h.killed, [h.children[1]]);
  assert.equal(settled, 1, "cancellation settles the admitted run once");
  assert.equal(h.ctx.runChildren.size, 0);
  assert.equal(h.slots.laneFor("lmstudio").state().running, 0);

  const next = h.ctx.runClaude("worker", "next", { session: "new" });
  assert.notEqual(next, first);
  assert.notEqual(next, queued, "a later independent run gets a new ID");
  h.stop(next);
});

test("a throw in the spawn setup after admission hands the slot back (no stranded lane)", () => {
  // Review of #63: the mcp-config write sits after admission; if it threw, the
  // lane's running count stayed incremented until restart.
  const h = harness();
  h.ctx.reg.agents.worker.tools = ["Read", "mcp:x"];
  h.ctx.reg.mcpServers = { x: { command: "x" } };
  h.ctx.STATE_DIR = "unused";
  h.ctx.mcpEntry = (s) => s;
  h.ctx.fs = { ...fs, writeFileSync() { throw new Error("EACCES: injected"); } };
  assert.throws(() => h.ctx.runClaude("worker", "first", { session: "new" }), /EACCES: injected/);
  assert.equal(h.slots.laneFor("lmstudio").state().running, 0, "the slot was released by the guard");
  assert.equal(h.children.length, 0);
  // …and the lane is usable: the next run is admitted, not queued.
  h.ctx.fs = fs; h.ctx.reg.agents.worker.tools = ["Read"];
  const next = h.ctx.runClaude("worker", "next", { session: "new" });
  assert.equal(h.children.length, 1, "admitted inline");
  assert.ok(!h.events.some((e) => e.type === "task.queued"));
  h.stop(next);
});

test("stopping a queued task by its returned ID prevents it from launching", () => {
  const h = harness();
  h.ctx.runClaude("worker", "first", { session: "new" });
  let settled = 0;
  const queued = h.ctx.runClaude("worker", "queued", {
    session: "new", onDone() { settled++; },
  });
  h.stop(queued);
  assert.equal(settled, 1);
  h.children[0].emit("close");
  assert.equal(h.children.length, 1);
  assert.equal(h.slots.laneFor("lmstudio").state().queued, 0);
  assert.equal(h.slots.laneFor("lmstudio").state().running, 0);
});
