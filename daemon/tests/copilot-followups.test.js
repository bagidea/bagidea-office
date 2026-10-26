// PR #68 follow-ups: a copilot call on a gated local brain waits for a slot like every
// other run and reports its tokens; a timed-out `claude -p` child is killed; the
// problem report's log tail carries no conversation text; the Windows URL launcher
// never goes through cmd.exe (which split a GitHub link at "&").
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const copilot = require("../copilot");
const proxy = require("../proxy");
const localslots = require("../localslots");
const report = require("../report");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").split("\r").join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chat = (content) => JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 30 } });
const reg = () => ({
  agents: { main: { name: "Shino", role: "Director", provider: "claude", model: "claude-fable-5-1" } },
  providerConfig: { lmstudio: { connected: true, models: ["served-7b"], maxConcurrent: 1 } },
  copilot: { provider: "lmstudio", model: "served-7b" },
  apiKeys: {}, skills: {}, mcpServers: {},
});

function rig(o = {}) {
  const r = reg();
  const slots = localslots.createSlots({ getReg: () => r });
  const logs = [], usage = [];
  let pending = [];              // resolvers of in-flight fake upstream calls
  const fetchImpl = async () => new Promise((res) => pending.push(() => res({ ok: true, status: 200, text: async () => chat("answer") })));
  const inst = copilot.create({
    getReg: () => r, saveReg: () => {}, broadcast: () => {}, upstreamFor: proxy.upstreamFor, fetchImpl,
    localStatus: async () => ({ lmstudio: { running: true, models: ["served-7b"] }, ollama: { running: false, models: [] } }),
    log: (s) => logs.push(s),
    slotLane: (p) => slots.laneFor(p),
    onUsage: (p, u) => usage.push({ p, ...u }),
    ...o,
  });
  return { inst, slots, logs, usage, release: () => { const f = pending.shift(); if (f) f(); return !!f; }, inFlight: () => pending.length };
}

