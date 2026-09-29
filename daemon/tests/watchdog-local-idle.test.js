// The run watchdog's idle window must outlast the proxy's upstream cap for a LOCAL
// brain (stream=false upstream → the CLI is silent for the whole request), and a
// finished tool result counts as progress. Remote brains keep the base window.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Never write into the live proxy.log.
process.env.BAGIDEA_PROXY_LOG = path.join(os.tmpdir(), "watchdog-local-idle-proxy.log");
const proxy = require("../proxy");
const { RunWatchdog, runIdleMsFor } = require("../watchdog");

const BASE = 300000;
const idleFor = (provider, reg, env = {}, base = BASE) => {
  const up = proxy.upstreamFor(provider, reg);
  if (!up || !up.local) return base;
  return runIdleMsFor({ baseIdleMs: base, proxyTimeoutMs: proxy.upstreamTimeoutMs(provider, reg, up.local, env) });
};

test("runIdleMsFor: base only", () => {
  assert.strictEqual(runIdleMsFor({ baseIdleMs: BASE }), BASE);
});

test("runIdleMsFor: local cap 540000 → 600000", () => {
  assert.strictEqual(runIdleMsFor({ baseIdleMs: BASE, proxyTimeoutMs: 540000 }), 600000);
});

test("runIdleMsFor: cap smaller than base → base", () => {
  assert.strictEqual(runIdleMsFor({ baseIdleMs: BASE, proxyTimeoutMs: 120000 }), BASE);
});

test("runIdleMsFor: 0 / negative / NaN / undefined / non-numeric cap → base", () => {
  for (const cap of [0, -5, NaN, undefined, null, Infinity, "abc"])
    assert.strictEqual(runIdleMsFor({ baseIdleMs: BASE, proxyTimeoutMs: cap }), BASE, String(cap));
  assert.strictEqual(runIdleMsFor(), 0, "no args does not throw");
});

test("runIdleMsFor: env-style base override is respected", () => {
  const base = Number("900000") || BASE;   // mirrors OFFICE_RUN_IDLE_MS parsing in server.js
  assert.strictEqual(runIdleMsFor({ baseIdleMs: base, proxyTimeoutMs: 540000 }), 900000);
  assert.strictEqual(runIdleMsFor({ baseIdleMs: 60000, proxyTimeoutMs: 540000 }), 600000);
});

test("with proxy: lmstudio default reg → 600000", () => {
  assert.strictEqual(idleFor("lmstudio", {}), 600000);
  assert.strictEqual(idleFor("lmstudio", { providerConfig: {} }), 600000);
});

test("with proxy: remote openrouter → 300000", () => {
  assert.strictEqual(idleFor("openrouter", { providerConfig: { openrouter: { token: "x" } } }), BASE);
});

test("with proxy: lmstudio timeoutMs=120000 → 300000", () => {
  assert.strictEqual(idleFor("lmstudio", { providerConfig: { lmstudio: { timeoutMs: 120000 } } }), BASE);
});

test("with proxy: custom provider on localhost counts as local", () => {
  const reg = { providerConfig: { mybox: { baseUrl: "http://localhost:8080/v1" } } };
  assert.strictEqual(idleFor("mybox", reg), 600000);
});

test("RunWatchdog with helper-derived idle survives a gap > base, fires after enlarged window", async () => {
  const base = 40, idleMs = runIdleMsFor({ baseIdleMs: base, proxyTimeoutMs: 100, marginMs: 20 }); // 120
  assert.strictEqual(idleMs, 120);
  let killed = null;
  const wd = new RunWatchdog({ totalMs: 0, idleMs, onKill: (r) => { killed = r; } });
  wd.start();
  await new Promise((r) => setTimeout(r, 80));     // silent longer than base
  assert.strictEqual(killed, null, "not reaped after base window");
  await new Promise((r) => setTimeout(r, 120));    // total 200 ms > 120 ms
  assert.ok(killed && /idle 120ms/.test(killed), "reaped after enlarged window: " + killed);
  wd.clear();
});

// --- source-level guards on server.js ------------------------------------------
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").split("\r").join("");
const block = (from, to) => {
  const i = SERVER.indexOf(from);
  assert.ok(i > -1, "block not found: " + from.slice(0, 40));
  const j = SERVER.indexOf(to, i + from.length);
  return SERVER.slice(i, j > -1 ? j : i + 3000);
};

test("server: stdout handler touches the watchdog on a tool_result user event", () => {
  const h = block('child.stdout.on("data", (c) => {', 'm.type === "result"');
  assert.match(h, /m\.type === "user"[\s\S]{0,200}b\.type === "tool_result"\)\)\s*\{\s*watchdog\.touch\(\);/);
});

test("server: RunWatchdog is built with the computed idle window, not raw RUN_IDLE_MS", () => {
  const w = block("let runIdleMs = RUN_IDLE_MS;", "watchdog.start();");
  assert.match(w, /runIdleMsFor\(\{ baseIdleMs: RUN_IDLE_MS, proxyTimeoutMs: localCapMs \}\)/);
  // localCapMs is detected once above the spawn (shared with the local client env).
  assert.match(block("let localCapMs = 0;", "const child = spawnAgent("),
    /if \(up && up\.local\) localCapMs = proxy\.upstreamTimeoutMs\(effProvider, reg, up\.local, process\.env\)/);
  assert.match(w, /new RunWatchdog\(\{\s*totalMs: runTotalMs, idleMs: runIdleMs,/);
  assert.doesNotMatch(w, /idleMs: RUN_IDLE_MS/);
});
