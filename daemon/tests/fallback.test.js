// 🛟 Office fallback brain ("สมองสำรอง"): the pure decision (pickFallback), the
// local-server probe behind GET /registry/local-status, the /registry/fallback
// input checks, and an end-to-end pass over the real routes on an ISOLATED copy
// of the daemon (its own temp dir + stub registry — never the office's registry).
const test = require("node:test");
const assert = require("node:assert");
const fb = require("../fallback");

// A catalog shaped like providers.PROVIDERS.
const PROVIDERS = {
  claude: { format: "anthropic" }, glm: { format: "anthropic" },
  openai: { format: "openai" }, gemini: { format: "openai" }, openrouter: { format: "openai" },
  ollama: { format: "openai", local: true }, lmstudio: { format: "openai", local: true },
};
const reg = (fallbackProvider, providerConfig = {}, extra = {}) =>
  ({ fallbackProvider, fallbackModel: "m-1", providerConfig, apiKeys: {}, ...extra });

// ==== pickFallback ==========================================================
test("pickFallback: unset / none → null (feature off)", () => {
  assert.strictEqual(fb.pickFallback({}, "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg(""), "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("none"), "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(null, "claude", PROVIDERS), null);
});

test("pickFallback: never falls back onto the provider the run is already on", () => {
  assert.strictEqual(fb.pickFallback(reg("openai", { openai: { token: "k" } }), "openai", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("lmstudio"), "lmstudio", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("claude"), "claude", PROVIDERS), null);
  // an agent with no provider runs on Claude → Claude is the same brain
  assert.strictEqual(fb.pickFallback(reg("claude"), undefined, PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("claude"), "", PROVIDERS), null);
});

test("pickFallback: Claude needs no provider config", () => {
  assert.deepStrictEqual(fb.pickFallback(reg("claude"), "lmstudio", PROVIDERS), { provider: "claude", model: "m-1" });
});

test("pickFallback: cloud needs a credential (token / baseUrl / main key)", () => {
  assert.deepStrictEqual(fb.pickFallback(reg("openrouter", { openrouter: { token: "k", connected: true } }), "claude", PROVIDERS),
    { provider: "openrouter", model: "m-1" });
  assert.strictEqual(fb.pickFallback(reg("openrouter", { openrouter: { connected: true } }), "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("openrouter"), "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("glm", { glm: { token: "" } }), "claude", PROVIDERS), null);
  // openai / gemini also run on the office MAIN key (same as providers.resolve)
  assert.deepStrictEqual(fb.pickFallback(reg("gemini", { gemini: { connected: true } }, { apiKeys: { GEMINI_API_KEY: "g" } }), "claude", PROVIDERS),
    { provider: "gemini", model: "m-1" });
  assert.strictEqual(fb.pickFallback(reg("openrouter", {}, { apiKeys: { OPENAI_API_KEY: "o" } }), "claude", PROVIDERS), null);
});

test("pickFallback: local brains (lmstudio / ollama) need no token", () => {
  for (const id of ["lmstudio", "ollama"]) {
    assert.deepStrictEqual(fb.pickFallback(reg(id), "claude", PROVIDERS), { provider: id, model: "m-1" }, id + " without config");
    assert.deepStrictEqual(fb.pickFallback(reg(id, { [id]: { connected: true, models: ["a"] } }), "gemini", PROVIDERS),
      { provider: id, model: "m-1" }, id + " connected, no token");
  }
  // any provider the catalog marks local:true counts too
  assert.deepStrictEqual(fb.pickFallback(reg("llamacpp"), "claude", { ...PROVIDERS, llamacpp: { local: true } }),
    { provider: "llamacpp", model: "m-1" });
  assert.strictEqual(fb.pickFallback(reg("llamacpp"), "claude", PROVIDERS), null, "unknown non-local id without config");
});

test("pickFallback: custom baseUrl (custom provider or a local server on another port)", () => {
  assert.deepStrictEqual(fb.pickFallback(reg("cp-box", { "cp-box": { kind: "openai", baseUrl: "http://10.0.0.5:9000/v1", label: "Box" } }), "claude", PROVIDERS),
    { provider: "cp-box", model: "m-1" });
  assert.deepStrictEqual(fb.pickFallback(reg("lmstudio", { lmstudio: { baseUrl: "http://127.0.0.1:4321/v1" } }), "claude", PROVIDERS),
    { provider: "lmstudio", model: "m-1" });
  assert.strictEqual(fb.pickFallback(reg("cp-box", { "cp-box": { kind: "openai", label: "Box" } }), "claude", PROVIDERS), null);
});

test("pickFallback: model defaults to '' and prototype keys are never providers", () => {
  assert.deepStrictEqual(fb.pickFallback({ fallbackProvider: "claude" }, "openai", PROVIDERS), { provider: "claude", model: "" });
  assert.strictEqual(fb.pickFallback(reg("constructor"), "claude", PROVIDERS), null);
  assert.strictEqual(fb.pickFallback(reg("__proto__"), "claude", PROVIDERS), null);
  assert.strictEqual(fb.isLocal("toString", PROVIDERS), false);
});

// ==== local-status probe ====================================================
// A fake fetch: url → { status, json } | "refused" | "hang" (never answers; honours abort).
function fakeFetch(routes, calls = []) {
  return (url, opts) => {
    calls.push(url);
    const r = routes[url];
    if (r === "hang" || r === undefined && routes["*"] === "hang") {
      return new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (!r || r === "refused") return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, body: null });
  };
}

test("localStatus: shape, default URLs, models from /v1/models", async () => {
  fb.resetLocalStatusCache();
  const f = fakeFetch({ "http://127.0.0.1:1234/v1/models": { status: 200, json: { data: [{ id: "qwen-7b" }, { id: "gemma-4b" }, { id: "qwen-7b" }] } } });
  const st = await fb.localStatus({ providerConfig: {} }, { fetch: f, fresh: true });
  assert.deepStrictEqual(Object.keys(st).sort(), ["lmstudio", "ollama"]);
  assert.deepStrictEqual(st.lmstudio, { running: true, models: ["qwen-7b", "gemma-4b"], error: null, url: "http://127.0.0.1:1234/v1" });
  assert.strictEqual(st.ollama.running, false);
  assert.deepStrictEqual(st.ollama.models, []);
  assert.strictEqual(st.ollama.url, "http://127.0.0.1:11434/v1");
  assert.strictEqual(st.ollama.error, "ECONNREFUSED");
});

test("localStatus: providerConfig[id].baseUrl wins; a token rides as Bearer; creds never echoed", async () => {
  fb.resetLocalStatusCache();
  const seen = {};
  const f = (url, opts) => { seen[url] = opts.headers.authorization || null;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [{ id: "served" }] }) }); };
  const st = await fb.localStatus({ providerConfig: {
    lmstudio: { baseUrl: "http://127.0.0.1:8011/v1/" , token: "vk" },
    ollama: { baseUrl: "http://u:p@127.0.0.1:11999/v1" } } }, { fetch: f, fresh: true });
  assert.strictEqual(st.lmstudio.url, "http://127.0.0.1:8011/v1");
  assert.strictEqual(seen["http://127.0.0.1:8011/v1/models"], "Bearer vk");
  assert.strictEqual(Object.entries(seen).find(([u]) => u.includes(":11999/"))[1], null, "no Authorization without a token");
  assert.ok(!/u:p@/.test(st.ollama.url), "user:pass stripped from the reported url");
});

