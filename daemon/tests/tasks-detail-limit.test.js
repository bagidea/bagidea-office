// Task detail limit over HTTP: POST /tasks and /tasks/update refuse a detail over
// 4000 characters with a JSON 400 (detail_too_long) instead of cutting it
// silently, change nothing on refusal, and keep every other error plain text.
//
// Same pattern as meetings.test.js: boot an ISOLATED copy of the daemon in a temp
// dir on a random port in 19000-19999 with an empty workspace, and kill it in
// `finally`. Live state files (registry, jobs, sessions, approvals, per-agent MCP
// configs, logs) are NOT copied — the copy starts from a stub registry.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { killTree } = require("../kill-tree");

const DAEMON_DIR = path.join(__dirname, "..");
const SKIP = /^(tests|registry\.json|jobs\.json|sessions\.json|approvals\.json|notifications\.json|notes\.json|calendar\.json|proposals\.json|projects\.json|paused\.json|stats\.json|journal\.jsonl|monitors?\.txt|mcp_.*\.json|.*\.log)$/;

function stubRegistry() {
  return {
    agents: { main: { name: "Main", role: "Director", prompt: "" }, ceo: { name: "CEO", role: "Owner", prompt: "" }, nida: { name: "Nida", role: "Engineer", prompt: "" } },
    apiKeys: {}, providerConfig: {}, roles: ["Director", "Engineer"], skills: {},
    tools: [], mcpServers: {}, places: {}, heartbeatMin: 0, socialMin: 0, proposalMin: 0
  };
}

async function bootIsolated() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "detail-limit-test-"));
  const dst = path.join(tmp, "daemon");
  await fs.promises.cp(DAEMON_DIR, dst, { recursive: true, filter: (src) => src === DAEMON_DIR || path.dirname(src) !== DAEMON_DIR || !SKIP.test(path.basename(src)) });
  fs.mkdirSync(path.join(tmp, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(dst, "registry.json"), JSON.stringify(stubRegistry()));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(dst, "server.js")], { env: { ...process.env, OEP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  const stop = () => { try { killTree(child); } catch {} try { child.kill(); } catch {} };
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("daemon did not boot: " + logs.join(""))), 30000);
      const on = (c) => { logs.push(c.toString()); if (/listening/.test(c.toString())) { clearTimeout(t); resolve(); } };
      child.stdout.on("data", on); child.stderr.on("data", on);
      child.on("exit", (code) => { clearTimeout(t); reject(new Error("daemon exited " + code + ": " + logs.join(""))); });
    });
  } catch (e) { stop(); throw e; }
  return { url: `http://127.0.0.1:${port}`, tmp, logs, stop };
}

function req(base, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(base + p, { method, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
      let d = ""; res.setEncoding("utf8"); res.on("data", (c) => d += c);
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, type: res.headers["content-type"] || "", data: j, text: d }); });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}

test("tasks detail limit over HTTP: R1-R4", async (t) => {
  const d = await bootIsolated();
  try {
    let id;
    await t.test("R1: POST /tasks detail 4001 → 400 JSON detail_too_long, no card", async () => {
      const r1 = await req(d.url, "POST", "/tasks", { title: "R1 too long", detail: "x".repeat(4001) });
      assert.strictEqual(r1.status, 400, r1.text);
      assert.match(r1.type, /application\/json/);
      assert.strictEqual(r1.data.error, "detail_too_long");
      assert.strictEqual(r1.data.field, "detail");
      assert.strictEqual(r1.data.limit, 4000);
      assert.strictEqual(r1.data.length, 4001);
      const l1 = await req(d.url, "GET", "/tasks");
      assert.ok(!l1.data.tasks.some((c) => c.title === "R1 too long"), "no card created");
    });
    await t.test("R2: POST /tasks detail 4000 → 200", async () => {
      const r2 = await req(d.url, "POST", "/tasks", { title: "R2 fits", detail: "x".repeat(4000) });
      assert.strictEqual(r2.status, 200, r2.text);
      assert.strictEqual(r2.data.detail.length, 4000);
      assert.strictEqual(r2.data.detailTruncated, undefined);
      id = r2.data.id;
    });
    await t.test("R3: POST /tasks/update title+detail 4001 → 400, title unchanged", async () => {
      const r3 = await req(d.url, "POST", "/tasks/update", { id, title: "R3 new title", detail: "x".repeat(4001) });
      assert.strictEqual(r3.status, 400, r3.text);
      assert.strictEqual(r3.data.error, "detail_too_long");
      const card = (await req(d.url, "GET", "/tasks")).data.tasks.find((c) => c.id === id);
      assert.strictEqual(card.title, "R2 fits", "title unchanged");
      assert.strictEqual(card.detail.length, 4000);
    });
    await t.test("R4: POST /tasks unknown owner → 400 plain text (unchanged)", async () => {
      const r4 = await req(d.url, "POST", "/tasks", { title: "R4", owner: "nobody-here" });
      assert.strictEqual(r4.status, 400);
      assert.strictEqual(r4.data, null, "body is not JSON");
      assert.match(r4.text, /unknown owner: nobody-here/);
      assert.ok(!/application\/json/.test(r4.type), "not a JSON content-type");
    });
  } finally {
    d.stop();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(d.tmp, { recursive: true, force: true }); } catch {}
  }
});
