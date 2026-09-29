// Card wmuilco6q4: LM Studio turns were aborted by the proxy's flat 120 s cap
// (body.stream=false → headers only arrive when the whole completion is done).
// These tests pin: local providers get a longer cap (540 s default, env/registry
// overridable), remote providers keep 120 s, and a proxy-side timeout is reported
// as "upstream timed out after Ns" while a client drop stays silent.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { EventEmitter } = require("events");

// Redirect plog BEFORE requiring the proxy so tests never touch the live proxy.log.
const LOG = path.join(os.tmpdir(), `proxy-timeout-local-test-${process.pid}.log`);
process.env.BAGIDEA_PROXY_LOG = LOG;
// Do not let a developer's shell env leak into handle() cases.
delete process.env.BAGIDEA_PROXY_LOCAL_TIMEOUT_MS;
const { upstreamTimeoutMs, upstreamFor, handle } = require("../proxy");

const readLog = () => { try { return fs.readFileSync(LOG, "utf8"); } catch { return ""; } };
test.after(() => { try { fs.unlinkSync(LOG); } catch {} });

// Resolve via upstreamFor exactly like handle() does.
const tmo = (provider, reg = {}, env = {}) =>
  upstreamTimeoutMs(provider, reg, upstreamFor(provider, reg).local, env);

// --- helper -------------------------------------------------------------------
test("defaults: lmstudio & ollama 540000 (local), openai & openrouter 120000", () => {
  assert.strictEqual(upstreamFor("lmstudio", {}).local, true);
  assert.strictEqual(upstreamFor("ollama", {}).local, true);
  assert.strictEqual(upstreamFor("openai", {}).local, false);
  assert.strictEqual(tmo("lmstudio"), 540000);
  assert.strictEqual(tmo("ollama"), 540000);
  assert.strictEqual(tmo("openai"), 120000);
  assert.strictEqual(tmo("openrouter"), 120000);
});

test("custom provider: local baseUrl → local; https remote → 120000", () => {
  for (const base of ["http://127.0.0.1:9999/v1", "http://localhost:9999/v1", "http://[::1]:9999/v1"]) {
    const reg = { providerConfig: { mylocal: { baseUrl: base } } };
    assert.strictEqual(upstreamFor("mylocal", reg).local, true, base);
    assert.strictEqual(tmo("mylocal", reg), 540000, base);
  }
  const remote = { providerConfig: { myremote: { baseUrl: "https://api.example.com/v1", token: "k" } } };
  assert.strictEqual(upstreamFor("myremote", remote).local, false);
  assert.strictEqual(tmo("myremote", remote), 120000);
  // Look-alike host is not local.
  const sneaky = { providerConfig: { x: { baseUrl: "https://127.0.0.1.example.com/v1" } } };
  assert.strictEqual(upstreamFor("x", sneaky).local, false);
});

test("registry timeoutMs override wins for local and remote (floored)", () => {
  assert.strictEqual(tmo("lmstudio", { providerConfig: { lmstudio: { timeoutMs: 900000 } } }), 900000);
  assert.strictEqual(tmo("openai", { providerConfig: { openai: { timeoutMs: 30000 } } }), 30000);
  assert.strictEqual(tmo("openai", { providerConfig: { openai: { timeoutMs: "45000.7" } } }), 45000);
  // Registry beats env for a local provider.
  assert.strictEqual(tmo("lmstudio", { providerConfig: { lmstudio: { timeoutMs: 1000 } } },
    { BAGIDEA_PROXY_LOCAL_TIMEOUT_MS: "300000" }), 1000);
});

test("env BAGIDEA_PROXY_LOCAL_TIMEOUT_MS applies to local only", () => {
  const env = { BAGIDEA_PROXY_LOCAL_TIMEOUT_MS: "300000" };
  assert.strictEqual(tmo("lmstudio", {}, env), 300000);
  assert.strictEqual(tmo("ollama", {}, env), 300000);
  assert.strictEqual(tmo("openai", {}, env), 120000);
  assert.strictEqual(tmo("myremote", { providerConfig: { myremote: { baseUrl: "https://a.b/v1" } } }, env), 120000);
});

