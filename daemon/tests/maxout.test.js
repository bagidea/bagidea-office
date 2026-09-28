// Opt-in per-run output cap (POST /chat maxOutputTokens → CLAUDE_CODE_MAX_OUTPUT_TOKENS).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseMaxOutputTokens, applyMaxOutputTokens } = require("../maxout");

const BASE = () => ({ PATH: "C:\\bin", OFFICE_ADAPTER: "1", OFFICE_AGENT: "nova", OFFICE_TASK: "t1" });

test("parseMaxOutputTokens: absent field → undefined, env keeps the same reference", () => {
  for (const body of [{}, { maxOutputTokens: undefined }, { prompt: "x" }, null, undefined])
    assert.strictEqual(parseMaxOutputTokens(body), undefined, JSON.stringify(body));
  const env = BASE();
  assert.strictEqual(applyMaxOutputTokens(env, parseMaxOutputTokens({})), env);
  assert.ok(!("CLAUDE_CODE_MAX_OUTPUT_TOKENS" in env));
});

test("parseMaxOutputTokens: 6144 → env gets the string \"6144\"", () => {
  const n = parseMaxOutputTokens({ maxOutputTokens: 6144 });
  assert.strictEqual(n, 6144);
  assert.strictEqual(applyMaxOutputTokens(BASE(), n).CLAUDE_CODE_MAX_OUTPUT_TOKENS, "6144");
});

test("parseMaxOutputTokens: bounds 256 and 16384 are accepted", () => {
  assert.strictEqual(parseMaxOutputTokens({ maxOutputTokens: 256 }), 256);
  assert.strictEqual(parseMaxOutputTokens({ maxOutputTokens: 16384 }), 16384);
});

test("parseMaxOutputTokens: out-of-range / non-integer / non-number values throw", () => {
  for (const v of [255, 16385, 6144.5, "6144", null, true, 0, -1, NaN, Infinity, [6144], {}])
    assert.throws(() => parseMaxOutputTokens({ maxOutputTokens: v }),
      /^Error: maxOutputTokens must be an integer 256\.\.16384$/, JSON.stringify(v));
});

test("applyMaxOutputTokens does not mutate the input env", () => {
  const env = BASE();
  const before = JSON.stringify(env);
  const out = applyMaxOutputTokens(env, 4096);
  assert.notStrictEqual(out, env);
  assert.strictEqual(JSON.stringify(env), before);
  assert.deepStrictEqual(out, { ...BASE(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096" });
});

test("a later run without the field gets no CLAUDE_CODE_MAX_OUTPUT_TOKENS", () => {
  const shared = BASE();   // stands in for process.env, shared by every spawn
  const first = applyMaxOutputTokens({ ...shared, OFFICE_AGENT: "nova" }, parseMaxOutputTokens({ maxOutputTokens: 6144 }));
  assert.strictEqual(first.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "6144");
  const second = applyMaxOutputTokens({ ...shared, OFFICE_AGENT: "jeje" }, parseMaxOutputTokens({}));
  assert.ok(!("CLAUDE_CODE_MAX_OUTPUT_TOKENS" in second));
  assert.ok(!("CLAUDE_CODE_MAX_OUTPUT_TOKENS" in shared));
});

test("server.js wiring: /chat parses the field and the runClaude spawn env applies it", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /const maxout = require\("\.\/maxout"\)/);
  const chat = src.slice(src.indexOf('req.url === "/chat"'));
  assert.match(chat.slice(0, 1500), /const maxOutputTokens = maxout\.parseMaxOutputTokens\(parsed\);/);
  assert.match(src, /let childEnv = maxout\.applyMaxOutputTokens\(\{ \.\.\.process\.env,[^\n]*OFFICE_AGENT: agent, OFFICE_TASK: task \}, opts\.maxOutputTokens\);/);
  assert.match(src, /env: childEnv,/);
});
