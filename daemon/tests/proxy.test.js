const test = require("node:test");
const assert = require("node:assert");
const { toOpenAI, toAnthropic, pickModel, cleanModels, upstreamFor, streamAnthropic, UPSTREAM } = require("../proxy");

test("cleanModels strips models/ prefix, drops non-chat models, dedups", () => {
  const out = cleanModels([
    "models/gemini-2.5-flash", "models/gemini-3.1-flash-image",
    "models/gemini-3.1-flash-tts-preview", "models/gemini-3.1-flash-live-preview",
    "gpt-4o", "text-embedding-3-large", "dall-e-3", "whisper-1", "gpt-4o", "openai/gpt-4o",
  ]);
  assert.ok(out.includes("gemini-2.5-flash"));
  assert.ok(out.includes("gpt-4o"));
  assert.ok(out.includes("openai/gpt-4o"));
  assert.ok(!out.some((m) => /image|tts|live|embedding|dall|whisper/.test(m)), "non-chat leaked: " + out);
  assert.ok(!out.some((m) => m.startsWith("models/")), "prefix leaked");
  assert.strictEqual(out.filter((m) => m === "gpt-4o").length, 1, "not deduped");
});

test("cleanModels never returns empty (falls back to prefix-stripped list)", () => {
  assert.deepStrictEqual(cleanModels(["models/some-image-model"]), ["some-image-model"]);
});

test("streamAnthropic emits a well-formed Anthropic SSE sequence (text + tool_use)", () => {
  const w = [];
  const res = { writeHead() {}, write(s) { w.push(s); }, end() {}, writableEnded: false };
  streamAnthropic(res, { id: "m", model: "gpt-4o", stop_reason: "tool_use",
    usage: { input_tokens: 5, output_tokens: 3 },
    content: [{ type: "text", text: "hi there" }, { type: "tool_use", id: "t1", name: "get_weather", input: { city: "BKK" } }] });
  const s = w.join("");
  for (const ev of ["event: message_start", "event: content_block_start", "text_delta",
                    "input_json_delta", "event: message_delta", "event: message_stop"]) {
    assert.ok(s.includes(ev), "missing " + ev);
  }
  assert.ok(s.includes("hi there"));
  assert.ok(s.includes("get_weather"));
  assert.ok(s.includes("tool_use"));
});

test("toOpenAI: system + user text → system + user messages", () => {
  const o = toOpenAI({ system: "You are X", messages: [{ role: "user", content: "hi" }] }, "gpt-4o");
  assert.strictEqual(o.model, "gpt-4o");
  assert.deepStrictEqual(o.messages[0], { role: "system", content: "You are X" });
  assert.deepStrictEqual(o.messages[1], { role: "user", content: "hi" });
});

test("toOpenAI: array system blocks join into one system message", () => {
  const o = toOpenAI({ system: [{ type: "text", text: "A" }, { type: "text", text: "B" }], messages: [] }, "m");
  assert.strictEqual(o.messages[0].content, "A\nB");
});

test("toOpenAI: assistant tool_use → tool_calls; user tool_result → tool message", () => {
  const o = toOpenAI({ messages: [
    { role: "assistant", content: [{ type: "text", text: "let me check" },
      { type: "tool_use", id: "tu1", name: "get", input: { q: 1 } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "42" }] },
  ] }, "m");
  const am = o.messages[0];
  assert.strictEqual(am.role, "assistant");
  assert.strictEqual(am.content, "let me check");
  assert.strictEqual(am.tool_calls[0].id, "tu1");
  assert.strictEqual(am.tool_calls[0].function.name, "get");
  assert.strictEqual(am.tool_calls[0].function.arguments, JSON.stringify({ q: 1 }));
  const tm = o.messages[1];
  assert.strictEqual(tm.role, "tool");
  assert.strictEqual(tm.tool_call_id, "tu1");
  assert.strictEqual(tm.content, "42");
});

test("toOpenAI: tools + tool_choice translate to OpenAI function shape", () => {
  const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  const o = toOpenAI({ messages: [{ role: "user", content: "x" }],
    tools: [{ name: "search", description: "d", input_schema: schema }],
    tool_choice: { type: "any" } }, "m");
  assert.strictEqual(o.tools[0].type, "function");
  assert.strictEqual(o.tools[0].function.name, "search");
  assert.deepStrictEqual(o.tools[0].function.parameters, schema);
  assert.strictEqual(o.tool_choice, "required");
});

test("toOpenAI: stream adds include_usage", () => {
  const o = toOpenAI({ stream: true, messages: [] }, "m");
  assert.strictEqual(o.stream, true);
  assert.deepStrictEqual(o.stream_options, { include_usage: true });
});

