// 🧠 Shino copilot core (daemon/copilot.js): brain resolution (reg.copilot override,
// Director fallback), the execution path per provider group, JSON extraction + the one
// retry, error mapping, task events and the settings logic — unit, with fakes — then an
// end-to-end pass over the real routes (GET/POST /copilot/settings, /assist/prompt,
// /workflows/draft, /workflows/analyze) on an ISOLATED copy of the daemon (its own temp
// dir + registry — never the office's) wired to a stub OpenAI-compatible server that is
// registered as provider "lmstudio". No real provider is ever called.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const copilot = require("../copilot");
const proxy = require("../proxy");

// ==== fakes ==================================================================
const baseReg = (extra = {}) => ({
  agents: {
    main: { name: "Shino", role: "Director", provider: "claude", model: "claude-fable-5-1",
      persona: { language: "Thai, English on technical words", rules: "1. delegate to leads\n2. keep the team calm" } },
    ceo: { name: "CEO", role: "Owner" },
    nina: { name: "Nina", role: "Designer", provider: "lmstudio", model: "qwen-x" },
  },
  providerConfig: {
    lmstudio: { connected: true, models: ["qwen-x"] },
    openrouter: { token: "sk-or-secret-1234567890", connected: true },
    glm: { token: "glm-secret-abcdef" },
    cpo: { kind: "openai", baseUrl: "http://127.0.0.1:9/v1", token: "cp-tok-123456", label: "My Stub" },
    cpa: { kind: "anthropic", baseUrl: "https://example.test/anthropic", token: "cpa-tok-123456", label: "My Anthropic" },
    nokind: { baseUrl: "http://127.0.0.1:9" },
    litellm: { baseUrl: "http://127.0.0.1:4000" },
  },
  apiKeys: {},
  skills: {
    "lesson-x": { name: "lesson", description: "a learned lesson", auto: true },
    "deep-research": { name: "Deep Research", description: "Methodical web research that ends in a sourced, decision-ready brief." },
  },
  mcpServers: { web: {} },
  ...extra,
});
const resp = (status, text) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const chat = (content, finish = "stop") => ({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }] });

function rig(o = {}) {
  const reg = o.reg || baseReg();
  const events = [], cli = [], calls = [], logs = [];
  let saves = 0;
  const replies = (o.replies || []).slice();
  const cliReplies = (o.cli || []).slice();
  const fetchImpl = o.fetchImpl || (async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const next = replies.length ? replies.shift() : { json: chat("plain answer") };
    if (typeof next === "function") return next(url, init, body);
    return resp(next.status || 200, next.json !== undefined ? JSON.stringify(next.json) : String(next.text || ""));
  });
  const inst = copilot.create({
    getReg: () => reg, saveReg: () => { saves++; },
    claudeText: o.claudeText || (async (prompt, opts) => { cli.push({ prompt, opts }); return cliReplies.length ? cliReplies.shift() : "plain cli answer"; }),
    broadcast: (e, journal) => events.push({ e, journal }),
    upstreamFor: proxy.upstreamFor, fetchImpl,
    localStatus: async () => o.live || { lmstudio: { running: true, models: ["mudler/x/mmproj.gguf", "served-7b"] }, ollama: { running: false, models: [] } },
    log: (s) => logs.push(s),
  });
  return { inst, reg, events, cli, calls, logs, saves: () => saves };
}

// ==== brain ==================================================================
test("brain: follows the Director until reg.copilot picks a brain", () => {
  const { inst, reg } = rig();
  assert.deepStrictEqual(inst.brain(), { provider: "claude", model: "claude-fable-5-1", label: "Claude · Anthropic", source: "director", directorName: "Shino", local: false });
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  assert.deepStrictEqual(inst.brain(), { provider: "lmstudio", model: "served-7b", label: "LM Studio · local", source: "copilot", directorName: "Shino", local: true });
  for (const p of ["", "director", "  "]) {
    reg.copilot = { provider: p, model: "ignored" };
    const b = inst.brain();
    assert.deepStrictEqual([b.provider, b.model, b.source], ["claude", "claude-fable-5-1", "director"], JSON.stringify(p));
  }
  reg.copilot = "garbage";
  assert.strictEqual(inst.brain().source, "director");
  // a Director with no provider runs on the office default (else Claude); an explicit reg wins
  assert.strictEqual(inst.brain({ agents: { main: { name: "Kai" } }, defaultProvider: "glm" }).provider, "glm");
  const b = inst.brain({ agents: {} });
  assert.deepStrictEqual([b.provider, b.model, b.directorName], ["claude", "", "Director"]);
  // custom providers are labelled by their own label
  assert.strictEqual(inst.brain({ ...reg, copilot: { provider: "cpo", model: "m" } }).label, "My Stub · custom");
});