test("localStatus: non-2xx = not running; a hung server times out (probes run in parallel)", async () => {
  fb.resetLocalStatusCache();
  const f = fakeFetch({ "http://127.0.0.1:1234/v1/models": { status: 401, json: {} },
    "http://127.0.0.1:11434/v1/models": "hang" });
  const t0 = Date.now();
  const st = await fb.localStatus({}, { fetch: f, fresh: true, timeoutMs: 150 });
  const took = Date.now() - t0;
  assert.deepStrictEqual([st.lmstudio.running, st.lmstudio.error], [false, "HTTP 401"]);
  assert.deepStrictEqual([st.ollama.running, st.ollama.error], [false, "timeout"]);
  assert.ok(took < 1000, "probes ran in parallel (" + took + " ms)");
  assert.strictEqual(fb.PROBE_MS, 1500);
  assert.strictEqual(fb.CACHE_MS, 3000);
});

test("localStatus: cached for 3 s and shared by concurrent callers; a new baseUrl re-probes", async () => {
  fb.resetLocalStatusCache();
  const calls = [];
  const f = fakeFetch({ "*": "refused" }, calls);
  const r = {};
  const [a, b] = await Promise.all([fb.localStatus(r, { fetch: f }), fb.localStatus(r, { fetch: f })]);
  assert.strictEqual(a, b);
  assert.strictEqual(calls.length, 2, "one probe per local server");
  await fb.localStatus(r, { fetch: f });
  assert.strictEqual(calls.length, 2, "second call inside 3 s is served from cache");
  await fb.localStatus({ providerConfig: { lmstudio: { baseUrl: "http://127.0.0.1:1300/v1" } } }, { fetch: f });
  assert.strictEqual(calls.length, 4, "changed baseUrl → fresh probe");
  fb.resetLocalStatusCache();
});

