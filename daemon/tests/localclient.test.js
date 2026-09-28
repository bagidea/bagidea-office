// T1-a / T2-a (REPORT-jojo-r9-300s-memleak-0313): a LOCAL brain's CLI spawn gets its
// three client limits (API_TIMEOUT_MS, first-byte, stream-idle) plus the Bun runtime's
// HTTP-client idle timeout (seconds; the ~360 s T1-c cut) just above the proxy cap, and
// auto-memory off. Remote / Claude brains (cap 0) keep the env untouched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");

// Redirect plog BEFORE requiring the proxy so tests never touch the live proxy.log.
const LOG = path.join(os.tmpdir(), `localclient-test-${process.pid}.log`);
process.env.BAGIDEA_PROXY_LOG = LOG;
const { localClientEnv, CLIENT_MARGIN_MS } = require("../localclient");
const { runIdleMsFor } = require("../watchdog");
const { handle } = require("../proxy");
const readLog = () => { try { return fs.readFileSync(LOG, "utf8"); } catch { return ""; } };
test.after(() => { try { fs.unlinkSync(LOG); } catch {} });

const LIMITS = ["API_TIMEOUT_MS", "CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS", "CLAUDE_STREAM_IDLE_TIMEOUT_MS"];
const BASE = () => ({ PATH: "C:\\bin", OFFICE_ADAPTER: "1", OFFICE_AGENT: "nova", OFFICE_TASK: "t1" });

test("cap 540000 → all three client limits \"570000\" and auto-memory off", () => {
  assert.strictEqual(CLIENT_MARGIN_MS, 30000);
  const out = localClientEnv(BASE(), 540000);
  for (const k of LIMITS) assert.strictEqual(out[k], "570000", k);
  assert.strictEqual(out.BUN_CONFIG_HTTP_IDLE_TIMEOUT, "570", "Bun idle timeout is in seconds");
  assert.strictEqual(out.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.strictEqual(out.OFFICE_AGENT, "nova", "other keys carried over");
});

test("Bun idle timeout: seconds rounded up, a larger existing value kept, smaller/junk raised", () => {
  assert.strictEqual(localClientEnv(BASE(), 540500).BUN_CONFIG_HTTP_IDLE_TIMEOUT, "571");
  assert.strictEqual(localClientEnv({ ...BASE(), BUN_CONFIG_HTTP_IDLE_TIMEOUT: "900" }, 540000).BUN_CONFIG_HTTP_IDLE_TIMEOUT, "900");
  for (const v of ["300", "0", "-5", "abc", ""])
    assert.strictEqual(localClientEnv({ ...BASE(), BUN_CONFIG_HTTP_IDLE_TIMEOUT: v }, 540000).BUN_CONFIG_HTTP_IDLE_TIMEOUT, "570", v);
  // Above every proxy cap it serves, like the three ms limits.
  for (const cap of [120000, 540000, 900000])
    assert.ok(Number(localClientEnv(BASE(), cap).BUN_CONFIG_HTTP_IDLE_TIMEOUT) * 1000 > cap, String(cap));
});

test("a larger existing limit (API_TIMEOUT_MS=900000) is kept; smaller ones are raised", () => {
  const out = localClientEnv({ ...BASE(), API_TIMEOUT_MS: "900000", CLAUDE_STREAM_IDLE_TIMEOUT_MS: "1000" }, 540000);
  assert.strictEqual(out.API_TIMEOUT_MS, "900000");
  assert.strictEqual(out.CLAUDE_STREAM_IDLE_TIMEOUT_MS, "570000");
  assert.strictEqual(out.CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS, "570000");
});

test("cap 0 / NaN / negative / non-number → the same env object, no flag", () => {
  for (const cap of [0, NaN, -1, -540000, undefined, null, "abc", Infinity]) {
    const env = BASE();
    const out = localClientEnv(env, cap);
    assert.strictEqual(out, env, String(cap));
    assert.ok(!("CLAUDE_CODE_DISABLE_AUTO_MEMORY" in out), String(cap));
    assert.ok(!("BUN_CONFIG_HTTP_IDLE_TIMEOUT" in out), String(cap));
    for (const k of LIMITS) assert.ok(!(k in out), `${k} for cap ${cap}`);
  }
});

test("the input env is not mutated", () => {
  const env = { ...BASE(), API_TIMEOUT_MS: "1000" };
  const before = JSON.stringify(env);
  const out = localClientEnv(env, 540000);
  assert.notStrictEqual(out, env);
  assert.strictEqual(JSON.stringify(env), before);
});

test("order: proxy cap < CLI client limit < daemon watchdog idle (runIdleMsFor)", () => {
  for (const cap of [540000, 120000, 900000]) {
    const cli = Number(localClientEnv(BASE(), cap).API_TIMEOUT_MS);
    const idle = runIdleMsFor({ baseIdleMs: 120000, proxyTimeoutMs: cap });
    assert.ok(cap < cli, `cap ${cap} < cli ${cli}`);
    assert.ok(cli < idle, `cli ${cli} < watchdog idle ${idle}`);
  }
});

test("server.js applies localClientEnv only inside the local-proxy branch", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /const localclient = require\("\.\/localclient"\);/);
  const calls = src.split("localclient.localClientEnv(").length - 1;
  assert.strictEqual(calls, 1, "exactly one call site");
  // localCapMs is set only when the route points at /proxy/<provider> and the upstream is local.
  const m = src.match(/let localCapMs = 0;[\s\S]*?\} catch \(e\) \{ localCapMs = 0; \}\s*let childEnv = [^\n]*\n\s*if \(localCapMs\) \{\s*childEnv = localclient\.localClientEnv\(childEnv, localCapMs\);/);
  assert.ok(m, "localClientEnv must sit under if (localCapMs) right after the local-proxy detection");
  assert.match(m[0], /effProvider !== "claude" && route\.ok &&/);
  assert.match(m[0], /includes\("\/proxy\/" \+ effProvider\)/);
  assert.match(m[0], /if \(up && up\.local\) localCapMs = proxy\.upstreamTimeoutMs\(/);
  assert.match(src, /env: childEnv,/);
  assert.match(src, /BUN_CONFIG_HTTP_IDLE_TIMEOUT=\$\{childEnv\.BUN_CONFIG_HTTP_IDLE_TIMEOUT\}s/, "spawn log shows the Bun idle timeout");
  assert.match(src, /runIdleMsFor\(\{ baseIdleMs: RUN_IDLE_MS, proxyTimeoutMs: localCapMs \}\)/);
});