test("bad values (0, -5, \"abc\", null, NaN, Infinity) fall back to the default", () => {
  for (const bad of [0, -5, "abc", null, NaN, Infinity, ""]) {
    assert.strictEqual(tmo("lmstudio", { providerConfig: { lmstudio: { timeoutMs: bad } } }), 540000, `reg ${bad}`);
    assert.strictEqual(tmo("openai", { providerConfig: { openai: { timeoutMs: bad } } }), 120000, `reg ${bad}`);
    assert.strictEqual(tmo("lmstudio", {}, { BAGIDEA_PROXY_LOCAL_TIMEOUT_MS: bad }), 540000, `env ${bad}`);
  }
  // Missing reg / env objects are tolerated.
  assert.strictEqual(upstreamTimeoutMs("lmstudio", undefined, true, undefined), 540000);
  assert.strictEqual(upstreamTimeoutMs("openai", null, false, null), 120000);
});

// --- handle() end-to-end with a fake slow upstream ---------------------------
const OK_BODY = { id: "x", choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }] };

function slowServer(delayMs) {
  const timers = new Set();
  return new Promise((r) => {
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const t = setTimeout(() => {
          timers.delete(t);
          if (res.destroyed) return;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(OK_BODY));
        }, delayMs);
        timers.add(t);
      });
    });
    srv.stopAll = () => new Promise((done) => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (srv.closeAllConnections) srv.closeAllConnections();
      srv.close(() => done());
    });
    srv.listen(0, "127.0.0.1", () => r(srv));
  });
}

function fakeRes() {
  const ee = new EventEmitter();
  const out = { status: 0, chunks: [], ended: false };
  const res = { out, writableEnded: false,
    on(ev, fn) { ee.on(ev, fn); return res; },
    emit(ev) { return ee.emit(ev); },
    writeHead(s) { out.status = s; }, write(c) { out.chunks.push(String(c)); },
    end(c) { if (c) out.chunks.push(String(c)); out.ended = true; res.writableEnded = true; } };
  return res;
}

const RAW = JSON.stringify({ model: "local-test", stream: false, max_tokens: 100,
  messages: [{ role: "user", content: "hello" }] });
const regFor = (srv, timeoutMs) =>
  ({ providerConfig: { lmstudio: { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, timeoutMs } } });

test("handle(): upstream slower than the cap → 502 'timed out after' + ERR log line", async () => {
  const srv = await slowServer(1000);
  try {
    const res = fakeRes();
    const before = readLog().length;
    const t0 = Date.now();
    await handle({}, res, "lmstudio", regFor(srv, 300), RAW);
    const took = Date.now() - t0;
    assert.strictEqual(res.out.status, 502);
    assert.ok(res.out.ended);
    const body = JSON.parse(res.out.chunks.join(""));
    assert.strictEqual(body.type, "error");
    assert.match(body.error.message, /timed out after/);
    assert.ok(took < 900, `should abort near 300 ms, took ${took} ms`);
    const log = readLog().slice(before);
    assert.match(log, /lmstudio model=local-test .* timeout=0.3s/);
    assert.match(log, /ERR 502 api_error: upstream timed out after 0.3s \(proxy cap; provider=lmstudio\)/);
    assert.ok(!/This operation was aborted/.test(log), "old generic abort text must not appear");
  } finally { await srv.stopAll(); }
});

test("handle(): upstream within the cap → 200 normal reply, request log shows timeout", async () => {
  const srv = await slowServer(50);
  try {
    const res = fakeRes();
    const before = readLog().length;
    await handle({}, res, "lmstudio", regFor(srv, 2000), RAW);
    assert.strictEqual(res.out.status, 200);
    const msg = JSON.parse(res.out.chunks.join(""));
    assert.deepStrictEqual(msg.content, [{ type: "text", text: "hi there" }]);
    const log = readLog().slice(before);
    assert.match(log, /timeout=2s/);
    assert.match(log, /ok status=200/);
    assert.ok(!/ERR /.test(log));
  } finally { await srv.stopAll(); }
});

test("handle(): client drop (res 'close' before end) → silent, no ERR written", async () => {
  const srv = await slowServer(1000);
  try {
    const res = fakeRes();
    const before = readLog().length;
    const p = handle({}, res, "lmstudio", regFor(srv, 5000), RAW);
    setTimeout(() => res.emit("close"), 100);
    const t0 = Date.now();
    await p;
    assert.ok(Date.now() - t0 < 900, "client drop must abort promptly");
    assert.strictEqual(res.out.status, 0, "nothing written to a dropped client");
    assert.strictEqual(res.out.ended, false);
    const log = readLog().slice(before);
    assert.match(log, /timeout=5s/);
    assert.ok(!/ERR /.test(log), "client drop must not log an ERR: " + log);
  } finally { await srv.stopAll(); }
});
