// T1-b (REPORT-jojo-r9-300s-memleak-0313, Bug 1): a local turn that is silent for
// 420 s must complete as ONE request when the CLI spawn carries localClientEnv(cap).
// Control: the same turn with the 545f733 env (the three ms limits, no Bun idle
// timeout) reproduces live T1-c 2026-09-27 — the native CLI's Bun HTTP client drops
// the socket at ~360 s (proxy logs "CLIENT-ABORT after 360s") and re-sends. The old
// 330 s hold sat under that clock, which is why this harness never reproduced it.
//
// Spawns the real `claude` CLI and takes ~8 min → skipped unless BAGIDEA_SLOW_LOCAL_TESTS=1.
// Never touches the live daemon (8787), LM Studio or the live proxy.log: each case runs
// its own harness child (this file with BAGIDEA_T1B_SERVE=1) = fake OpenAI upstream on a
// random 127.0.0.1 port + proxy.handle() mounted in-process on another random port,
// with an isolated registry (Custom localhost provider) and its own BAGIDEA_PROXY_LOG.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const REPLY = "T1B-REPLY-OK";
const PROVIDER = "t1blocal";

// ---- harness child -------------------------------------------------------------
if (process.env.BAGIDEA_T1B_SERVE === "1") {
  const HOLD_MS = Number(process.env.BAGIDEA_T1B_HOLD_MS) || 420000;
  const { handle } = require("../proxy");   // BAGIDEA_PROXY_LOG already set by the parent
  const upstream = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const t = setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "t1b", object: "chat.completion", model: "local-test",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: REPLY } }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
      }, HOLD_MS);
      res.on("close", () => clearTimeout(t));
    });
  });
  upstream.listen(0, "127.0.0.1", () => {
    const reg = { providerConfig: { [PROVIDER]: { baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, token: "x" } } };
    // Same mount as server.js: every POST /proxy/<p>... goes to proxy.handle().
    const front = http.createServer((req, res) => {
      if (req.method !== "POST" || !req.url.startsWith("/proxy/")) { res.writeHead(404); return res.end(); }
      const prov = (req.url.split("/")[2] || "").split("?")[0];
      const chunks = []; req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        handle(req, res, prov, reg, Buffer.concat(chunks).toString("utf8")).catch((e) => {
          try { if (!res.headersSent) { res.writeHead(502); } res.end(String(e && e.message)); } catch {}
        });
      });
    });
    front.listen(0, "127.0.0.1", () => {
      process.stdout.write(JSON.stringify({ port: front.address().port }) + "\n");
    });
  });
  return;
}

// ---- test process ----------------------------------------------------------------
const { test, describe } = require("node:test");
const assert = require("node:assert");
const { localClientEnv } = require("../localclient");

const SLOW = process.env.BAGIDEA_SLOW_LOCAL_TESTS === "1";
const OUT_DIR = process.env.BAGIDEA_T1B_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "t1b-"));
const CLAUDE = process.env.BAGIDEA_CLAUDE_BIN || "claude";