// proxy.js: a client that drops before the reply is logged (run 9 left no line at all).
test("proxy: client drop before the reply → one CLIENT-ABORT log line, no ERR", async () => {
  const timers = new Set();
  const srv = await new Promise((r) => {
    const s = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => { const t = setTimeout(() => { if (!res.destroyed) res.end("{}"); }, 1000); timers.add(t); });
    });
    s.listen(0, "127.0.0.1", () => r(s));
  });
  try {
    const ee = new EventEmitter();
    const res = { writableEnded: false, on(ev, fn) { ee.on(ev, fn); return res; },
      writeHead() {}, write() {}, end() { res.writableEnded = true; } };
    const before = readLog().length;
    const reg = { providerConfig: { lmstudio: { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, timeoutMs: 5000 } } };
    const p = handle({}, res, "lmstudio", reg, JSON.stringify({ model: "local-test", max_tokens: 10,
      messages: [{ role: "user", content: "hi" }] }));
    setTimeout(() => ee.emit("close"), 100);
    await p;
    const log = readLog().slice(before);
    assert.strictEqual((log.match(/CLIENT-ABORT after \d+s \(client closed before reply\)/g) || []).length, 1, log);
    assert.ok(!/ERR /.test(log), log);
  } finally {
    for (const t of timers) clearTimeout(t);
    if (srv.closeAllConnections) srv.closeAllConnections();
    await new Promise((d) => srv.close(d));
  }
});
