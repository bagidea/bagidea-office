// v1.4: the Codex system tool (design G2) and the plugin hooks (design H).
//   codex   — argument shape, the JSONL protocol, a fake binary end to end,
//             failure paths, settings, the agent note
//   plugins — onEvent dispatch, memory providers (opt-in, budget, timeout,
//             a throw yields nothing), trigger kinds and workflow nodes
//             contributed by a plugin and dropped on reload
//   server  — wiring assertions
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-codex-"));

// A stand-in for the codex binary: a node script that speaks the JSONL protocol.
function fakeCodex(dir, mode) {
  const file = path.join(dir, "fake-codex.js");
  fs.writeFileSync(file, `
const fs = require("fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 9.9.9"); process.exit(0); }
let input = ""; try { input = fs.readFileSync(0, "utf8"); } catch {}
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ type: "thread.started", thread_id: "t1" });
out({ type: "turn.started" });
fs.writeFileSync("codex-args.json", JSON.stringify({ args, input, cwd: process.cwd() }));
if (${JSON.stringify(mode)} === "fail") { out({ type: "turn.failed", error: { message: "model refused" } }); process.exit(1); }
out({ type: "item.started", item: { id: "i1", type: "command_execution", command: "echo hi" } });
out({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "echo hi", exit_code: 0 } });
fs.writeFileSync("made-by-codex.txt", "hi");
out({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "Done: wrote made-by-codex.txt for task: " + input.trim() } });
out({ type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 100, output_tokens: 40 } });
`);
  return file;
}
function mkCodex(o = {}) {
  const dir = tmp();
  const bin = fakeCodex(dir, o.mode);
  const events = [], usage = [];
  const reg = { codex: o.settings };
  const codex = require("../codex")({ reg, saveReg: () => {}, broadcast: (e) => events.push(e), log: () => {},
    // run the fake through node explicitly — no shell, no PATH
    spawn: (cmd, args, opts) => require("child_process").spawn(process.execPath, [bin, ...args], { ...opts, shell: false }),
    spawnSync: (cmd, args, opts) => require("child_process").spawnSync(process.execPath, [bin, ...args], { ...opts, shell: false }),
    bin: "codex", onUsage: (...a) => usage.push(a), isolate: o.isolate });
  return { codex, dir, events, usage, reg };
}

test("codex: exec runs the binary in the project dir with the prompt on stdin, streams steps, returns text + usage + diff", async () => {
  const { codex, dir, events, usage } = mkCodex();
  const work = path.join(dir, "proj"); fs.mkdirSync(work);
  const r = await codex.exec({ task: "make the file", dir: work, agent: "priya", project: "p1" });
  assert.strictEqual(r.ok, true, r.error);
  assert.match(r.text, /Done: wrote made-by-codex.txt for task: make the file/);
  assert.deepStrictEqual(r.usage, { input_tokens: 1200, cached_input_tokens: 100, output_tokens: 40 });
  assert.deepStrictEqual(usage, [["priya", "p1", 1200, 40]], "cost is attributed to the calling agent and project");
  const a = JSON.parse(fs.readFileSync(path.join(work, "codex-args.json"), "utf8"));
  assert.strictEqual(a.input, "make the file");
  assert.ok(a.args.includes("--json") && a.args.includes("--ephemeral") && a.args.includes("--skip-git-repo-check"));
  assert.strictEqual(a.args[a.args.indexOf("-s") + 1], "workspace-write", "the default sandbox can edit the project");
  assert.strictEqual(a.args[a.args.indexOf("-C") + 1], work);
  assert.strictEqual(a.args[a.args.length - 1], "-", "prompt via stdin");
  assert.ok(fs.existsSync(path.join(work, "made-by-codex.txt")));
  assert.ok(r.steps.some((s) => /echo hi/.test(s.text)));
  assert.ok(events.some((e) => e.type === "codex.run" && e.run.state === "running"));
  assert.ok(events.some((e) => e.type === "codex.run" && e.run.state === "done"));
  assert.strictEqual(codex.list()[0].id, r.id);
});

test("codex: a failed turn reports the model's error; a missing dir, empty task and switched-off tool refuse cleanly", async () => {
  const f = mkCodex({ mode: "fail" });
  const r = await f.codex.exec({ task: "x", dir: f.dir });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /model refused/);
  const g = mkCodex();
  assert.strictEqual((await g.codex.exec({ task: "x", dir: path.join(g.dir, "nope") })).error.slice(0, 17), "no such directory");
  assert.match((await g.codex.exec({ task: "  " })).error, /task is required/);
  g.codex.setSettings({ enabled: false });
  assert.match((await g.codex.exec({ task: "x", dir: g.dir })).error, /switched off/);
});

