const test = require("node:test");
const assert = require("node:assert");
const { resolve, PROVIDERS } = require("../providers");

test("default brain: no provider → empty overrides, no model arg", () => {
  const r = resolve(undefined, "", {});
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.env, {});
  assert.deepStrictEqual(r.modelArgs, []);
});

test("claude + explicit model → --model only, no env override", () => {
  const r = resolve("claude", "sonnet", {});
  assert.deepStrictEqual(r.env, {});
  assert.deepStrictEqual(r.modelArgs, ["--model", "sonnet"]);
});

test("GLM configured → z.ai endpoint + token in env", () => {
  const reg = { providerConfig: { glm: { token: "zk-123" } } };
  const r = resolve("glm", "glm-4.6", reg);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "https://api.z.ai/api/anthropic");
  assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "zk-123");
  assert.deepStrictEqual(r.modelArgs, ["--model", "glm-4.6"]);
});

test("GLM NOT configured (no token) → fail-open to plain Claude", () => {
  const r = resolve("glm", "glm-4.6", { providerConfig: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "not-configured");
  assert.deepStrictEqual(r.env, {});
  assert.deepStrictEqual(r.modelArgs, []);
});

test("unknown provider → fail-open, never throws", () => {
  const r = resolve("totally-made-up", "x", { providerConfig: { "totally-made-up": { token: "t" } } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "unknown-provider");
  assert.deepStrictEqual(r.env, {});
});

test("per-agent baseUrl + model override via providerConfig", () => {
  const reg = { providerConfig: { qwen: { token: "qk", baseUrl: "https://qwen.example/anthropic", model: "qwen3-coder-plus" } } };
  const r = resolve("qwen", "ignored", reg);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "https://qwen.example/anthropic");
  assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "qk");
  assert.deepStrictEqual(r.modelArgs, ["--model", "qwen3-coder-plus"]); // pc.model wins
});

test("openai routes through LiteLLM gateway (proxy provider)", () => {
  const reg = { providerConfig: { litellm: { baseUrl: "http://127.0.0.1:4000", token: "sk-master" } } };
  const r = resolve("openai", "gpt-5.5", reg);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:4000");
  assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "sk-master");
  assert.deepStrictEqual(r.modelArgs, ["--model", "gpt-5.5"]);
});

test("proxy provider with no gateway + no proxyBase fails-open to Claude (no hang)", () => {
  const r = resolve("gemini", "gemini-3-pro", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "no-proxy-available");
  assert.deepStrictEqual(r.env, {}); // never points claude at a dead endpoint
});

test("proxy provider routes once a LiteLLM gateway URL is configured", () => {
  const r = resolve("gemini", "gemini-3-pro", { litellmUrl: "http://127.0.0.1:4000" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:4000");
  assert.ok(r.env.ANTHROPIC_AUTH_TOKEN);
});

test("built-in proxy: openai routes to /proxy/openai when main key + proxyBase present", () => {
  const reg = { apiKeys: { OPENAI_API_KEY: "sk-x" } };
  const r = resolve("openai", "", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787/proxy/openai");
  assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "office"); // real key injected by the proxy
  assert.deepStrictEqual(r.modelArgs, ["--model", "gpt-4o-mini"]); // safe default when blank
});

test("built-in proxy: fails-open to Claude when no key is set", () => {
  const r = resolve("gemini", "", { apiKeys: {} }, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "key-not-set");
  assert.deepStrictEqual(r.env, {});
});

test("OpenRouter routes to the built-in proxy with a providerConfig token", () => {
  const reg = { providerConfig: { openrouter: { token: "or-x" } } };
  const r = resolve("openrouter", "openai/gpt-4o", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787/proxy/openrouter");
  assert.deepStrictEqual(r.modelArgs, ["--model", "openai/gpt-4o"]);
});

test("Atlas Cloud routes to the built-in proxy", () => {
  const reg = { providerConfig: { atlascloud: { token: "atlas-key" } } };
  const r = resolve("atlascloud", "openai/gpt-4.1-mini", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787/proxy/atlascloud");
  assert.deepStrictEqual(r.modelArgs, ["--model", "openai/gpt-4.1-mini"]);
});

test("custom anthropic-kind provider routes direct from providerConfig", () => {
  const reg = { providerConfig: { acme: { kind: "anthropic", baseUrl: "https://acme.ai/anthropic", token: "k", model: "acme-1" } } };
  const r = resolve("acme", "", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "https://acme.ai/anthropic");
  assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "k");
  assert.deepStrictEqual(r.modelArgs, ["--model", "acme-1"]);
});

test("custom openai-kind provider routes through the built-in proxy", () => {
  const reg = { providerConfig: { foo: { kind: "openai", baseUrl: "https://foo.ai/v1", token: "k" } } };
  const r = resolve("foo", "foo-large", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787/proxy/foo");
  assert.deepStrictEqual(r.modelArgs, ["--model", "foo-large"]);
});

test("custom provider with no kind is unknown (fail-open)", () => {
  const r = resolve("mystery", "x", { providerConfig: { mystery: { token: "k" } } }, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "unknown-provider");
});

test("LiteLLM gateway takes precedence over the built-in proxy", () => {
  const reg = { apiKeys: { OPENAI_API_KEY: "sk-x" }, litellmUrl: "http://gw:4000" };
  const r = resolve("openai", "gpt-5.5", reg, { proxyBase: "http://127.0.0.1:8787" });
  assert.strictEqual(r.env.ANTHROPIC_BASE_URL, "http://gw:4000");
});

test("P2 confirmed endpoints resolve from catalog with just a token", () => {
  const cases = {
    deepseek: "https://api.deepseek.com/anthropic",
    qwen: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    minimax: "https://api.minimax.io/anthropic",
  };
  for (const [prov, url] of Object.entries(cases)) {
    const r = resolve(prov, "", { providerConfig: { [prov]: { token: "k" } } });
    assert.strictEqual(r.ok, true, prov);
    assert.strictEqual(r.env.ANTHROPIC_BASE_URL, url, prov);
    assert.strictEqual(r.env.ANTHROPIC_AUTH_TOKEN, "k", prov);
  }
});

test("catalog exposes the seven planned providers", () => {
  for (const p of ["claude", "glm", "deepseek", "qwen", "minimax", "openai", "gemini"]) {
    assert.ok(PROVIDERS[p], `missing provider: ${p}`);
  }
});