function startHarness(logFile, holdMs) {
  return new Promise((resolve, reject) => {
    const h = spawn(process.execPath, [__filename], {
      env: { ...process.env, BAGIDEA_T1B_SERVE: "1", BAGIDEA_PROXY_LOG: logFile, BAGIDEA_T1B_HOLD_MS: String(holdMs) },
      stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    h.stdout.on("data", (c) => { buf += c; const m = buf.match(/\{"port":(\d+)\}/); if (m) resolve({ h, port: Number(m[1]) }); });
    h.on("exit", (code) => reject(new Error("harness exited " + code)));
  });
}
const killTree = (pid) => { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" }); } catch {} };
const readLog = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
// A real API error, not the always-present "api_error_status":null result key.
const API_ERR = /"(?:sub)?type":"api_error"|Request timed out/;
const reqLines = (log) => log.split(/\r?\n/).filter((l) => new RegExp(`^\\[\\d\\d:\\d\\d:\\d\\d\\] ${PROVIDER} model=`).test(l));

// Env like server.js builds for a local brain behind /proxy/<p> (minus office keys).
function baseEnv(port) {
  const env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/proxy/${PROVIDER}`,
    ANTHROPIC_AUTH_TOKEN: "t1b-dummy" };
  for (const k of ["API_TIMEOUT_MS", "CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS", "CLAUDE_STREAM_IDLE_TIMEOUT_MS",
    "BUN_CONFIG_HTTP_IDLE_TIMEOUT", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "ANTHROPIC_API_KEY", "BAGIDEA_T1B_SERVE", "BAGIDEA_PROXY_LOG"]) delete env[k];
  return env;
}

// Runs one CLI turn; stopWhen(log) → true kills the CLI early (control case).
// withHelper: true = localClientEnv(540000); "noBun" = the same minus BUN_CONFIG_HTTP_IDLE_TIMEOUT.
async function runCase(name, withHelper, { stopWhen, maxMs }) {
  const logFile = path.join(OUT_DIR, `${name}-proxy.log`);
  try { fs.unlinkSync(logFile); } catch {}
  const { h, port } = await startHarness(logFile, Number(process.env.BAGIDEA_T1B_HOLD_MS) || 420000);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `t1b-${name}-cwd-`));
  let env = baseEnv(port);
  if (withHelper) env = localClientEnv(env, 540000);
  if (withHelper === "noBun") delete env.BUN_CONFIG_HTTP_IDLE_TIMEOUT;
  const t0 = Date.now();
  const cli = spawn(CLAUDE, ["-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config",
    "--model", "local-test", `Reply with exactly: ${REPLY}`], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "", killedEarly = false;
  cli.stdout.on("data", (c) => { out += c; });
  cli.stderr.on("data", (c) => { err += c; });
  const exitCode = await new Promise((resolve) => {
    const iv = setInterval(() => {
      if ((stopWhen && stopWhen(readLog(logFile))) || Date.now() - t0 > maxMs) {
        killedEarly = true; clearInterval(iv); killTree(cli.pid);
      }
    }, 1000);
    cli.on("exit", (code) => { clearInterval(iv); resolve(code); });
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  await new Promise((r) => setTimeout(r, 500));   // let the proxy flush its CLIENT-ABORT line
  killTree(h.pid);
  const log = readLog(logFile);
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
  fs.writeFileSync(path.join(OUT_DIR, `${name}-cli.jsonl`), out);
  fs.writeFileSync(path.join(OUT_DIR, `${name}-cli.stderr.txt`), err);
  if (transcript) fs.writeFileSync(path.join(OUT_DIR, `${name}-transcript.jsonl`), transcript);
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  const summary = { name, withHelper, exitCode, killedEarly, secs, sid, requestLines: reqLines(log),
    clientAbort: log.split(/\r?\n/).filter((l) => /CLIENT-ABORT/.test(l)),
    apiErrorInOutput: API_ERR.test(out), apiErrorInTranscript: API_ERR.test(transcript),
    transcriptFound: !!transcript, replyDelivered: out.includes(REPLY) };
  fs.writeFileSync(path.join(OUT_DIR, `${name}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(`[t1b] ${name}: ${JSON.stringify(summary)}`);
  return summary;
}

// The two cases run side by side (separate harnesses/logs) so the file takes ~8 min, not ~14.
describe("T1-b local client timeout", { concurrency: 2 }, () => {
test("T1-b: localClientEnv(540000) → a 420 s silent local turn completes as ONE request", { skip: !SLOW && "set BAGIDEA_SLOW_LOCAL_TESTS=1", timeout: 600000 }, async () => {
  const s = await runCase("fix", true, { maxMs: 510000 });
  assert.strictEqual(s.killedEarly, false, "CLI must finish on its own");
  assert.strictEqual(s.requestLines.length, 1, "exactly one request line: " + s.requestLines.join(" | "));
  assert.strictEqual(s.clientAbort.length, 0, "no CLIENT-ABORT: " + s.clientAbort.join(" | "));
  assert.strictEqual(s.apiErrorInOutput, false, "no api_error in CLI output");
  assert.ok(s.transcriptFound, "transcript found");
  assert.strictEqual(s.apiErrorInTranscript, false, "no api_error in transcript");
  assert.strictEqual(s.replyDelivered, true, "reply text delivered");
});

// Earlier "NOT REPRODUCED" (PROBE-EVIDENCE-T1b.md) held 330 s, under the ~360 s Bun clock.
// Stub repro with 450 s holds: workspace/tmp/jojo-360 (v-A/v-B/v-C all "CLIENT-ABORT after 359.7s").
test("T1-b control: 545f733 env without the Bun idle timeout drops at ~360 s and re-sends (T1-c repro)", { skip: !SLOW && "set BAGIDEA_SLOW_LOCAL_TESTS=1", timeout: 600000 }, async () => {
  // Kill the control CLI as soon as the second request line appears (do not let it retry on).
  const s = await runCase("control", "noBun", { stopWhen: (log) => reqLines(log).length >= 2, maxMs: 510000 });
  assert.strictEqual(s.killedEarly, true);
  assert.ok(s.requestLines.length >= 2, "second request line: " + s.requestLines.join(" | "));
  assert.ok(s.clientAbort.some((l) => /CLIENT-ABORT after 3[5-6]\ds/.test(l)), "CLIENT-ABORT after ~360s: " + s.clientAbort.join(" | "));
});
});