test("codex: review uses `exec review` and settings pick the model / local provider", async () => {
  const { codex, dir } = mkCodex({ settings: { model: "gpt-5-codex", oss: true, localProvider: "lmstudio", sandbox: "read-only" } });
  const s = codex.settings();
  assert.deepStrictEqual([s.model, s.oss, s.localProvider, s.sandbox], ["gpt-5-codex", true, "lmstudio", "read-only"]);
  const r = await codex.review({ dir, base: "main", instructions: "look for races" });
  assert.strictEqual(r.ok, true, r.error);
  const a = JSON.parse(fs.readFileSync(path.join(dir, "codex-args.json"), "utf8"));
  assert.deepStrictEqual(a.args.slice(0, 4), ["exec", "review", "--base", "main"]);
  assert.ok(a.args.includes("--oss") && a.args[a.args.indexOf("--local-provider") + 1] === "lmstudio");
  assert.strictEqual(a.args[a.args.indexOf("-m") + 1], "gpt-5-codex");
  assert.ok(!a.args.includes("--ephemeral"), "review has no sandbox/ephemeral flags");
  assert.strictEqual(a.input, "look for races");
  assert.ok(!/[฀-๿]/.test(codex.agentNote()), "the agent note is English (or empty)");
  assert.deepStrictEqual(codex.SANDBOXES, ["read-only", "workspace-write", "danger-full-access"]);
  assert.strictEqual(codex.setSettings({ sandbox: "danger-full-access" }).sandbox, "danger-full-access");
  assert.strictEqual(codex.setSettings({ sandbox: "nonsense" }).sandbox, "danger-full-access", "an unknown sandbox keeps the old one");
});

