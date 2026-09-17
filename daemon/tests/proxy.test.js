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

// --- system-role entries inside messages[] (Claude Code ≥ 2.1.2xx) --------------
// Strict chat templates (Qwen3.5+ on LM Studio / llama.cpp / Ollama) raise
// "System message must be at the beginning." for any system past index 0.
const noStraySystem = (o) => {
  o.messages.forEach((m, i) => assert.ok(i === 0 || m.role !== "system", `system at index ${i}: ` + JSON.stringify(o.messages)));
};

test("toOpenAI: mid-conversation system messages fold into the adjacent user turn", () => {
  const o = toOpenAI({ system: "TOP", messages: [
    { role: "user", content: "hi" },
    { role: "system", content: "Available agent types: claude" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "next" },
    { role: "system", content: "<total_tokens>99</total_tokens>" },
  ] }, "qwen");
  noStraySystem(o);
  assert.deepStrictEqual(o.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.strictEqual(o.messages[0].content, "TOP");
  assert.strictEqual(o.messages[1].content, "hi\n\n<system-reminder>\nAvailable agent types: claude\n</system-reminder>");
  assert.strictEqual(o.messages[3].content, "next\n\n<system-reminder>\n<total_tokens>99</total_tokens>\n</system-reminder>");
});

test("toOpenAI: leading system entries in messages[] join the top system prompt (one system at index 0)", () => {
  const o = toOpenAI({ system: [{ type: "text", text: "TOP" }], messages: [
    { role: "system", content: "S1" },
    { role: "system", content: [{ type: "text", text: "S2" }] },   // block form must not become an assistant turn
    { role: "user", content: "hi" },
  ] }, "qwen");
  noStraySystem(o);
  assert.deepStrictEqual(o.messages.map((m) => m.role), ["system", "user"]);
  assert.strictEqual(o.messages[0].content, "TOP\n\nS1\n\nS2");
  assert.strictEqual(o.messages[1].content, "hi");
});

test("toOpenAI: no top-level system → first system entry in messages[] becomes the system message", () => {
  const o = toOpenAI({ messages: [{ role: "system", content: "only" }, { role: "user", content: "hi" }] }, "qwen");
  assert.deepStrictEqual(o.messages, [{ role: "system", content: "only" }, { role: "user", content: "hi" }]);
});

test("toOpenAI: system after an assistant turn waits for the next user turn (prepended, order kept)", () => {
  const o = toOpenAI({ messages: [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
    { role: "system", content: "ctx" },
    { role: "user", content: [{ type: "text", text: "c" }, { type: "image", source: { type: "url", url: "http://x/i.png" } }] },
  ] }, "qwen");
  noStraySystem(o);
  assert.deepStrictEqual(o.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepStrictEqual(o.messages[2].content[0], { type: "text", text: "<system-reminder>\nctx\n</system-reminder>" });
  assert.strictEqual(o.messages[2].content[1].text, "c");
});

test("toOpenAI: system right after a tool result (the real LM Studio failure) → final user turn", () => {
  // Exact shape the office proxy sent on the turn after the first tool call.
  const o = toOpenAI({ system: "TOP", messages: [
    { role: "user", content: "<system-reminder>date</system-reminder>\n\nlist files" },
    { role: "system", content: "Available agent types for the Agent tool: claude" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "total 22" }] },
    { role: "system", content: [{ type: "text", text: "<total_tokens>14972048 tokens left</total_tokens>" }] },
  ] }, "qwen");
  noStraySystem(o);
  assert.deepStrictEqual(o.messages.map((m) => m.role), ["system", "user", "assistant", "tool", "user"]);
  assert.strictEqual(o.messages[0].content, "TOP");
  assert.ok(o.messages[1].content.endsWith("<system-reminder>\nAvailable agent types for the Agent tool: claude\n</system-reminder>"));
  assert.strictEqual(o.messages[3].tool_call_id, "t1");
  assert.strictEqual(o.messages[4].content, "<system-reminder>\n<total_tokens>14972048 tokens left</total_tokens>\n</system-reminder>");
});

test("toOpenAI: empty system entries are dropped", () => {
  const o = toOpenAI({ messages: [{ role: "user", content: "hi" }, { role: "system", content: "   " }] }, "qwen");
  assert.deepStrictEqual(o.messages, [{ role: "user", content: "hi" }]);
});

test("toOpenAI: pending system context preserves parallel tool replies and the input", () => {
  const input = { system: "TOP", messages: [
    { role: "user", content: "inspect" },
    { role: "assistant", content: [
      { type: "tool_use", id: "a", name: "read", input: {} },
      { type: "tool_use", id: "b", name: "read", input: {} },
    ] },
    { role: "system", content: "first context" },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "a", content: "A" },
      { type: "tool_result", tool_use_id: "b", content: "B" },
    ] },
    { role: "system", content: "second context" },
  ] };
  const before = structuredClone(input);
  const o = toOpenAI(input, "qwen");
  noStraySystem(o);
  assert.deepStrictEqual(o.messages.map((m) => m.role), ["system", "user", "assistant", "tool", "tool", "user"]);
  assert.deepStrictEqual(o.messages.slice(3, 5).map((m) => m.tool_call_id), ["a", "b"]);
  assert.strictEqual(o.messages[5].content, "<system-reminder>\nfirst context\n</system-reminder>\n\n<system-reminder>\nsecond context\n</system-reminder>");
  assert.deepStrictEqual(input, before);
  assert.deepStrictEqual(toOpenAI(input, "qwen"), o, "retries must not duplicate context");
});

test("toOpenAI: adjacent reminders preserve user images and text", () => {
  const input = { messages: [
    { role: "user", content: [
      { type: "text", text: "look" },
      { type: "image", source: { type: "url", url: "https://example.test/image.png" } },
    ] },
    { role: "system", content: [{ type: "text", text: "context" }] },
  ] };
  const before = structuredClone(input);
  const o = toOpenAI(input, "qwen");
  assert.deepStrictEqual(o.messages, [{ role: "user", content: [
    { type: "text", text: "look" },
    { type: "image_url", image_url: { url: "https://example.test/image.png" } },
    { type: "text", text: "<system-reminder>\ncontext\n</system-reminder>" },
  ] }]);
  assert.deepStrictEqual(input, before);
});

test("toOpenAI: pending context precedes the next string user turn", () => {
  const o = toOpenAI({ messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "system", content: "one" },
    { role: "system", content: "two" },
    { role: "user", content: "next" },
  ] }, "qwen");
  noStraySystem(o);
  assert.strictEqual(o.messages[2].content, "<system-reminder>\none\n</system-reminder>\n\n<system-reminder>\ntwo\n</system-reminder>\n\nnext");
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

test("upstreamFor: Atlas Cloud uses its API endpoint and provider token", () => {
  const u = upstreamFor("atlascloud", { providerConfig: { atlascloud: { token: "atlas-key" } } });
  assert.strictEqual(u.chat, "https://api.atlascloud.ai/v1/chat/completions");
  assert.strictEqual(u.models, "https://api.atlascloud.ai/v1/models");
  assert.strictEqual(u.key, "atlas-key");
  assert.strictEqual(u.fallbackModel, "openai/gpt-4.1-mini");
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