test("copilot: a call on LM Studio takes a slot — a second call waits until the first releases it", async () => {
  const { inst, slots, logs, release, inFlight } = rig();
  const lane = slots.laneFor("lmstudio");
  const p1 = inst.run({ job: "workflow-analyze", prompt: "one" });
  await sleep(20);
  assert.strictEqual(lane.state().running, 1, "first call holds the only slot");
  assert.strictEqual(inFlight(), 1, "…and has reached the upstream");
  const p2 = inst.run({ job: "workflow-draft", prompt: "two" });
  await sleep(20);
  assert.deepStrictEqual([lane.state().running, lane.state().queued], [1, 1], "second call is parked, not sent");
  assert.strictEqual(inFlight(), 1, "the parked call made NO upstream request");
  assert.ok(logs.some((l) => /\[copilot\] workflow-draft waiting for a LM Studio · local slot \(1\/1 running, #1 in line\)/.test(l)), logs.join("\n"));
  release();
  const r1 = await p1;
  assert.strictEqual(r1.ok, true, JSON.stringify(r1.error));
  await sleep(20);
  assert.deepStrictEqual([lane.state().running, lane.state().queued], [1, 0], "the slot passed to the second call");
  assert.strictEqual(inFlight(), 1, "which is now at the upstream");
  release();
  const r2 = await p2;
  assert.strictEqual(r2.ok, true, JSON.stringify(r2.error));
  assert.deepStrictEqual(lane.state(), { running: 0, queued: 0, limit: 1 }, "both slots released");
});

test("copilot: the slot is released when the call fails, and a cancelled wait answers with an error instead of hanging", async () => {
  const { inst, slots, release } = rig({ fetchImpl: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } });
  const lane = slots.laneFor("lmstudio");
  const r = await inst.run({ job: "persona", prompt: "x" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, "NETWORK");
  assert.deepStrictEqual(lane.state(), { running: 0, queued: 0, limit: 1 }, "a failed call gives its slot back");
  // occupy the slot by hand, queue a copilot call, then cancel the queue like /agents/stop does
  let hold;
  lane.enter({ agent: "nina", task: "t1" }, (rel) => { hold = rel; });
  const p = inst.run({ job: "persona", prompt: "y" });
  await sleep(20);
  assert.strictEqual(lane.state().queued, 1);
  const gone = lane.cancel((m) => m.agent === "main");
  assert.strictEqual(gone.length, 1);
  gone[0].meta.onCancel("stopped by the owner while waiting for a local-model slot");
  const rc = await p;
  assert.strictEqual(rc.ok, false);
  assert.match(rc.error.message, /stopped by the owner while waiting for a local-model slot/);
  hold();
  void release;
});

test("copilot: a provider without a gate (cloud) never waits, and token usage reaches onUsage", async () => {
  const { inst, usage, release } = rig();
  const r0 = reg(); r0.copilot = { provider: "openrouter", model: "m" }; r0.providerConfig.openrouter = { token: "sk-or-secret-1234567890", connected: true };
  const own = rig({ getReg: () => r0 });
  const p = own.inst.run({ job: "persona", prompt: "cloud" });
  await sleep(20);
  assert.strictEqual(own.inFlight(), 1, "straight to the upstream");
  own.release();
  const r = await p;
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.deepStrictEqual(own.usage, [{ p: "openrouter", in: 120, out: 30 }]);
  void inst; void usage; void release;
});

test("copilot: the claude path hands claudeText an AbortSignal that fires on timeout", async () => {
  let seen = null;
  const inst = copilot.create({
    getReg: () => ({ ...reg(), copilot: { provider: "claude", model: "claude-fable-5-1" } }), saveReg: () => {}, broadcast: () => {},
    upstreamFor: proxy.upstreamFor, log: () => {},
    claudeText: (prompt, opts) => new Promise((res) => { seen = opts; opts.signal.addEventListener("abort", () => res(""), { once: true }); }),
  });
  const r = await inst.run({ job: "persona", prompt: "slow", timeoutMs: 1000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, "TIMEOUT");
  assert.ok(seen && seen.signal instanceof AbortSignal && seen.signal.aborted, "the signal was aborted when the copilot gave up");
});

test("server.js: claudeText kills its child on opts.signal, and copilot gets the slot lane + usage sink", () => {
  const ct = SERVER.slice(SERVER.indexOf("function claudeText("), SERVER.indexOf("function claudeText(") + 3000);
  assert.match(ct, /if \(opts\.signal\) \{/);
  assert.match(ct, /killTree\(child\)/);
  assert.match(ct, /addEventListener\("abort", onAbort, \{ once: true \}\)/);
  assert.match(SERVER, /require\("\.\/copilot"\)\.init\(\{[\s\S]*?slotLane: \(provider\) => localSlots\.laneFor\(provider\)/);
  assert.match(SERVER, /onUsage: \(provider, usage\) => brainBump\(provider, usage\.in, usage\.out, "main"\)/);
});

test("server.js: POST /open never hands a URL to cmd.exe on Windows", () => {
  const at = SERVER.indexOf('req.url === "/open"');
  const block = SERVER.slice(at, at + 1800);
  assert.ok(!/spawn\("cmd"/.test(block), "cmd.exe splits an unquoted URL at the first '&' — the GitHub issue body was dropped");
  assert.match(block, /spawn\("powershell", \[[^\]]*"Start-Process -FilePath \(\[string\]\$env:BAGIDEA_OPEN_URL\)"\]/);
  assert.match(block, /env: \{ \.\.\.process\.env, BAGIDEA_OPEN_URL: p \}/, "the URL travels in the environment, untouched by any quoting rule");
  // the reports dir is office state; the log stays where the shell writes it
  assert.match(SERVER, /prepareReport\(JSON\.parse\(body \|\| "\{\}"\), \{ reg, daemonDir: STATE_DIR, logDir: __dirname, version: APP_VERSION \}\)/);
});

test("report: the daemon.log tail drops broadcast lines that carry conversation text", () => {
  const lines = [
    "[oep] http+ws listening :8787",
    '[oep] → {"type":"chat.message","agent":"shiba","text":"the owner said something private"}',
    '[oep] → {"type":"voice.say","agent":"poppy","text":"spoken aloud"}',
    '[oep] → {"type":"task.progress","agent":"main","tool":"Read"}',
    '[oep] → {"type":"subagent.spawned","sub":"x","text":"private task"}',
    '[oep] → {"type":"plugin.event","plugin":"agent-pulse"}',
    '[oep] → {"type":"task.started","agent":"main","title":"✨ copilot"}',
    "[copilot] persona · lmstudio/served-7b · ok · 812 ms",
    "[localslots] main/t9 queued on lmstudio (1/1 running, #1 in line)",
  ];
  const out = report.dropChatLines(lines, 60);
  assert.ok(!out.some((l) => /private|spoken aloud|chat\.message|voice\.say|task\.progress|subagent\./.test(l)), out.join("\n"));
  assert.ok(out.includes("[oep] http+ws listening :8787"));
  assert.ok(out.includes('[oep] → {"type":"plugin.event","plugin":"agent-pulse"}'), "daemon-level broadcasts stay");
  assert.ok(out.includes("[copilot] persona · lmstudio/served-7b · ok · 812 ms"));
  assert.strictEqual(out[out.length - 1], "(… 4 chat / voice broadcast lines left out of this tail — they carry conversation text)");
  // keep = the last N of what survives, so a chatty log still yields a useful tail
  const many = Array.from({ length: 200 }, (_, i) => (i % 2 ? '[oep] → {"type":"chat.message","text":"x"}' : "[oep] line " + i));
  const kept = report.dropChatLines(many, 10);
  assert.strictEqual(kept.length, 11);
  assert.strictEqual(kept[0], "[oep] line 180");
  assert.deepStrictEqual(report.dropChatLines([], 10), [], "nothing in, nothing out — no note either");
  assert.deepStrictEqual(report.dropChatLines(["a"], 10), ["a"]);
});