test("codex: the JSONL handler tolerates junk and picks up errors", () => {
  const { codex } = mkCodex();
  const r = { text: "", steps: [], usage: null, error: "", threadId: "" };
  codex._handle(r, "not json");
  codex._handle(r, JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
  codex._handle(r, JSON.stringify({ type: "error", message: "rate limited" }));
  assert.strictEqual(r.text, "hello");
  assert.strictEqual(r.error, "rate limited");
});

// ---- plugin hooks -----------------------------------------------------------------
function writePlugin(root, id, body, manifest = {}) {
  const dir = path.join(root, "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ id, name: id, version: "1.0.0", ...manifest }));
  fs.writeFileSync(path.join(dir, "index.js"), body);
}
function mkHost(root, extra = {}) {
  const logs = [];
  const reg = { agents: { main: { memoryPlugins: ["memo"] }, priya: {} } };
  const triggers = require("../triggers")({ reg: { triggers: [] }, workflows: { start: () => ({ id: "r1" }), load: (id) => ({ id, name: "W", nodes: [], edges: [] }) }, log: () => {} });
  const workflows = require("../workflows")({ dir: path.join(root, "wf"), runAgent: async () => ({ ok: true, text: "agent said" }), log: () => {} });
  const plugins = require("../plugins")({ pluginsDir: path.join(root, "plugins"), log: (m) => logs.push(m), reg, triggers, workflows, ...extra });
  return { plugins, logs, reg, triggers, workflows };
}

test("plugins: onEvent reaches every plugin that exports it; one plugin's throw never stops another", () => {
  const root = tmp();
  writePlugin(root, "listener", `module.exports = (ctx) => { const seen = []; ctx.__seen = seen; return { onEvent: (t, e) => { require("fs").appendFileSync(require("path").join(ctx.dataDir, "seen.txt"), t + "\\n"); } }; };`);
  writePlugin(root, "thrower", `module.exports = () => ({ onEvent: () => { throw new Error("boom"); } });`);
  const { plugins, logs } = mkHost(root);
  assert.strictEqual(plugins.onEvent({ type: "task.completed" }), 2);
  assert.strictEqual(plugins.onEvent({ type: "world.pos" }), 0, "position spam is skipped");
  assert.strictEqual(fs.readFileSync(path.join(root, "plugins", "listener", "data", "seen.txt"), "utf8"), "task.completed\n");
  assert.ok(logs.some((l) => /thrower onEvent: boom/.test(l)));
  assert.strictEqual(plugins.list().find((p) => p.id === "listener").hooks.onEvent, true);
});

test("plugins: memory providers are opt-in per agent, budgeted, time-boxed, and a throw yields nothing", async () => {
  const root = tmp();
  writePlugin(root, "memo", `module.exports = (ctx) => { ctx.memory.provider((agent) => ["we decided X because Y", "agent=" + agent, "x".repeat(2000)]); return {}; };`);
  writePlugin(root, "slow", `module.exports = (ctx) => { ctx.memory.provider(() => new Promise((r) => setTimeout(() => r("late"), 3000))); return {}; };`);
  writePlugin(root, "broken", `module.exports = (ctx) => { ctx.memory.provider(() => { throw new Error("nope"); }); return {}; };`);
  const { plugins, reg } = mkHost(root);
  assert.deepStrictEqual(plugins.memoryPlugins().sort(), ["broken", "memo", "slow"]);
  const lines = await plugins.memoryLines("main", {});
  assert.match(lines, /<plugin-memory>/);
  assert.match(lines, /we decided X because Y/);
  assert.match(lines, /agent=main/);
  assert.ok(!/xxxxxxxxxx/.test(lines), "a line over the budget is dropped");
  assert.ok(lines.length < 1700, "the whole block stays inside the budget");
  assert.strictEqual(await plugins.memoryLines("priya", {}), "", "an agent that did not opt in gets nothing");
  reg.agents.priya.memoryPlugins = ["slow", "broken"];
  const t0 = Date.now();
  assert.strictEqual(await plugins.memoryLines("priya", {}), "", "a slow provider times out; a throwing one yields nothing");
  assert.ok(Date.now() - t0 < 2500, "the timeout is the core's, not the plugin's");
});

test("plugins: a plugin contributes a trigger kind and a workflow node; a reload drops them", async () => {
  const root = tmp();
  writePlugin(root, "mailer", `module.exports = (ctx) => {
    ctx.triggers.register("mail", { start: (t, fire) => { const h = setInterval(() => fire({ from: "a@b" }), 20); return h; }, stop: (h) => clearInterval(h), label: "📬 mail" });
    ctx.workflow.node("shout", (n, h) => n.text.toUpperCase() + "|" + h.prev, { label: "📣 Shout" });
    return {};
  };`);
  const { plugins, triggers, workflows } = mkHost(root);
  assert.ok(triggers.kinds().some((k) => k.kind === "mail" && !k.builtin && k.owner === "mailer"));
  assert.ok(workflows.nodeTypes().some((k) => k.kind === "shout" && k.owner === "mailer"));
  assert.throws(() => triggers.registerKind("schedule", { start() {} }, "x"), /built in/);
  assert.throws(() => workflows.registerNode("action", () => {}), /built in/);
  const t = triggers.add({ kind: "mail", workflowId: "wf1", cfg: { folder: "INBOX", nested: { no: 1 } } });
  assert.deepStrictEqual(t.cfg, { folder: "INBOX" }, "a custom kind keeps flat fields only");
  // the custom node runs inside a workflow
  const run = workflows.start({ id: "w", name: "W", nodes: [{ id: "t", type: "trigger" }, { id: "a", type: "action", text: "hi" }, { id: "s", type: "shout", text: "loud" }],
    edges: [{ from: "t", to: "a" }, { from: "a", to: "s" }] });
  await new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const r = workflows.getRun(run.id); if (r.state !== "running") { clearInterval(i); res(); } else if (Date.now() - t0 > 3000) { clearInterval(i); rej(new Error("timeout")); } }, 15); });
  assert.strictEqual(workflows.getRunFull(run.id).nodes.s.output, "LOUD|agent said");
  // the custom trigger fires through the plugin's start()
  triggers.startAll();
  await new Promise((r) => setTimeout(r, 80));
  triggers.stopAll();
  assert.ok(triggers.get(t.id).lastRun > 0, "the plugin's trigger fired");
  const hooks = plugins.list().find((p) => p.id === "mailer").hooks;
  assert.deepStrictEqual([hooks.triggers, hooks.nodes], [["mail"], ["shout"]]);
  // reload with the plugin gone → its kinds are gone
  fs.rmSync(path.join(root, "plugins", "mailer"), { recursive: true });
  plugins.load();
  assert.ok(!triggers.kinds().some((k) => k.kind === "mail"));
  assert.ok(!workflows.nodeTypes().some((k) => k.kind === "shout"));
});

test("wiring: the daemon hands plugins the hooks, runs the codex node, mirrors work onto the board, and stopped instructing in Thai", () => {
  for (const s of [
    'notify: (item) => notify.send(item || {})', 'approvals: { ask: (item) => approvals.ask({ kind: "plugin"', 'schedule: (p) => createJob(p || {})',
    'plugins.onEvent(evt)', 'plugins.memoryLines(agent', 'workflows.registerNode("codex"', 'DELEGATE: codex @', 'codexMission("exec"',
    'req.url === "/codex/exec" || req.url === "/codex/review"', 'req.url === "/tasks/board"', 'req.url === "/calendar/ics"', 'req.url === "/calendar/import"',
    'tasks.bySource("job", job.id)', 'kind: "delegation", owner: t', 'kind: "action", owner: a.owner', 'syncWorkflowCard(evt.run)',
    'calendar.tick(now)', 'tasks.tick(now)', 'tasks.agentNote(agent)', 'memoryPlugins: Array.isArray(p.memoryPlugins)', 'codex: [1.25, 10]',
  ]) assert.ok(SERVER.includes(s), "server.js should contain: " + s);
  // the calendar module replaced the flat list entirely
  assert.ok(!/let cal = loadJson\(CAL/.test(SERVER));
  assert.ok(!/saveCal\(\)/.test(SERVER));
});
