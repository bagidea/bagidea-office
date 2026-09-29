// Local "thinking" builds (LM Studio + Gemma/Qwen) can answer HTTP 200 with
// content "" and the whole reply in reasoning_content. The proxy used to map
// only content/tool_calls, so the turn ended as "(proxy: ... returned no content)".
// These tests pin: reasoning is surfaced ONLY when there is no usable content and
// no tool_calls; everything else is unchanged.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

// Redirect plog BEFORE requiring the proxy so tests never touch the live proxy.log.
const LOG = path.join(os.tmpdir(), `proxy-reasoning-test-${process.pid}.log`);
process.env.BAGIDEA_PROXY_LOG = LOG;
const { toAnthropic, pickText, handle } = require("../proxy");

const reply = (message, finish_reason = "stop") =>
  ({ id: "x", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason }] });
const readLog = () => { try { return fs.readFileSync(LOG, "utf8"); } catch { return ""; } };

test.after(() => { try { fs.unlinkSync(LOG); } catch {} });

test("1. content-only → one text block = content, end_turn", () => {
  const m = toAnthropic(reply({ content: "hello" }), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "hello" }]);
  assert.strictEqual(m.stop_reason, "end_turn");
});

test("2. reasoning-only (content \"\", finish stop) → one text block = reasoning", () => {
  const m = toAnthropic(reply({ content: "", reasoning_content: "  บทที่ 1 ป่าลึก  \n" }), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "บทที่ 1 ป่าลึก" }]);
  assert.strictEqual(m.stop_reason, "end_turn");
  assert.deepStrictEqual(Object.keys(m).sort(),
    ["content", "id", "model", "role", "stop_reason", "stop_sequence", "type", "usage"],
    "no new enumerable fields on the Anthropic message");
  assert.deepStrictEqual(pickText({ content: "", reasoning_content: "r" }), { text: "r", fromReasoning: true });
});

test("3. content AND reasoning → only content (reasoning not leaked)", () => {
  const m = toAnthropic(reply({ content: "answer", reasoning_content: "secret thoughts" }), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "answer" }]);
  assert.ok(!JSON.stringify(m).includes("secret thoughts"));
});

test("4. tool_calls-only (content null, reasoning present) → only tool_use blocks", () => {
  const m = toAnthropic(reply({ content: null, reasoning_content: "I should write the file",
    tool_calls: [{ id: "c1", type: "function", function: { name: "Write",
      arguments: '{"file_path":"a.txt","content":"x"}' } }] }, "tool_calls"), "m");
  assert.deepStrictEqual(m.content,
    [{ type: "tool_use", id: "c1", name: "Write", input: { file_path: "a.txt", content: "x" } }]);
  assert.strictEqual(m.stop_reason, "tool_use");
  assert.ok(!JSON.stringify(m).includes("I should write the file"));
});

test("5. both empty (no tools) → 0 blocks (handle() injects the proxy notice)", () => {
  assert.deepStrictEqual(toAnthropic(reply({ content: "", reasoning_content: "" }), "m").content, []);
  assert.deepStrictEqual(toAnthropic(reply({ content: "" }), "m").content, []);
  assert.deepStrictEqual(toAnthropic(reply({ content: null, reasoning_content: "   " }), "m").content, []);
  assert.deepStrictEqual(pickText({ content: "" }), { text: "", fromReasoning: false });
});

test("6. whitespace-only content + reasoning → reasoning surfaced", () => {
  const m = toAnthropic(reply({ content: " \n\t ", reasoning_content: "real reply" }), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "real reply" }]);
});

test("7. `reasoning` alias key is accepted", () => {
  const m = toAnthropic(reply({ content: "", reasoning: "alias reply" }), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "alias reply" }]);
});

test("whitespace-only content WITHOUT reasoning is passed through unchanged (as before)", () => {
  assert.deepStrictEqual(toAnthropic(reply({ content: "  " }), "m").content, [{ type: "text", text: "  " }]);
});

