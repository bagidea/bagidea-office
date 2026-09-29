// T2-b (REPORT-jojo-r9-300s-memleak-0313, Bug 2): a local brain's CLI spawn must not
// carry Claude Code's auto-memory (the "# auto memory" system prompt section and the
// AutoMem / AutoMemPinned attachments). Zero GPU: the CLI talks to a stub Anthropic
// endpoint on 127.0.0.1 that returns a canned reply and records every request body.
// The CLI runs from a cwd inside the app git root, where auto-memory would normally load.
// Control: the same spawn without localClientEnv shows the auto-memory content.
//
// Spawns the real `claude` CLI → skipped unless BAGIDEA_SLOW_LOCAL_TESTS=1.
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { localClientEnv } = require("../localclient");

const SLOW = process.env.BAGIDEA_SLOW_LOCAL_TESTS === "1";
const OUT_DIR = process.env.BAGIDEA_T2B_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "t2b-"));
const CLAUDE = process.env.BAGIDEA_CLAUDE_BIN || "claude";
const APP_ROOT = path.join(__dirname, "..", "..");   // inside the app git root
const REPLY = "T2B-REPLY-OK";

// Canned Anthropic Messages reply (SSE when the CLI streams, JSON otherwise).
function stub() {
  const bodies = [];
  const srv = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (req.method !== "POST" || !/\/v1\/messages(\?|$)/.test(req.url)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "stub" } }));
      }
      let b = {}; try { b = JSON.parse(raw); } catch {}
      bodies.push(b);
      const msg = { id: "msg_t2b", type: "message", role: "assistant", model: b.model || "local-test",
        content: [{ type: "text", text: REPLY }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 3 } };
      if (!b.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(msg)); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: REPLY } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } });
      ev("message_stop", {});
      res.end();
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, bodies })));
}
const killTree = (pid) => { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" }); } catch {} };
const sysText = (b) => typeof b.system === "string" ? b.system
  : (Array.isArray(b.system) ? b.system.map((x) => (x && x.text) || "").join("\n") : "");

async function runCase(name, withHelper) {
  const { srv, bodies } = await stub();
  let env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}`, ANTHROPIC_AUTH_TOKEN: "t2b-dummy" };
  for (const k of ["CLAUDE_CODE_DISABLE_AUTO_MEMORY", "ANTHROPIC_API_KEY"]) delete env[k];
  if (withHelper) env = localClientEnv(env, 540000);
  const cli = spawn(CLAUDE, ["-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config",
    "--model", "local-test", `Reply with exactly: ${REPLY}`], { cwd: APP_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  cli.stdout.on("data", (c) => { out += c; });
  cli.stderr.on("data", (c) => { err += c; });
  const guard = setTimeout(() => killTree(cli.pid), 150000);
  const exitCode = await new Promise((r) => cli.on("exit", r));
  clearTimeout(guard);
  if (srv.closeAllConnections) srv.closeAllConnections();
  await new Promise((d) => srv.close(d));
  let sid = null;
  for (const line of out.split(/\r?\n/)) { try { const j = JSON.parse(line); if (j.session_id) { sid = j.session_id; break; } } catch {} }
  let transcript = "";
  if (sid) {
    const root = path.join(os.homedir(), ".claude", "projects");
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, sid + ".jsonl");
      if (fs.existsSync(f)) { transcript = fs.readFileSync(f, "utf8"); break; }
    }
  }
  // Only the main turn (the one carrying our prompt) is judged; side calls are listed too.
  const main = bodies.filter((b) => JSON.stringify(b.messages || []).includes(REPLY));
  const sys = main.map(sysText).join("\n");
  const allReq = JSON.stringify(main);
  fs.writeFileSync(path.join(OUT_DIR, `${name}-requests.json`), JSON.stringify(bodies, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, `${name}-cli.jsonl`), out);
  fs.writeFileSync(path.join(OUT_DIR, `${name}-cli.stderr.txt`), err);
  if (transcript) fs.writeFileSync(path.join(OUT_DIR, `${name}-transcript.jsonl`), transcript);
  const summary = { name, withHelper, exitCode, sid, requests: bodies.length, mainRequests: main.length,
    systemChars: sys.length,
    sysHasAutoMemory: sys.includes("# auto memory"),
    requestHasAutoMemoryIndex: allReq.includes("auto-memory-index"),
    transcriptFound: !!transcript,
    transcriptHasAutoMemory: transcript.includes("# auto memory"),
    transcriptAutoMem: /"type":"AutoMem"/.test(transcript),
    transcriptAutoMemPinned: /"type":"AutoMemPinned"/.test(transcript),
    replyDelivered: out.includes(REPLY) };
  fs.writeFileSync(path.join(OUT_DIR, `${name}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(`[t2b] ${name}: ${JSON.stringify(summary)}`);
  return summary;
}

describe("T2-b local no auto-memory", { concurrency: 2 }, () => {
  test("T2-b: localClientEnv(540000) → no auto-memory in the prompt or transcript", { skip: !SLOW && "set BAGIDEA_SLOW_LOCAL_TESTS=1", timeout: 180000 }, async () => {
    const s = await runCase("fix", true);
    assert.strictEqual(s.exitCode, 0);
    assert.strictEqual(s.replyDelivered, true);
    assert.ok(s.mainRequests >= 1 && s.systemChars > 0, "stub recorded the main turn's system prompt");
    assert.strictEqual(s.sysHasAutoMemory, false, "no '# auto memory' in the system prompt");
    assert.strictEqual(s.requestHasAutoMemoryIndex, false, "no <auto-memory-index> in the request");
    assert.ok(s.transcriptFound, "transcript found");
    assert.strictEqual(s.transcriptHasAutoMemory, false);
    assert.strictEqual(s.transcriptAutoMem, false, "no AutoMem attachment");
    assert.strictEqual(s.transcriptAutoMemPinned, false, "no AutoMemPinned attachment");
  });

  test("T2-b control: without the helper the same spawn carries auto-memory", { skip: !SLOW && "set BAGIDEA_SLOW_LOCAL_TESTS=1", timeout: 180000 }, async () => {
    const s = await runCase("control", false);
    assert.strictEqual(s.exitCode, 0);
    assert.strictEqual(s.sysHasAutoMemory, true, "'# auto memory' present without the flag");
    assert.ok(s.transcriptAutoMem || s.requestHasAutoMemoryIndex, "AutoMem attachment / memory index present without the flag");
  });
});