// ==== /registry/fallback input checks =======================================
test("validFallbackProvider: builtins, local ids, configured customs", () => {
  const r = { providerConfig: { "cp-box": { label: "Box" } } };
  for (const id of ["claude", "openai", "lmstudio", "ollama", "cp-box"])
    assert.strictEqual(fb.validFallbackProvider(id, r, PROVIDERS), true, id);
  for (const id of ["nope", "vllm", "cp-other", "constructor", "__proto__", "toString", "", "a b", "x;y", "../x"])
    assert.strictEqual(fb.validFallbackProvider(id, r, PROVIDERS), false, JSON.stringify(id));
});

test("cleanFallbackModel: real model ids pass intact, shell metacharacters are refused", () => {
  const ok = ["", "qwen3-8b-instruct@bf16", "openai/gpt-oss-20b:free", "~anthropic/claude-opus-latest",
    "accounts/fireworks/models/llama-v3p3-70b-instruct", "llama3.1:8b-instruct-q4_K_M", "sonnet[1m]",
    "example-org-local-model-27b-instruct-chatmodel-mtp-q4-k-m-with-a-long-name-v2"];   // 79 chars (LM Studio)
  for (const m of ok) assert.strictEqual(fb.cleanFallbackModel(m), m);
  assert.strictEqual(fb.cleanFallbackModel("  gpt-4.1  "), "gpt-4.1");
  assert.strictEqual(fb.cleanFallbackModel(undefined), "");
  for (const m of ["x & calc", "a;b", "$(id)", "`id`", "a|b", "a>b", "a\nb", 'a"b', "a'b", "%PATH%", "a b"])
    assert.throws(() => fb.cleanFallbackModel(m), /invalid model id/, JSON.stringify(m));
  assert.throws(() => fb.cleanFallbackModel("m".repeat(fb.MODEL_MAX + 1)), /too long/);
});

// ==== end-to-end over the real routes =======================================
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DAEMON_DIR = path.join(__dirname, "..");
const SKIP = /[\\/](registry\.json|sessions\.json|journal\.jsonl|tests|tooldetail|reports)$|\.log$|\.bak$/;

async function bootIsolated(t, stubReg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-fallback-"));
  fs.cpSync(DAEMON_DIR, path.join(tmp, "daemon"), { recursive: true, filter: (src) => !SKIP.test(src) });
  fs.mkdirSync(path.join(tmp, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "daemon", "registry.json"), JSON.stringify(stubReg));
  const port = 19121 + Math.floor(Math.random() * 8);   // developer B's range 19120-19129
  const child = spawn(process.execPath, [path.join(tmp, "daemon", "server.js")], {
    env: { ...process.env, OEP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  child.stdout.on("data", (c) => logs.push(c.toString()));
  child.stderr.on("data", (c) => logs.push(c.toString()));
  t.after(async () => {
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once("exit", r));
      try { child.kill("SIGTERM"); } catch {}
      await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });
  const base = "http://127.0.0.1:" + port;
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(base + "/health")).ok) break; } catch {}
    if (child.exitCode !== null || Date.now() - t0 > 30000) throw new Error("daemon did not boot: " + logs.join("").slice(-2000));
    await new Promise((r) => setTimeout(r, 250));
  }
  return base;
}