test("toAnthropic: text response → message with end_turn", () => {
  const a = toAnthropic({ id: "x", choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 3 } }, "gpt-4o");
  assert.strictEqual(a.type, "message");
  assert.strictEqual(a.role, "assistant");
  assert.deepStrictEqual(a.content[0], { type: "text", text: "hello" });
  assert.strictEqual(a.stop_reason, "end_turn");
  assert.strictEqual(a.usage.input_tokens, 10);
  assert.strictEqual(a.usage.output_tokens, 3);
});

test("toAnthropic: tool_calls → tool_use blocks + stop_reason tool_use", () => {
  const a = toAnthropic({ choices: [{ message: { content: null,
    tool_calls: [{ id: "c1", function: { name: "get", arguments: '{"q":2}' } }] }, finish_reason: "tool_calls" }] }, "m");
  const tu = a.content.find((b) => b.type === "tool_use");
  assert.strictEqual(tu.id, "c1");
  assert.strictEqual(tu.name, "get");
  assert.deepStrictEqual(tu.input, { q: 2 });
  assert.strictEqual(a.stop_reason, "tool_use");
});

test("pickModel: claude-* and blank fall back; real model passes through", () => {
  assert.strictEqual(pickModel("claude-sonnet-4-6", "gpt-4o-mini"), "gpt-4o-mini");
  assert.strictEqual(pickModel("", "gemini-2.5-flash"), "gemini-2.5-flash");
  assert.strictEqual(pickModel("gpt-4o", "gpt-4o-mini"), "gpt-4o");
  assert.strictEqual(pickModel("claude-x", ""), "claude-x"); // no fallback → as-is
});

test("upstreamFor: built-in openai uses default URL + main key", () => {
  const u = upstreamFor("openai", { apiKeys: { OPENAI_API_KEY: "sk" } });
  assert.strictEqual(u.chat, "https://api.openai.com/v1/chat/completions");
  assert.strictEqual(u.models, "https://api.openai.com/v1/models");
  assert.strictEqual(u.key, "sk");
});

test("upstreamFor: custom provider uses providerConfig baseUrl + token", () => {
  const u = upstreamFor("foo", { providerConfig: { foo: { baseUrl: "https://foo.ai/v1", token: "k" } } });
  assert.strictEqual(u.chat, "https://foo.ai/v1/chat/completions");
  assert.strictEqual(u.models, "https://foo.ai/v1/models");
  assert.strictEqual(u.key, "k");
});

test("upstreamFor: providerConfig.token overrides the main-key env", () => {
  const u = upstreamFor("openai", { apiKeys: { OPENAI_API_KEY: "sk" }, providerConfig: { openai: { token: "pc" } } });
  assert.strictEqual(u.key, "pc");
});

// Bug 2 (issue #15) proxy upstream timeout tests live in proxy-timeout.test.js.

// --- Gemini thought signatures (400 "missing thought_signature in functionCall") --
const { SIG_DUMMY } = require("../proxy");

test("gemini: thought_signature captured from response and echoed on history tool_calls", () => {
  const sigs = new Map();
  // 1) Gemini replies with a signed tool call → toAnthropic remembers the signature
  toAnthropic({ choices: [{ message: { content: null, tool_calls: [
    { id: "tc9", type: "function", function: { name: "WebSearch", arguments: "{}" },
      extra_content: { google: { thought_signature: "SIGabc" } } },
  ] }, finish_reason: "tool_calls" }] }, "gemini-3-pro", { sigs });
  assert.strictEqual(sigs.get("tc9"), "SIGabc");
  // 2) claude echoes the history → toOpenAI re-attaches the exact signature
  const o = toOpenAI({ messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "tc9", name: "WebSearch", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tc9", content: "ok" }] },
  ] }, "gemini-3-pro", { gemini: true, sigs });
  const tc = o.messages.find((m) => m.role === "assistant").tool_calls[0];
  assert.deepStrictEqual(tc.extra_content, { google: { thought_signature: "SIGabc" } });
});

test("gemini: unsigned history tool_call falls back to the documented dummy signature", () => {
  const o = toOpenAI({ messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "old1", name: "Read", input: {} }] },
  ] }, "gemini-3-pro", { gemini: true, sigs: new Map() });
  assert.strictEqual(o.messages[0].tool_calls[0].extra_content.google.thought_signature, SIG_DUMMY);
});

test("non-gemini providers get NO extra_content on tool_calls (strict APIs reject it)", () => {
  const sigs = new Map([["tc9", "SIGabc"]]);
  const o = toOpenAI({ messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "tc9", name: "get", input: {} }] },
  ] }, "gpt-4o", { sigs });   // no opts.gemini
  assert.strictEqual(o.messages[0].tool_calls[0].extra_content, undefined);
});