// ==== execution paths =========================================================
test("run: claude + Anthropic-compatible providers go through claudeText with the Shino system text", async () => {
  const { inst, cli, calls } = rig({ cli: ["done 1", "done 2", "done 3"] });
  let r = await inst.run({ job: "persona", prompt: "USER-PROMPT-1" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(r.text, "done 1");
  assert.deepStrictEqual(r.brain, { provider: "claude", model: "claude-fable-5-1", label: "Claude · Anthropic", source: "director" });
  assert.deepStrictEqual(cli[0].opts, { provider: "claude", model: "claude-fable-5-1" });
  assert.match(cli[0].prompt, /^You are Shino, the Director of this BagIdea office, acting as the owner's copilot for designing a new teammate's persona/);
  assert.match(cli[0].prompt, /Thai, English on technical words/, "the Director's language rides along");
  assert.match(cli[0].prompt, /delegate to leads/, "…and a short excerpt of the Director's rules");
  assert.ok(cli[0].prompt.endsWith("USER-PROMPT-1"), "system text first, then the request");
  // Anthropic-compatible builtin (glm, has a token) and custom kind "anthropic"
  r = await inst.run({ job: "x", prompt: "p", provider: "glm", model: "glm-5.2" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.deepStrictEqual(cli[1].opts, { provider: "glm", model: "glm-5.2" });
  r = await inst.run({ job: "x", prompt: "p", provider: "cpa", model: "some-model" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(cli[2].opts.provider, "cpa");
  assert.strictEqual(r.brain.source, "request");
  assert.strictEqual(calls.length, 0, "no HTTP call on the claude path");
});

test("run: OpenAI-compatible providers (local, cloud, custom) are one direct POST to upstreamFor().chat", async () => {
  const { inst, reg, cli, calls } = rig();
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  let r = await inst.run({ job: "workflow-draft", prompt: "GOAL", system: "EXTRA-SYSTEM", maxTokens: 999 });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(r.text, "plain answer");
  assert.deepStrictEqual(r.brain, { provider: "lmstudio", model: "served-7b", label: "LM Studio · local", source: "copilot" });
  assert.strictEqual(calls[0].url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.strictEqual(calls[0].init.method, "POST");
  assert.strictEqual(calls[0].init.headers.authorization, "Bearer local");
  assert.ok(calls[0].init.signal, "every call carries an AbortController signal");
  const b = calls[0].body;
  assert.deepStrictEqual([b.model, b.temperature, b.max_tokens, b.stream], ["served-7b", 0.3, 8192, false], "a local brain gets ≥ 8192 tokens to think");
  assert.deepStrictEqual(b.messages.map((m) => m.role), ["system", "user"]);
  assert.match(b.messages[0].content, /^You are Shino, the Director .* drafting a workflow/);
  assert.match(b.messages[0].content, /EXTRA-SYSTEM/);
  assert.strictEqual(b.messages[1].content, "GOAL");
  // cloud (token) and custom kind "openai" (baseUrl + token)
  r = await inst.run({ job: "x", prompt: "p", provider: "openrouter", model: "openai/gpt-4o" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(calls[1].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.strictEqual(calls[1].init.headers.authorization, "Bearer sk-or-secret-1234567890");
  assert.strictEqual(calls[1].body.max_tokens, 4096, "a cloud brain keeps the caller's budget (default 4096)");
  r = await inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(calls[2].url, "http://127.0.0.1:9/v1/chat/completions");
  // max_tokens is clamped to the office proxy's 16384 cap
  await inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", maxTokens: 999999 });
  assert.strictEqual(calls[3].body.max_tokens, 16384);
  // a blank model on a local server → its first served CHAT model (the mmproj file is skipped)
  reg.copilot = { provider: "lmstudio", model: "" };
  r = await inst.run({ job: "x", prompt: "p" });
  assert.strictEqual(calls[4].body.model, "served-7b");
  assert.strictEqual(r.brain.model, "served-7b");
  assert.strictEqual(cli.length, 0, "never the claude CLI for an OpenAI-compatible provider");
});

test("run: providers that are not usable fail fast with NOT_CONNECTED (nothing is called)", async () => {
  const reg = baseReg();
  delete reg.providerConfig.glm.token;
  const { inst, cli, calls } = rig({ reg });
  for (const [provider, model] of [["glm", "glm-5.2"], ["openai", "gpt-4o"], ["nope", ""], ["constructor", ""], ["nokind", ""], ["../x", ""]]) {
    const r = await inst.run({ job: "x", prompt: "p", provider, model });
    assert.strictEqual(r.ok, false, provider);
    assert.strictEqual(r.error.code, "NOT_CONNECTED", provider + " → " + JSON.stringify(r.error));
    assert.ok(r.error.message.length > 10, "a readable message");
  }
  assert.deepStrictEqual([cli.length, calls.length], [0, 0]);
  // a model id with shell metacharacters never reaches claude's command line
  const r = await inst.run({ job: "x", prompt: "p", provider: "claude", model: "x & calc" });
  assert.strictEqual(r.error.code, "MODEL_NOT_FOUND");
  assert.strictEqual(cli.length, 0);
});

// ==== JSON ===================================================================
test("extractJson: fenced or bare, first object/array, strings respected, trailing commas forgiven", () => {
  const X = copilot.extractJson;
  assert.deepStrictEqual(X('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(X('Sure!\n```json\n{"a":[1,2]}\n```\nHope it helps'), { a: [1, 2] });
  assert.deepStrictEqual(X("```\n[\"x\",\"y\"]\n```"), ["x", "y"]);
  assert.deepStrictEqual(X('Here you go: {"name":"a } tricky { one","steps":["s1"]} — and {"b":2}'), { name: "a } tricky { one", steps: ["s1"] });
  assert.deepStrictEqual(X('see [1] and [2, 3] then {"ok":true}'), { ok: true }, "number-only arrays are citations, not the answer");
  assert.deepStrictEqual(X('{"steps":["a","b",],}'), { steps: ["a", "b"] });
  assert.deepStrictEqual(X('use {name} here, answer: {"z":"q\\"x"}'), { z: 'q"x' });
  assert.deepStrictEqual(X('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }], "an array of objects stays an array");
  for (const bad of ["", "no json here", '{"cut": "off', "{name}", null, undefined]) assert.strictEqual(X(bad), null, String(bad));
  assert.strictEqual(copilot.stripThink("<think>hmm</think>\n{\"a\":1}"), '{"a":1}');
  assert.strictEqual(copilot.stripThink("<think>still thinking…"), "");
  assert.strictEqual(copilot.stripThink("reasoning only</think>answer"), "answer");
});

test("run json: a bad reply gets ONE retry with a valid-JSON nudge; still bad → BAD_JSON", async () => {
  let { inst, reg, calls, logs } = rig({ replies: [{ json: chat("I think the persona should be friendly.") }, { json: chat('```json\n{"prompt":"hi"}\n```') }] });
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  let r = await inst.run({ job: "persona", prompt: "P", json: true });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.deepStrictEqual(r.json, { prompt: "hi" });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.strictEqual(calls[1].body.messages[2].content, "I think the persona should be friendly.");
  assert.match(calls[1].body.messages[3].content, /could not be parsed as JSON/);
  assert.match(logs.join("\n"), /json retry/);
  // twice prose → BAD_JSON, the last text kept (the draft route falls back to its lines)
  ({ inst, reg, calls } = rig({ replies: [{ json: chat("prose one") }, { json: chat("prose two") }] }));
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  r = await inst.run({ job: "persona", prompt: "P", json: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, "BAD_JSON");
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.text, "prose two");
  assert.strictEqual(calls.length, 2, "exactly one retry");
  // the claude path retries the same way (nudge appended to the prompt)
  const c = rig({ cli: ["nope", '{"a":1}'] });
  r = await c.inst.run({ job: "persona", prompt: "P", json: true });
  assert.deepStrictEqual([r.ok, r.json], [true, { a: 1 }]);
  assert.strictEqual(c.cli.length, 2);
  assert.match(c.cli[1].prompt, /could not be parsed as JSON/);
  assert.doesNotMatch(c.cli[0].prompt, /could not be parsed as JSON/);
  // json not requested → no parsing, no retry
  const d = rig({ cli: ["just text"] });
  r = await d.inst.run({ job: "workflow-analyze", prompt: "P" });
  assert.deepStrictEqual([r.ok, r.text, r.json, d.cli.length], [true, "just text", null, 1]);
});

// ==== errors =================================================================
test("run errors: 401/403 AUTH · 404 + 'model not found' MODEL_NOT_FOUND · other HTTP UPSTREAM · keys redacted", async () => {
  const cases = [
    [{ status: 401, json: { error: { message: "Incorrect API key provided: cp-tok-123456" } } }, "AUTH"],
    [{ status: 403, text: "forbidden" }, "AUTH"],
    [{ status: 404, text: "Not Found" }, "MODEL_NOT_FOUND"],
    [{ status: 400, json: { error: { message: "The model `m1` does not exist." } } }, "MODEL_NOT_FOUND"],
    [{ status: 500, text: "boom" }, "UPSTREAM"],
    [{ status: 429, text: "rate limited" }, "UPSTREAM"],
    [{ status: 200, json: { error: { message: "model_not_found", code: "model_not_found" } } }, "MODEL_NOT_FOUND"],
    [{ status: 200, json: { error: { message: "Invalid API key", code: 401 } } }, "AUTH"],
    [{ status: 200, text: "<html>proxy</html>" }, "UPSTREAM"],
    [{ status: 200, json: chat("") }, "EMPTY"],
  ];
  for (const [reply, code] of cases) {
    const { inst, calls } = rig({ replies: [reply] });
    const r = await inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", json: true });
    assert.strictEqual(r.ok, false, JSON.stringify(reply));
    assert.strictEqual(r.error.code, code, JSON.stringify(reply) + " → " + JSON.stringify(r.error));
    assert.strictEqual(calls.length, 1, "no JSON retry after a transport/HTTP error");
    assert.ok(!JSON.stringify(r).includes("cp-tok-123456"), "the key never comes back: " + r.error.message);
    assert.deepStrictEqual(r.brain, { provider: "cpo", model: "m1", label: "My Stub · custom", source: "request" });
  }
  // cut off while thinking (finish_reason=length): once more with twice the room, then EMPTY + a max-tokens hint
  const t = rig({ replies: [{ json: chat("<think>only thinking, cut off", "length") }, { json: chat("", "length") }] });
  const rt = await t.inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", json: true, maxTokens: 1500 });
  assert.deepStrictEqual([rt.error.code, t.calls.length, t.calls[0].body.max_tokens, t.calls[1].body.max_tokens], ["EMPTY", 2, 1500, 3000]);
  assert.match(rt.error.message, /max tokens/);
});

test("run: a local reasoning brain gets ≥ 8192 tokens + localTimeoutMs; cut off while thinking → one retry with twice the room (Agents-A1 on LM Studio, live 2026-09-29)", async () => {
  const { inst, reg, calls, logs } = rig({ replies: [{ json: chat("", "length") }, { json: chat('<think>ok, 0.6 fits</think>{"config":{"port":8117}}') }] });
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  const r = await inst.run({ job: "workflow-analyze", prompt: "p", json: true, maxTokens: 1500, timeoutMs: 120000, localTimeoutMs: 300000 });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.deepStrictEqual(r.json, { config: { port: 8117 } });
  assert.deepStrictEqual(calls.map((c) => c.body.max_tokens), [8192, 16384]);
  assert.match(logs.join("\n"), /workflow-analyze · lmstudio\/served-7b · ok · \d+ ms · more room to think/);
  // at the cap already → no retry
  const c = rig({ replies: [{ json: chat("", "length") }] });
  const rc = await c.inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", maxTokens: 16384 });
  assert.deepStrictEqual([rc.error.code, c.calls.length], ["EMPTY", 1]);
  // localTimeoutMs stretches the wait for a local brain only
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const l = rig({ fetchImpl: hang });
  const t0 = Date.now();
  const rl = await l.inst.run({ job: "x", prompt: "p", provider: "lmstudio", model: "m", timeoutMs: 1000, localTimeoutMs: 2000 });
  assert.strictEqual(rl.error.code, "TIMEOUT");
  assert.match(rl.error.message, /within 2 s/);
  assert.ok(Date.now() - t0 >= 1900, "waited the local 2 s");
  const cl = rig({ fetchImpl: hang });
  const rcl = await cl.inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", timeoutMs: 1000, localTimeoutMs: 2000 });
  assert.match(rcl.error.message, /within 1 s/, "a cloud brain keeps timeoutMs");
});

test("run errors: 400 param rejections self-heal once (max_completion_tokens / temperature)", async () => {
  const { inst, calls } = rig({ replies: [
    { status: 400, text: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
    { status: 400, text: "Unsupported value: 'temperature' does not support 0.3 with this model." },
    { json: chat("fine") },
  ] });
  const r = await inst.run({ job: "x", prompt: "p", provider: "cpo", model: "m1", maxTokens: 500 });
  assert.strictEqual(r.ok, true, JSON.stringify(r.error));
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[2].body.max_completion_tokens, 500);
  assert.ok(!("max_tokens" in calls[2].body) && !("temperature" in calls[2].body));
  // a local server: prompt + max_tokens over its context length → shrink max_tokens to what is left
  for (const msg of [
    "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (4904 in the messages, 4096 in the completion).",
    "'max_tokens' or 'max_completion_tokens' is too large: 4096. This model's maximum context length is 8192 tokens and your request has 4904 input tokens (4096 > 8192 - 4904)."]) {
    const v = rig({ replies: [{ status: 400, json: { object: "error", message: msg, type: "BadRequestError", code: 400 } }, { json: chat("fits") }] });
    const r2 = await v.inst.run({ job: "x", prompt: "p", provider: "lmstudio", model: "org/m" });
    assert.strictEqual(r2.ok, true, JSON.stringify(r2.error));
    assert.strictEqual(v.calls[1].body.max_tokens, 8192 - 4904 - 16);
  }
  // a prompt that alone overflows the context can't be healed → a readable UPSTREAM hint
  const o = rig({ replies: [{ status: 400, text: "This model's maximum context length is 4096 tokens. However, you requested 9000 tokens (8000 in the messages, 1000 in the completion)." }] });
  const r3 = await o.inst.run({ job: "x", prompt: "p", provider: "lmstudio", model: "org/m", maxTokens: 1000 });
  assert.deepStrictEqual([r3.error.code, o.calls.length], ["UPSTREAM", 1]);
  assert.match(r3.error.message, /context/);
});

test("run errors: TIMEOUT aborts the request · NETWORK names the server · the claude path maps CLI failures", async () => {
  let aborted = false;
  let { inst } = rig({ fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => { aborted = true; rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })); })) });
  let r = await inst.run({ job: "x", prompt: "p", provider: "lmstudio", model: "m", timeoutMs: 1000 });
  assert.strictEqual(r.error.code, "TIMEOUT");
  assert.ok(aborted, "the HTTP request itself was aborted");
  assert.match(r.error.message, /within 1 s/);
  ({ inst } = rig({ fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); } }));
  r = await inst.run({ job: "x", prompt: "p", provider: "lmstudio", model: "m" });
  assert.strictEqual(r.error.code, "NETWORK");
  assert.match(r.error.message, /127\.0\.0\.1:1234/);
  assert.match(r.error.detail, /ECONNREFUSED/);
  // claude path
  for (const [out, code] of [["", "EMPTY"], ["API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}", "AUTH"],
    ["Invalid API key · Please run /login", "AUTH"], ["API Error: 404 {\"error\":{\"type\":\"not_found_error\",\"message\":\"model: x\"}}", "MODEL_NOT_FOUND"],
    ["API Error: 529 overloaded", "UPSTREAM"]]) {
    const c = rig({ cli: [out] });
    r = await c.inst.run({ job: "x", prompt: "p" });
    assert.strictEqual(r.error && r.error.code, code, JSON.stringify(out));
  }
  const slow = rig({ claudeText: () => new Promise(() => {}) });
  r = await slow.inst.run({ job: "x", prompt: "p", timeoutMs: 1000 });
  assert.strictEqual(r.error.code, "TIMEOUT");
  assert.ok(r.ms >= 900 && r.ms < 5000, "ms reports the elapsed time: " + r.ms);
});

// ==== track ==================================================================
test("run track: task.started → task.completed|failed for agent main (journaled like other task rows)", async () => {
  let { inst, events } = rig({ cli: ["ok"] });
  await inst.run({ job: "x", prompt: "p", track: { title: "✨ copilot · persona" } });
  assert.deepStrictEqual(events.map((x) => x.e.type), ["task.started", "task.completed"]);
  const [s, d] = events.map((x) => x.e);
  assert.deepStrictEqual([s.agent, s.title, d.agent, d.task], ["main", "✨ copilot · persona", "main", s.task]);
  assert.ok(events.every((x) => x.journal === undefined), "default journaling (a real task row)");
  ({ inst, events } = rig({ cli: [""] }));
  await inst.run({ job: "x", prompt: "p", track: { title: "🔍 copilot · analyze workflow" } });
  assert.deepStrictEqual(events.map((x) => x.e.type), ["task.started", "task.failed"]);
  assert.strictEqual(events[1].e.task, events[0].e.task);
  assert.match(events[1].e.error, /claude CLI/);
  ({ inst, events } = rig({ cli: ["ok"] }));
  await inst.run({ job: "x", prompt: "p" });
  assert.strictEqual(events.length, 0, "no track → no task row");
});

// ==== settings ===============================================================
test("settings(): picker data — claude, locals with running + served models, credentialed cloud/custom, no secrets", async () => {
  const { inst, reg } = rig();
  reg.copilot = { provider: "lmstudio", model: "served-7b" };
  const s = await inst.settings();
  assert.deepStrictEqual([s.provider, s.model], ["lmstudio", "served-7b"]);
  assert.deepStrictEqual(s.effective, { provider: "lmstudio", model: "served-7b", label: "LM Studio · local", source: "copilot" });
  assert.deepStrictEqual(s.director, { id: "main", name: "Shino", provider: "claude", model: "claude-fable-5-1" });
  const by = Object.fromEntries(s.providers.map((p) => [p.id, p]));
  assert.strictEqual(s.providers[0].id, "claude");
  assert.deepStrictEqual([by.claude.group, by.claude.connected, by.claude.running], ["claude", true, null]);
  assert.deepStrictEqual([by.lmstudio.group, by.lmstudio.connected, by.lmstudio.running], ["local", true, true]);
  assert.deepStrictEqual(by.lmstudio.models.slice(0, 2), ["served-7b", "qwen-x"], "served chat models first, then known ones");
  assert.ok(!by.lmstudio.models.some((m) => /mmproj/.test(m)), "projector files are not chat models");
  assert.deepStrictEqual([by.ollama.running, by.ollama.connected, by.ollama.group, by.vllm], [false, false, "local", undefined]);
  assert.deepStrictEqual([by.openrouter.group, by.openrouter.connected], ["cloud", true]);
  assert.ok(by.openrouter.models.includes("openai/gpt-4o"), "catalog hints");
  assert.deepStrictEqual([by.glm.group, by.glm.connected, by.glm.kind], ["cloud", true, "anthropic"]);
  assert.deepStrictEqual([by.cpo.group, by.cpo.label, by.cpo.kind, by.cpa.group], ["custom", "My Stub · custom", "openai", "custom"]);
  for (const id of ["nokind", "litellm", "openai", "groq"]) assert.ok(!by[id], id + " is not offered");
  const json = JSON.stringify(s);
  for (const secret of ["sk-or-secret-1234567890", "glm-secret-abcdef", "cp-tok-123456", "cpa-tok-123456"]) assert.ok(!json.includes(secret), "leaked " + secret);
  // a Director on a provider that isn't offered otherwise still shows up (connected:false)
  reg.agents.main.provider = "groq"; reg.copilot = {};
  const s2 = await inst.settings();
  const g = s2.providers.find((p) => p.id === "groq");
  assert.deepStrictEqual([g && g.connected, s2.effective.source, s2.provider], [false, "director", ""]);
  // …and so does a copilot choice whose custom provider was removed since
  reg.copilot = { provider: "gone-custom", model: "m" };
  const gone = (await inst.settings()).providers.find((p) => p.id === "gone-custom");
  assert.deepStrictEqual(gone && [gone.connected, gone.group, gone.kind], [false, "custom", null]);
});

test("setBrain(): validates like the fallback brain, persists reg.copilot, broadcasts copilot.settings (journal false)", () => {
  const { inst, reg, events, saves } = rig();
  let eff = inst.setBrain("lmstudio", " served-7b ");
  assert.deepStrictEqual(reg.copilot, { provider: "lmstudio", model: "served-7b" });
  assert.deepStrictEqual(eff, { provider: "lmstudio", model: "served-7b", label: "LM Studio · local", source: "copilot" });
  assert.strictEqual(saves(), 1);
  assert.deepStrictEqual(events.map((x) => [x.e.type, x.e.provider, x.e.model, x.journal]), [["copilot.settings", "lmstudio", "served-7b", false]]);
  eff = inst.setBrain("ollama", "");
  assert.deepStrictEqual(reg.copilot, { provider: "ollama", model: "" });
  for (const p of ["", "director", null, undefined]) {
    eff = inst.setBrain(p, "whatever");
    assert.deepStrictEqual(reg.copilot, { provider: "", model: "" });
    assert.strictEqual(eff.source, "director");
  }
  inst.setBrain("cpo", "m1");
  for (const [p, m] of [["nope", ""], ["constructor", ""], ["__proto__", ""], ["nokind", ""], ["litellm", ""], ["lmstudio", "x & calc"], ["lmstudio", "a".repeat(161)]])
    assert.throws(() => inst.setBrain(p, m), JSON.stringify([p, m]));
  assert.deepStrictEqual(reg.copilot, { provider: "cpo", model: "m1" }, "a rejected value keeps the previous choice");
});

test("officeContext: agents (not the owner), skills with one-line descriptions, tool names", () => {
  const ctx = copilot.officeContext(baseReg(), { tools: ["Read", "Bash", "WebSearch"] });
  assert.match(ctx, /^- main: Shino — Director$/m);
  assert.match(ctx, /^- nina: Nina — Designer$/m);
  assert.doesNotMatch(ctx, /- ceo:/);
  assert.match(ctx, /^- deep-research: Methodical web research/m);
  assert.ok(ctx.indexOf("deep-research") < ctx.indexOf("lesson-x"), "library skills before learned lessons");
  assert.match(ctx, /^Built-in tools: Read, Bash, WebSearch$/m);
  assert.match(ctx, /^MCP tools: mcp:web$/m);
  // a big library stays compact: descriptions cut, overflow listed by id
  const skills = {};
  for (let i = 0; i < 150; i++) skills["skill-" + i] = { description: "x".repeat(300) };
  const big = copilot.officeContext({ agents: {}, skills }, { tools: [] });
  assert.ok(big.length < 9500, "compact: " + big.length);
  assert.match(big, /more skills \(ids only\): skill-/);
  assert.ok(!big.includes("x".repeat(91)), "descriptions are one short line");
});

test("init()/get(): one shared instance", () => {
  assert.strictEqual(copilot.get(), null, "null before init");
  const a = copilot.init({ getReg: () => baseReg() });
  assert.strictEqual(copilot.get(), a);
  assert.strictEqual(typeof a.run, "function");
  assert.strictEqual(a.brain().directorName, "Shino");
});

// ==== end-to-end over the real routes ========================================
const DAEMON_DIR = path.join(__dirname, "..");
const SKIP = /[\\/](registry\.json|sessions\.json|journal\.jsonl|tests|tooldetail|reports)$|\.log$|\.bak$/;
const PORT = 19221 + Math.floor(Math.random() * 4);   // developer G's range 19220-19229
const STUB_PORT = 19225 + Math.floor(Math.random() * 4);

async function bootIsolated(t, stubReg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-copilot-"));
  fs.cpSync(DAEMON_DIR, path.join(tmp, "daemon"), { recursive: true, filter: (src) => !SKIP.test(src) });
  fs.mkdirSync(path.join(tmp, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "daemon", "registry.json"), JSON.stringify(stubReg));
  const child = spawn(process.execPath, [path.join(tmp, "daemon", "server.js")], {
    env: { ...process.env, OEP_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
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
  const base = "http://127.0.0.1:" + PORT;
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(base + "/health")).ok) break; } catch {}
    if (child.exitCode !== null || Date.now() - t0 > 30000) throw new Error("daemon did not boot: " + logs.join("").slice(-2000));
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base, tmp, logs };
}

test("routes: /copilot/settings + the three copilot routes run one-shot on the picked brain (stub LM Studio)", async (t) => {
  // A stand-in OpenAI-compatible server, registered as provider "lmstudio" through its baseUrl.
  const seen = [];
  let mode = "ok";
  const PERSONA = { prompt: "คุณคือ Nina2 นักออกแบบ", expertise: ["UI", "microcopy"], personality: "ใจเย็น",
    language: "ไทย", rules: "1. ถามก่อนเดา", skills: ["deep-research", "made-up-skill"], tools: ["WebSearch", "NotATool"] };
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "GET" && req.url === "/v1/models") return send(200, { object: "list", data: [{ id: "stub-model" }, { id: "other-model" }] });
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") return send(404, { error: "no route" });
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seen.push({ body, auth: req.headers.authorization });
      if (mode === "401") return send(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
      const user = String((body.messages.find((m) => m.role === "user") || {}).content || "");
      let content = "?";
      if (user.includes("Design a complete persona")) content = "Here it is:\n```json\n" + JSON.stringify(PERSONA) + "\n```";
      else if (user.includes("Draft a workflow")) content = JSON.stringify({ name: "Morning AI news", steps: ["ค้นข่าว AI", "สรุปข่าว", "ส่งเข้า Telegram"] });
      else if (user.includes("OFFICE CONTEXT")) content = "1) สรุป: ส่งข่าวทุกเช้า\n2) ใช้ skill deep-research + tool WebSearch\n4) มอบหมายให้ nina";
      send(200, { id: "x", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    });
  });
  await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  t.after(() => stub.close());
  const stubBase = "http://127.0.0.1:" + STUB_PORT + "/v1";

  const { base, tmp } = await bootIsolated(t, {
    agents: {
      main: { name: "Shino", role: "Director", prompt: "", provider: "claude", model: "claude-fable-5-1",
        persona: { language: "Thai, English on Technical words and code.", rules: "1. มอบหมายงานให้ Lead" } },
      ceo: { name: "CEO", role: "Owner", prompt: "" },
      nina: { name: "Nina", role: "Designer", prompt: "", provider: "lmstudio", model: "stub-model" },
    },
    apiKeys: {}, roles: ["Director", "Designer"], tools: [], mcpServers: {}, places: {}, triggers: [],
    providerConfig: { lmstudio: { connected: true, baseUrl: stubBase }, openrouter: { token: "sk-or-e2e-secret-123456", connected: true } },
    skills: { "deep-research": { name: "Deep Research", description: "Methodical web research that ends in a sourced brief." } },
    copilot: { provider: "lmstudio", model: "stub-model" },
    heartbeatMin: 0, socialMin: 0, proposalMin: 0, autoPilot: false,
  });
  const UI = { "content-type": "application/json", "x-bagidea-ui": "1" };
  const post = (url, body, ui = true) => fetch(base + url, { method: "POST", headers: ui ? UI : { "content-type": "application/json" }, body: JSON.stringify(body) });

  // GET /copilot/settings
  let r = await fetch(base + "/copilot/settings");
  assert.strictEqual(r.status, 200);
  const raw = await r.text();
  const s = JSON.parse(raw);
  assert.deepStrictEqual([s.provider, s.model], ["lmstudio", "stub-model"]);
  assert.deepStrictEqual(s.effective, { provider: "lmstudio", model: "stub-model", label: "LM Studio · local", source: "copilot" });
  assert.deepStrictEqual(s.director, { id: "main", name: "Shino", provider: "claude", model: "claude-fable-5-1" });
  const lm = s.providers.find((p) => p.id === "lmstudio");
  assert.deepStrictEqual([lm.group, lm.running, lm.connected, lm.models[0]], ["local", true, true, "stub-model"]);
  assert.ok(s.providers.some((p) => p.id === "claude" && p.group === "claude"));
  assert.ok(!raw.includes("sk-or-e2e-secret-123456"), "no key in the settings");

  // POST /copilot/settings: owner-only, validated, "director" follows the Director
  r = await post("/copilot/settings", { provider: "director" }, false);
  assert.strictEqual(r.status, 403);
  for (const bad of [{ provider: "nope" }, { provider: "lmstudio", model: "x & calc" }]) {
    r = await post("/copilot/settings", bad);
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
    assert.strictEqual((await r.json()).ok, false);
  }
  r = await post("/copilot/settings", { provider: "director", model: "ignored" });
  assert.strictEqual(r.status, 200);
  let j = await r.json();
  assert.deepStrictEqual(j.effective, { provider: "claude", model: "claude-fable-5-1", label: "Claude · Anthropic", source: "director" });
  assert.deepStrictEqual((await fetch(base + "/registry").then((x) => x.json())).copilot, { provider: "", model: "" });
  r = await post("/copilot/settings", { provider: "lmstudio", model: "stub-model" });
  j = await r.json();
  assert.deepStrictEqual([r.status, j.ok, j.effective.source, j.effective.provider], [200, true, "copilot", "lmstudio"]);

  // ✨ POST /assist/prompt → the stub's persona JSON (validated) + brain
  r = await post("/assist/prompt", { name: "Nina2", role: "Designer", brief: "นักออกแบบ UI ที่ใส่ใจ microcopy" });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.prompt, PERSONA.prompt);
  assert.strictEqual(j.expertise, "UI\nmicrocopy", "a list becomes lines for the text box");
  assert.deepStrictEqual([j.personality, j.language, j.rules], [PERSONA.personality, PERSONA.language, PERSONA.rules]);
  assert.deepStrictEqual(j.skills, ["deep-research"], "unknown skills dropped");
  assert.deepStrictEqual(j.tools, ["WebSearch"], "unknown tools dropped");
  assert.deepStrictEqual(j.brain, { provider: "lmstudio", model: "stub-model", label: "LM Studio · local", source: "copilot" });
  const req1 = seen[seen.length - 1];
  assert.strictEqual(req1.body.model, "stub-model");
  assert.match(req1.body.messages[0].content, /^You are Shino, the Director of this BagIdea office/);
  assert.match(req1.body.messages[1].content, /Design a complete persona[\s\S]*deep-research: Methodical web research/);

  // 🪄 POST /workflows/draft → a Builder workflow
  r = await post("/workflows/draft", { goal: "สรุปข่าว AI ทุกเช้าแล้วส่งเข้า Telegram" });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.workflow.name, "Morning AI news");
  assert.deepStrictEqual(j.workflow.nodes.map((n) => n.type), ["trigger", "action", "action", "action"]);
  assert.strictEqual(j.workflow.edges.length, 3);
  assert.strictEqual(j.brain.provider, "lmstudio");

  // 🔍 POST /workflows/analyze → the analysis, with the office context in the prompt
  r = await post("/workflows/analyze", { name: "ข่าวเช้า", nodes: [{ id: "n1", type: "trigger", text: "ทุกเช้า", y: 0 }, { id: "n2", type: "action", text: "สรุปข่าว AI", y: 100 }], edges: [{ from: "n1", to: "n2" }] });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.match(j.analysis, /deep-research/);
  assert.strictEqual(j.brain.model, "stub-model");
  const user = seen[seen.length - 1].body.messages[1].content;
  for (const s2 of ["As the Director", "OFFICE CONTEXT", "- nina: Nina — Designer", "- deep-research: Methodical", "WebSearch", "สรุปข่าว AI"])
    assert.ok(user.includes(s2), "analyze prompt is missing " + s2);
  assert.ok(!user.includes("- ceo:"), "the owner is not an assignee");

  // Shino shows up working: tracked task rows for agent main
  let journal = "";
  for (let i = 0; i < 40 && !/copilot · analyze workflow[\s\S]*task\.completed/.test(journal); i++) {
    await new Promise((res) => setTimeout(res, 50));
    try { journal = fs.readFileSync(path.join(tmp, "daemon", "journal.jsonl"), "utf8"); } catch {}
  }
  const evs = journal.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const started = evs.filter((e) => e.type === "task.started" && /copilot/.test(e.title || ""));
  assert.deepStrictEqual(started.map((e) => e.title.split(" — ")[0]), ["✨ copilot · persona", "🪄 copilot · draft workflow", "🔍 copilot · analyze workflow"]);
  assert.ok(started.every((e) => e.agent === "main"));
  for (const st of started) assert.ok(evs.some((e) => e.type === "task.completed" && e.task === st.task), "completed " + st.title);

  // the brain rejects the key → 502 JSON { ok:false, error.code AUTH, brain }
  mode = "401";
  r = await post("/assist/prompt", { name: "X", role: "Designer", brief: "x" });
  assert.strictEqual(r.status, 502);
  j = await r.json();
  assert.deepStrictEqual([j.ok, j.error.code, j.brain.provider, j.brain.model], [false, "AUTH", "lmstudio", "stub-model"]);
  assert.match(j.error.message, /LM Studio/);
  r = await post("/workflows/draft", { goal: "x" });
  j = await r.json();
  assert.deepStrictEqual([r.status, j.ok, j.error.code, j.workflow], [502, false, "AUTH", null]);
  r = await post("/workflows/analyze", { name: "x", nodes: [], edges: [] });
  j = await r.json();
  assert.deepStrictEqual([r.status, j.ok, j.error.code], [502, false, "AUTH"]);
  assert.match(j.analysis, /^Analysis failed/, "today's Builder still shows a reason");
  // bad bodies stay 400
  assert.strictEqual((await post("/workflows/draft", { goal: "  " })).status, 400);
  assert.strictEqual((await fetch(base + "/workflows/analyze", { method: "POST", headers: UI, body: "not json" })).status, 400);
  // owner-UI only: without x-bagidea-ui the three copilot routes answer 403
  for (const [u, b] of [["/assist/prompt", { brief: "x" }], ["/workflows/draft", { goal: "x" }], ["/workflows/analyze", { nodes: [] }]])
    assert.strictEqual((await post(u, b, false)).status, 403, u + " without the owner header");
});