test("BAD-ARGS: invalid tool arguments still yield input {} and are logged (log-only)", () => {
  const bad = '{"file_path":"C:\\\\x.txt","content":"ป่า';   // truncated JSON
  const m = toAnthropic(reply({ content: null, tool_calls: [{ id: "c9", type: "function",
    function: { name: "Write", arguments: bad } }] }, "tool_calls"), "m");
  assert.deepStrictEqual(m.content, [{ type: "tool_use", id: "c9", name: "Write", input: {} }]);
  const log = readLog();
  assert.match(log, /BAD-ARGS Write \(sent \{\}\): \{"file_path"/);
});

// --- handle()-level: stub upstream, prove the SSE stream carries the reasoning --
function stubUpstream(body) {
  return new Promise((r) => {
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); });
    });
    srv.listen(0, "127.0.0.1", () => r(srv));
  });
}
function fakeRes() {
  const out = { status: 0, chunks: [], ended: false };
  return { out, writableEnded: false, on() {},
    writeHead(s) { out.status = s; }, write(c) { out.chunks.push(String(c)); },
    end(c) { if (c) out.chunks.push(String(c)); out.ended = true; this.writableEnded = true; } };
}
async function runHandle(upstreamBody, stream = true) {
  const srv = await stubUpstream(upstreamBody);
  try {
    const reg = { providerConfig: { lmstudio: { baseUrl: `http://127.0.0.1:${srv.address().port}/v1` } } };
    const res = fakeRes();
    const raw = JSON.stringify({ model: "gemma-test", stream, max_tokens: 100,
      messages: [{ role: "user", content: "write chapter 1" }] });
    await handle({}, res, "lmstudio", reg, raw);
    return res.out;
  } finally { srv.close(); }
}

test("handle(): reasoning-only upstream → SSE carries the reasoning text, no proxy notice", async () => {
  const out = await runHandle(reply({ content: "", reasoning_content: "บทที่ 1: ป่ากสิณ" }));
  const s = out.chunks.join("");
  assert.strictEqual(out.status, 200);
  assert.ok(out.ended);
  assert.ok(s.includes(JSON.stringify("บทที่ 1: ป่ากสิณ")), "reasoning text missing from SSE: " + s.slice(0, 400));
  assert.ok(!s.includes("returned no content"), "empty-reply notice must not be injected");
  assert.ok(readLog().includes(`REASONING-ONLY reply surfaced as text (${"บทที่ 1: ป่ากสิณ".length} chars)`));
});

test("handle(): truly empty upstream still injects the proxy notice (EMPTY path kept)", async () => {
  const out = await runHandle(reply({ content: "", reasoning_content: "" }));
  const s = out.chunks.join("");
  assert.ok(s.includes("(proxy: lmstudio/gemma-test returned no content — finish_reason=stop)"));
  assert.match(readLog(), /EMPTY body=/);
});

// --- R1 (SHINO 2026-09-27): reasoning cut at finish=length is never surfaced ----
test("R1-a. reasoning-only + finish length → no text block, stop_reason max_tokens", () => {
  const m = toAnthropic(reply({ content: "", reasoning_content: "Plan: first the forest, then..." }, "length"), "m");
  assert.deepStrictEqual(m.content, []);
  assert.strictEqual(m.stop_reason, "max_tokens");
  assert.ok(!JSON.stringify(m).includes("Plan: first the forest"));
});

test("R1-b. reasoning-only + finish stop → surfaced as before (c0d6c2d), end_turn", () => {
  const m = toAnthropic(reply({ content: "", reasoning_content: "full answer" }, "stop"), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "full answer" }]);
  assert.strictEqual(m.stop_reason, "end_turn");
});

test("R1-c. content present + finish length → content unchanged, stop_reason max_tokens", () => {
  const m = toAnthropic(reply({ content: "partial prose", reasoning_content: "thoughts" }, "length"), "m");
  assert.deepStrictEqual(m.content, [{ type: "text", text: "partial prose" }]);
  assert.strictEqual(m.stop_reason, "max_tokens");
});

test("R1-d. handle(): reasoning-only at length → no text at all (no notice), max_tokens, stream and JSON", async () => {
  const R = "I will now plan chapter 3b in detail";
  const body = reply({ content: "", reasoning_content: `  ${R}  ` }, "length");
  const sseOut = await runHandle(body, true);
  const s = sseOut.chunks.join("");
  assert.strictEqual(sseOut.status, 200);
  assert.ok(sseOut.ended);
  assert.ok(!s.includes("content_block_start"), "no content block may be streamed: " + s.slice(0, 400));
  assert.ok(!s.includes(R) && !s.includes("returned no content"));
  assert.ok(s.includes('"stop_reason":"max_tokens"'));
  assert.ok(s.includes("message_stop"));
  const jsonOut = await runHandle(body, false);
  const m = JSON.parse(jsonOut.chunks.join(""));
  assert.deepStrictEqual(m.content, []);
  assert.strictEqual(m.stop_reason, "max_tokens");
  const log = readLog();
  assert.ok(log.includes(`REASONING-ONLY at length: NOT surfaced (${R.length} chars dropped)`));
  assert.ok(!log.includes(`REASONING-ONLY reply surfaced as text (${R.length} chars)`));
});
