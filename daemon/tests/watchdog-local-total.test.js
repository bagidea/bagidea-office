// SHINO D1 (2026-09-27): a run whose brain sits behind the local proxy gets a
// 60-min total cap; remote/direct brains keep the 30-min RUN_TOTAL_MS.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { RunWatchdog, runTotalMsFor } = require("../watchdog");

const MIN = 60000;

test("D1 T-B1: runTotalMsFor — local 60 min, remote base, bad inputs fall back to base", () => {
  assert.strictEqual(runTotalMsFor({ baseTotalMs: 30 * MIN, local: false, localTotalMs: 60 * MIN }), 30 * MIN);
  assert.strictEqual(runTotalMsFor({ baseTotalMs: 30 * MIN, local: true, localTotalMs: 60 * MIN }), 60 * MIN);
  // A local cap below the base never shortens the run.
  assert.strictEqual(runTotalMsFor({ baseTotalMs: 30 * MIN, local: true, localTotalMs: 10 * MIN }), 30 * MIN);
  for (const bad of [0, NaN, undefined, -1, "x", null, Infinity])
    assert.strictEqual(runTotalMsFor({ baseTotalMs: 30 * MIN, local: true, localTotalMs: bad }), 30 * MIN, String(bad));
  assert.strictEqual(runTotalMsFor(), 0);
});

test("D1 T-B1b: a watchdog built from the helper fires at the base cap for remote, the local cap for local", async () => {
  const BASE = 40, LOCAL = 160;
  const fired = {};
  const t0 = Date.now();
  const mk = (name, local) => new RunWatchdog({
    totalMs: runTotalMsFor({ baseTotalMs: BASE, local, localTotalMs: LOCAL }), idleMs: 0,
    onKill: (reason) => { fired[name] = { at: Date.now() - t0, reason }; },
  });
  const remote = mk("remote", false), local = mk("local", true);
  remote.start(); local.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(fired.remote, "remote run must be reaped at its 40 ms base cap");
  assert.match(fired.remote.reason, /total 40ms cap exceeded/);
  assert.ok(!fired.local, "local run must NOT be reaped at the base cap");
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(fired.local, "local run must be reaped at its own cap");
  assert.match(fired.local.reason, /total 160ms cap exceeded/);
  assert.ok(fired.local.at >= LOCAL - 5, `local fired too early (${fired.local.at} ms)`);
  remote.clear(); local.clear();
});

test("D1 T-B2: server.js passes the helper result as totalMs; LOCAL_RUN_TOTAL_MS defaults to 60 min", () => {
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(SERVER, /const LOCAL_RUN_TOTAL_MS = Number\(process\.env\.OFFICE_LOCAL_RUN_TOTAL_MS\) \|\| 60 \* 60000;/);
  assert.match(SERVER, /const runTotalMs = runTotalMsFor\(\{ baseTotalMs: RUN_TOTAL_MS, local: !!localCapMs, localTotalMs: LOCAL_RUN_TOTAL_MS \}\);/);
  assert.match(SERVER, /new RunWatchdog\(\{\s*totalMs: runTotalMs,/);
  assert.doesNotMatch(SERVER, /new RunWatchdog\(\{\s*totalMs: RUN_TOTAL_MS/);
  assert.match(SERVER, /\[claude\] watchdog idle=\$\{[^}]+\}s total=\$\{Math\.round\(runTotalMs \/ 1000\)\}s \(local provider/);
});