test("routes: GET /registry/local-status + POST /registry/fallback (owner-only, local ids, model check)", async (t) => {
  // A stand-in LM Studio on a free port, wired in through providerConfig.lmstudio.baseUrl.
  const lm = http.createServer((req, res) => {
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "qwen-test-7b" }, { id: "gemma-test-4b" }] })); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => lm.listen(0, "127.0.0.1", r));
  t.after(() => lm.close());
  const lmBase = "http://127.0.0.1:" + lm.address().port + "/v1";
  const base = await bootIsolated(t, {
    agents: { main: { name: "Main", role: "Director", prompt: "", provider: "claude" }, ceo: { name: "CEO", role: "Owner", prompt: "" } },
    apiKeys: {}, providerConfig: { lmstudio: { connected: true, baseUrl: lmBase } }, roles: ["Director"], skills: {},
    tools: [], mcpServers: {}, places: {}, triggers: [], heartbeatMin: 0, socialMin: 0, proposalMin: 0, autoPilot: false,
  });
  const post = (body, ui = true) => fetch(base + "/registry/fallback", { method: "POST",
    headers: { "content-type": "application/json", ...(ui ? { "x-bagidea-ui": "1" } : {}) }, body: JSON.stringify(body) });
  const getReg = () => fetch(base + "/registry").then((r) => r.json());

  // local-status: shape for both, the stub LM Studio is running with its models
  const st = await fetch(base + "/registry/local-status").then((r) => r.json());
  for (const id of ["ollama", "lmstudio"]) {
    assert.strictEqual(typeof st[id].running, "boolean", id);
    assert.ok(Array.isArray(st[id].models), id);
    assert.strictEqual(typeof st[id].url, "string", id);
  }
  assert.strictEqual(st.lmstudio.running, true);
  assert.deepStrictEqual(st.lmstudio.models, ["qwen-test-7b", "gemma-test-4b"]);
  assert.strictEqual(st.lmstudio.url, lmBase);
  assert.strictEqual(st.vllm, undefined);

  // no owner-UI header → 403, nothing stored
  let r = await post({ provider: "lmstudio", model: "qwen-test-7b" }, false);
  assert.strictEqual(r.status, 403);
  assert.ok(!(await getReg()).fallbackProvider);

  // owner UI + a local brain with no token → 200, and /registry shows it
  r = await post({ provider: "lmstudio", model: "qwen-test-7b" });
  assert.strictEqual(r.status, 200, await r.text());
  let g = await getReg();
  assert.strictEqual(g.fallbackProvider, "lmstudio");
  assert.strictEqual(g.fallbackModel, "qwen-test-7b");

  // a long local model id (over the old 60-char cut) is stored intact
  const longId = "example-org/some-local-model-27b-instruct-q4_k_m-with-a-very-long-descriptive-name";
  r = await post({ provider: "ollama", model: longId });
  assert.strictEqual(r.status, 200, await r.text());
  g = await getReg();
  assert.deepStrictEqual([g.fallbackProvider, g.fallbackModel], ["ollama", longId]);

  // unknown provider / shell metacharacters in the model → 400, previous choice kept
  for (const body of [{ provider: "constructor" }, { provider: "nope" }, { provider: "lmstudio", model: "x & calc" }]) {
    r = await post(body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
  }
  g = await getReg();
  assert.deepStrictEqual([g.fallbackProvider, g.fallbackModel], ["ollama", longId]);

  // "none" switches it off
  r = await post({ provider: "none", model: "ignored" });
  assert.strictEqual(r.status, 200);
  g = await getReg();
  assert.deepStrictEqual([g.fallbackProvider, g.fallbackModel], ["", ""]);
});
