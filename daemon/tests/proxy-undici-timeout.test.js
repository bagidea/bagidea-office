// Card wmuiolbpv8: a 540 s local cap still died at ~300 s. Node's global fetch
// (bundled undici) has headersTimeout = bodyTimeout = 300 s, and with
// body.stream=false LM Studio sends no headers until it is done → undici throws
// "fetch failed" (cause UND_ERR_HEADERS_TIMEOUT) before our AbortController fires.
// These tests use a scaled model: a short-timeout global dispatcher stands in for
// the 300 s default so nothing has to wait five minutes.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { EventEmitter } = require("events");

// Redirect plog BEFORE requiring the proxy so tests never touch the live proxy.log.
const LOG = path.join(os.tmpdir(), `proxy-undici-timeout-test-${process.pid}.log`);
process.env.BAGIDEA_PROXY_LOG = LOG;
delete process.env.BAGIDEA_PROXY_LOCAL_TIMEOUT_MS;
const { fetchWithTimeout, upstreamDispatcher, handle } = require("../proxy");

const readLog = () => { try { return fs.readFileSync(LOG, "utf8"); } catch { return ""; } };

// Swap Node's global dispatcher for one with a 400 ms headers/body timeout.
const GD = Symbol.for("undici.globalDispatcher.1");
void globalThis.Response;
const realGlobal = globalThis[GD];
const Agent = realGlobal.constructor;
const SHORT = 400;
const shortGlobal = new Agent({ headersTimeout: SHORT, bodyTimeout: SHORT });
globalThis[GD] = shortGlobal;
test.after(async () => {
  globalThis[GD] = realGlobal;
  await shortGlobal.close().catch(() => {});
  try { fs.unlinkSync(LOG); } catch {}
});

const OK_BODY = { id: "x", choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }] };

// Sends NO headers until delayMs has passed (like LM Studio with stream=false).
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
const urlOf = (srv) => `http://127.0.0.1:${srv.address().port}/v1/chat/completions`;

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
const regFor = (port, timeoutMs) =>
  ({ providerConfig: { lmstudio: { baseUrl: `http://127.0.0.1:${port}/v1`, timeoutMs } } });

test("repro: plain global fetch dies at the dispatcher headersTimeout (UND_ERR_HEADERS_TIMEOUT)", async () => {
  const srv = await slowServer(1500);
  try {
    // Our own 5 s AbortController cap would allow it, but undici gives up first.
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const err = await fetch(urlOf(srv), { method: "POST", body: "{}", signal: ac.signal }).then(
      () => null, (e) => e);
    clearTimeout(t);
    assert.ok(err, "fetch should fail");
    assert.strictEqual(err.name, "TypeError");
    assert.strictEqual(err.message, "fetch failed");
    assert.strictEqual(err.cause && err.cause.code, "UND_ERR_HEADERS_TIMEOUT");
  } finally { await srv.stopAll(); }
});

test("fix: fetchWithTimeout outlives the dispatcher limit when timeoutMs is larger", async () => {
  const srv = await slowServer(1500);
  try {
    const r = await fetchWithTimeout(urlOf(srv), { method: "POST", body: "{}" }, 5000);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), OK_BODY);
  } finally { await srv.stopAll(); }
});

test("fix end-to-end: handle() returns 200 for a local reply slower than the dispatcher limit", async () => {
  const srv = await slowServer(1500);
  try {
    const res = fakeRes();
    const before = readLog().length;
    await handle({}, res, "lmstudio", regFor(srv.address().port, 5000), RAW);
    assert.strictEqual(res.out.status, 200, readLog().slice(before));
    assert.deepStrictEqual(JSON.parse(res.out.chunks.join("")).content, [{ type: "text", text: "hi there" }]);
    assert.ok(!/ERR /.test(readLog().slice(before)));
  } finally { await srv.stopAll(); }
});

test("our cap still fires first: 'upstream timed out after Ns', not 'fetch failed'", async () => {
  const srv = await slowServer(3000);
  try {
    const res = fakeRes();
    const before = readLog().length;
    const t0 = Date.now();
    await handle({}, res, "lmstudio", regFor(srv.address().port, 1500), RAW);
    const took = Date.now() - t0;
    assert.strictEqual(res.out.status, 502);
    const body = JSON.parse(res.out.chunks.join(""));
    assert.match(body.error.message, /^upstream timed out after 1\.5s \(proxy cap; provider=lmstudio\)$/);
    assert.ok(took >= 1400 && took < 2800, `should abort near 1500 ms, took ${took} ms`);
    const log = readLog().slice(before);
    assert.match(log, /ERR 502 api_error: upstream timed out after 1\.5s/);
    assert.ok(!/fetch failed/.test(log), "must not be undici's generic failure: " + log);
  } finally { await srv.stopAll(); }
});

test("fetch failure text carries cause.code (e.g. ECONNREFUSED)", async () => {
  // Grab a free port, then close it so the connect is refused.
  const srv = await slowServer(0);
  const port = srv.address().port;
  await srv.stopAll();
  const res = fakeRes();
  const before = readLog().length;
  await handle({}, res, "lmstudio", regFor(port, 5000), RAW);
  assert.strictEqual(res.out.status, 502);
  const body = JSON.parse(res.out.chunks.join(""));
  assert.match(body.error.message, /^upstream fetch failed: fetch failed \(cause: ECONNREFUSED\)$/);
  assert.match(readLog().slice(before), /ERR 502 api_error: upstream fetch failed: fetch failed \(cause: ECONNREFUSED\)/);
});

test("upstreamDispatcher: cached per timeout value, limits above timeoutMs, bad input → undefined", () => {
  const a = upstreamDispatcher(540000);
  assert.ok(a, "bundled undici Agent should be resolvable on this Node");
  assert.strictEqual(upstreamDispatcher(540000), a, "same timeout → same dispatcher");
  assert.notStrictEqual(upstreamDispatcher(120000), a, "different timeout → different dispatcher");
  assert.strictEqual(a.constructor, Agent, "same undici build as the global fetch");
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.strictEqual(upstreamDispatcher(bad), undefined, String(bad));
});
