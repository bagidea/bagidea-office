// 🐞 "แจ้งทีมพัฒนา" (report to the dev team) — daemon/report.js: redaction, the
// report itself, the capped GitHub link, the saved copy — plus the owner-UI-only
// routes behind the HIRE A TEAM popups (POST /teams/hire) and the report dialog
// (POST /reports/prepare), against a real daemon on developer C's port range.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const report = require("../report");

const ROOT = path.join(__dirname, "..", "..");
const DAEMON = path.join(ROOT, "daemon");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-report-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Pinned machine facts, so the redaction is the same on every test machine.
const ME = { username: "somchai", hostname: "DESKTOP-FAKE01", home: "" };
// Fake credentials are assembled at runtime so no scanner mistakes this file for a leak.
const fake = (prefix, n, ch = "Z") => prefix + ch.repeat(n);
const FAKE = {
  hf: fake("hf" + "_", 24, "X"),                         // the UI check injects the same shape
  sk: fake("sk" + "-proj-", 28, "q"),
  skLive: fake("sk" + "_live_", 24, "7"),
  aiza: fake("AI" + "za", 35, "b"),
  ghp: fake("gh" + "p_", 36, "c"),
  pat: fake("github" + "_pat_", 40, "d"),
  xox: "xo" + "xb-" + "1234567890-" + "e".repeat(20),
  jwt: "ey" + "JhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiJ0ZXN0In0." + "f".repeat(30),
  tg: "7000000001:" + "AA" + "g".repeat(33),
  aws: "AK" + "IA" + "H".repeat(16),
};

test("redact: every credential the registry holds, wherever it shows up", () => {
  const reg = {
    providerConfig: { openai: { token: FAKE.sk, connected: true }, glm: { token: "glm.fake.token.7777" }, lmstudio: { connected: true } },
    apiKeys: { HF_TOKEN: FAKE.hf, CIVITAI_API_KEY: "0123456789abcdef0123456789abcdef", SHORT: "abc" },
    channels: { telegram: { enabled: false, token: FAKE.tg, secret: "webhook-secret-zz" }, discord: { token: "discord.fake.bot.token" } },
    mcpServers: { svc: { command: "npx svc", env: { SVC_ENDPOINT_VALUE: "svc-env-value-123456" } } },
    semantic: { enabled: true, key: "CIVITAI_API_KEY" },   // NAMES a key → not a secret itself
  };
  const secrets = report.collectSecrets(reg);
  for (const v of [FAKE.sk, "glm.fake.token.7777", FAKE.hf, "0123456789abcdef0123456789abcdef", FAKE.tg, "webhook-secret-zz", "discord.fake.bot.token", "svc-env-value-123456"])
    assert.ok(secrets.includes(v), "collects " + v.slice(0, 8));
  assert.ok(!secrets.includes("abc") && !secrets.includes("CIVITAI_API_KEY"), "skips short values and key names");
  const text = `openai ${FAKE.sk} · glm glm.fake.token.7777 · civitai 0123456789abcdef0123456789abcdef\n` +
    `webhook-secret-zz discord.fake.bot.token env svc-env-value-123456 · ${JSON.stringify(reg.apiKeys)}`;
  const out = report.redactSecrets(text, { reg, ...ME });
  for (const v of secrets) assert.ok(!out.includes(v), "leaked " + v.slice(0, 8));
  assert.ok(out.includes("[REDACTED]"));
});

test("redact: well-known token shapes — hf_ / sk- / AIza / ghp_ / github_pat_ / xox / Bearer / JWT / telegram / AWS / key=value", () => {
  const cases = [
    [`Invalid token ${FAKE.hf} for model`, FAKE.hf, "hf_[REDACTED]"],
    [`OpenAI key ${FAKE.sk}`, FAKE.sk, "sk-[REDACTED]"],
    [`stripe ${FAKE.skLive}`, FAKE.skLive, "sk_[REDACTED]"],
    [`GEMINI ${FAKE.aiza} rejected`, FAKE.aiza, "AIza[REDACTED]"],
    [`git remote https://${FAKE.ghp}@github.com/x/y`, FAKE.ghp, "ghp_[REDACTED]"],
    [`token ${FAKE.pat}`, FAKE.pat, "github_pat_[REDACTED]"],
    [`slack ${FAKE.xox}`, FAKE.xox, "xoxb-[REDACTED]"],
    ["Authorization: Bearer abcDEF123456.ghiJKL-789", "abcDEF123456", "Bearer [REDACTED]"],
    [`cookie ${FAKE.jwt}`, FAKE.jwt, "[REDACTED-JWT]"],
    [`POST https://api.telegram.org/bot${FAKE.tg}/sendMessage`, FAKE.tg, "[REDACTED-BOT-TOKEN]"],
    [`aws ${FAKE.aws} denied`, FAKE.aws, "[REDACTED-AWS-KEY]"],
    ["HF_TOKEN=zzzzzzzzzzzz ./serve.sh", "zzzzzzzzzzzz", "HF_TOKEN=[REDACTED]"],
    ["client token=abcdefghijkl api_key: 'mnopqrstuvwx'", "abcdefghijkl", "token=[REDACTED]"],
    ["huggingface-cli login --token yyyyyyyyyyyy", "yyyyyyyyyyyy", "--token [REDACTED]"],
    ['{"apiKey":"k1k2k3k4k5k6","model":"x"}', "k1k2k3k4k5k6", '"apiKey":"[REDACTED]"'],
    ["GET https://x.example/v1?key=q1q2q3q4q5&alt=json", "q1q2q3q4q5", "?key=[REDACTED]&alt=json"],
    ["contact somchai.k@example.co.th", "somchai.k@example.co.th", "<email>"],
  ];
  for (const [input, secret, marker] of cases) {
    const out = report.redactSecrets(input, ME);
    assert.ok(!out.includes(secret), `leaked in: ${out}`);
    assert.ok(out.includes(marker), `expected ${marker} in: ${out}`);
  }
  assert.ok(!report.redactSecrets("client token=abcdefghijkl api_key: 'mnopqrstuvwx'", ME).includes("mnopqrstuvwx"));
});

test("redact: user names in Windows, Linux and macOS paths, this machine's user, home and host name", () => {
  const input = [
    "at C:\\Users\\somchai\\AppData\\Local\\bagidea\\server.js:10",
    "open D:/Users/John Smith/Desktop/notes.txt",
    '"cwd":"C:\\\\Users\\\\somchai\\\\bagidea-office"',
    "cache /home/somchai/.cache/huggingface and /mnt/c/Users/Somchai/x",
    "model /Users/somchai/Library/Caches/models",
    "[somchai@DESKTOP-FAKE01 ~]$ nvidia-smi — host DESKTOP-FAKE01.local",
    "profile at /sessions/abc-123/work/file.txt",
  ].join("\n");
  const out = report.redactSecrets(input, { ...ME, home: "/sessions/abc-123" });
  for (const leak of ["somchai", "Somchai", "John Smith", "DESKTOP-FAKE01", "abc-123"]) assert.ok(!out.includes(leak), `${leak} leaked:\n${out}`);
  for (const kept of ["C:\\Users\\<user>\\AppData", "D:/Users/<user>/Desktop", "C:\\\\Users\\\\<user>\\\\bagidea-office", "/home/<user>/.cache",
    "/mnt/c/Users/<user>/x", "/Users/<user>/Library", "<user>@<host>", "~/work/file.txt"]) assert.ok(out.includes(kept), `expected ${kept} in:\n${out}`);
});

test("redact: ordinary text survives, and a second pass changes nothing", () => {
  const plain = "max_num_batched_tokens=131072 MAX_TOKENS=4096 tokenizer='meta-llama/Llama-3' task-manager risk-assessment " +
    "Bearer token required · npx -y @playwright/mcp@latest --headed · node v22.1.0 · 12 / 18 agents · อ่านไฟล์ไม่ได้";
  assert.strictEqual(report.redactSecrets(plain, ME), plain);
  const once = report.redactSecrets(`${FAKE.hf} ${FAKE.sk} C:\\Users\\somchai\\x token=abcdefghijkl`, ME);
  assert.strictEqual(report.redactSecrets(once, ME), once);
  assert.strictEqual(report.redactSecrets("", ME), "");
  assert.strictEqual(report.redactSecrets(null, ME), "");
});

const sampleReport = (over = {}) => ({
  source: "hire-team", step: "จ้างทีม", error: "HTTP 500 · boom", context: report.cleanContext({ team: "dev-shop", n: 3, nested: { a: 1 }, fn() {} }),
  when: "2026-09-28T10:00:00.000Z", logName: "daemon.log", logMissing: false, logLines: ["[oep] http+ws listening :8787", "[teams] hired dev-shop"],
  env: { version: "1.7.0", os: "Windows_NT 10.0.26100", platform: "win32", arch: "x64", node: "v22.23.2", gpu: "NVIDIA GeForce RTX 4090 · 24564 MiB · 560.94" },
  ...over,
});

test("report: carries version, OS, Node, GPU, step, error, context and the log tail", () => {
  const r = sampleReport();
  assert.deepStrictEqual(r.context, { team: "dev-shop", n: "3", nested: '{"a":1}' });
  const md = report.buildReport(r);
  for (const s of ["Office: v1.7.0", "OS: Windows_NT 10.0.26100 (win32/x64)", "Node: v22.23.2", "GPU: NVIDIA GeForce RTX 4090", "**Step:** จ้างทีม",
    "`hire-team`", "HTTP 500 · boom", "- team: `dev-shop`", "daemon.log — last 2 lines", "[teams] hired dev-shop"]) assert.ok(md.includes(s), "report should contain: " + s);
  assert.strictEqual((md.match(/^```/gm) || []).length % 2, 0, "code fences balanced");
  assert.ok(!report.buildReport(sampleReport({ error: "a ``` b" })).includes("a ``` b"), "a fence inside the error cannot break out");
  assert.match(report.buildReport(sampleReport({ logMissing: true, logName: "daemon.log", logLines: [] })), /`daemon\.log` was not found/);
  assert.strictEqual(report.reportTitle(r), "[hire-team] จ้างทีม: HTTP 500 · boom");
});

test("issue link: always under 7000 characters; a cut body keeps the truncation note and closes its code block", () => {
  const short = report.issueUrl("t", "body");
  assert.strictEqual(short.truncated, false);
  assert.strictEqual(short.url, report.ISSUE_NEW + "?title=t&body=body");
  const note = "✂ Shortened — attach daemon/reports/x.md";
  const body = "### x\n\n```\n" + "ข้อผิดพลาดยาวมาก 🐞 ".repeat(800) + "\n```\n";
  const r = report.issueUrl("[hire-team] " + "ทีม".repeat(100), body, { note });
  assert.ok(r.truncated && r.url.length < 7000, "url length " + r.url.length);
  const decoded = new URL(r.url).searchParams.get("body");
  assert.strictEqual(decoded, r.body);
  assert.ok(decoded.endsWith("> " + note), "note at the end");
  assert.strictEqual((decoded.match(/^```/gm) || []).length % 2, 0, "fence closed");
  assert.ok(new URL(r.url).searchParams.get("title").length <= 140);
  // fitIssue drops log lines before it touches the error
  const rep = sampleReport({ logLines: Array.from({ length: 400 }, (_, i) => `line ${i} ` + "ล็อก".repeat(20)) });
  const fit = report.fitIssue("[t] x", (o) => report.buildReport(rep, o), { note });
  assert.ok(fit.truncated && fit.url.length < 7000);
  assert.ok(fit.body.includes("HTTP 500 · boom") && fit.body.includes(note));
});

test("prepareReport: saves the full redacted report under daemon/reports/ and trims only the link", async () => {
  const dir = tmp();
  const daemonDir = path.join(dir, "daemon");
  fs.mkdirSync(daemonDir);
  const log = Array.from({ length: 1000 }, (_, i) => `[${i}] step ${i} ` + (i % 100 === 7 ? `retry with ${FAKE.hf} from C:\\Users\\somchai\\bagidea` : "ok ".repeat(15)));
  fs.writeFileSync(path.join(daemonDir, "daemon.log"), "\x1b[32mcolour\x1b[0m\n" + log.join("\r\n") + "\n");
  const reg = { apiKeys: { OPENAI_API_KEY: "office-openai-key-999999" }, providerConfig: {}, channels: {} };
  const rep = await report.prepareReport({
    source: "hire-team", step: "จ้างทีม", context: { team: "dev-shop" },
    error: "HTTP 500 · boom office-openai-key-999999 " + FAKE.hf + "\n" + "stack line ข้อผิดพลาด\n".repeat(900),
  }, { reg, daemonDir, version: "1.7.0", gpu: "none detected (no nvidia-smi)", now: new Date(2026, 8, 28, 9, 5, 7), ...ME });
  assert.ok(rep.ok);
  assert.strictEqual(rep.id, "20260928-090507-hire-team");
  assert.strictEqual(rep.file, path.join(daemonDir, "reports", "20260928-090507-hire-team.md"));
  const full = fs.readFileSync(rep.file, "utf8");
  for (const leak of [FAKE.hf, "office-openai-key-999999", "somchai"]) {
    assert.ok(!full.includes(leak), "file leaks " + leak.slice(0, 8));
    assert.ok(!rep.body.includes(leak), "body leaks " + leak.slice(0, 8));
    assert.ok(!decodeURIComponent(rep.issueUrl).includes(leak), "link leaks " + leak.slice(0, 8));
  }
  assert.ok(full.includes("daemon.log — last 400 lines") && full.includes("[999] step 999") && !full.includes("[599] step"), "the saved file keeps the last 400 lines");
  assert.ok(!full.includes("\x1b[") && !full.includes("\r"), "ANSI colours and CRs stripped");
  assert.ok(rep.truncated && rep.issueUrl.length < 7000, "link " + rep.issueUrl.length);
  assert.ok(rep.body.includes("daemon/reports/20260928-090507-hire-team.md") && /Shortened to fit the link/.test(rep.body), "truncation note names the saved file");
  for (const s of ["Office: v1.7.0", "จ้างทีม", "HTTP 500 · boom", "team: `dev-shop`"]) assert.ok(rep.body.includes(s), "body has " + s);
  assert.strictEqual(rep.title, "[hire-team] จ้างทีม: HTTP 500 · boom [REDACTED] hf_[REDACTED]");
  // same second → a second file, never an overwrite
  const again = await report.prepareReport({ source: "hire-team" }, { daemonDir, version: "1.7.0", gpu: "-", now: new Date(2026, 8, 28, 9, 5, 7), ...ME });
  assert.strictEqual(again.id, "20260928-090507-hire-team-2");
  assert.ok(fs.existsSync(again.file) && fs.existsSync(rep.file));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("prepareReport: always the daemon.log tail (an unknown logSource is ignored), and a hostile source name", async () => {
  const dir = tmp();
  const daemonDir = path.join(dir, "daemon");
  fs.mkdirSync(daemonDir);
  fs.writeFileSync(path.join(daemonDir, "daemon.log"), "daemon line\n");
  const rep = await report.prepareReport({ source: "../../etc/passwd", step: "start", error: "CUDA out of memory", logSource: "../../etc/shadow", context: "nope" },
    { daemonDir, version: "1.7.0", gpu: "none", ...ME });
  assert.ok(rep.ok && !rep.truncated);
  assert.strictEqual(path.dirname(rep.file), path.join(daemonDir, "reports"));
  assert.match(rep.id, /-etcpasswd$/);
  assert.ok(rep.body.includes("daemon line"), "the daemon.log tail, whatever logSource says");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("wiring: overlay dialogs, the gated /reports/prepare route, and daemon/reports/ is gitignored", () => {
  const OVERLAY = fs.readFileSync(path.join(DAEMON, "overlay.html"), "utf8");
  for (const s of ["function askConfirm(", "function openReportDialog(", "window.bagReport = { open: openReportDialog }", "function hireTeamFlow(",
    '"/reports/prepare"', 'uiPost("/teams/hire"', 'NO_I18N.add("bagRepPreview")']) assert.ok(OVERLAY.includes(s), "overlay should contain: " + s);
  assert.ok(!/askConfirm\(tr\("จ้างทีมนี้ทั้งชุด\?"\)/.test(OVERLAY), "the old undefined-askConfirm hire path is gone");
  const SERVER = fs.readFileSync(path.join(DAEMON, "server.js"), "utf8");
  const at = SERVER.indexOf('req.method === "POST" && req.url === "/reports/prepare"');
  assert.ok(at > SERVER.indexOf('req.url === "/teams/hire"'), "route sits after /teams/hire");
  assert.ok(SERVER.slice(at, at + 700).includes('if (!req.headers["x-bagidea-ui"]) { res.writeHead(403); return res.end("human UI only"); }'), "owner-UI gate");
  assert.ok(!/^const .*require\("\.\/report"\)/m.test(SERVER), "report.js is required lazily, not at the top");
  assert.ok(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/).includes("daemon/reports/"));
});

// ---- the real daemon ------------------------------------------------------------------
test("integration: 403 without the UI header; /teams/hire hires once; /reports/prepare saves a redacted report", { timeout: 120000 }, async () => {
  const port = 19131 + Math.floor(Math.random() * 9);   // developer C's range (19130 is the UI harness)
  // Runtime files the daemon writes — snapshot them and put them back afterwards.
  const keep = ["daemon/registry.json", "daemon/journal.jsonl", "daemon/notifications.json", "workspace/.claude/settings.json"].map((p) => path.join(ROOT, p));
  const saved = keep.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  const OFFICE_KEY = "zz-office-service-key-4242", TG = "zz-telegram-bot-token-4242";
  fs.writeFileSync(keep[0], JSON.stringify({ agents: {}, autoPilot: false, triggers: [], lang: "en",
    apiKeys: { ZZ_TEST_SERVICE_KEY: OFFICE_KEY }, channels: { telegram: { enabled: false, token: TG } } }));
  const d = spawn(process.execPath, [path.join(DAEMON, "server.js")], { env: { ...process.env, OEP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  d.stdout.on("data", (c) => logs.push(String(c)));
  d.stderr.on("data", (c) => logs.push(String(c)));
  const exited = new Promise((r) => d.on("exit", r));
  const made = [];
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body, ui = true) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ui ? { "x-bagidea-ui": "1" } : {}) }, body: JSON.stringify(body || {}) });
  try {
    let up = false;
    for (const t0 = Date.now(); !up && Date.now() - t0 < 40000;) { try { up = (await fetch(base + "/health")).ok; } catch {} if (!up) await sleep(300); }
    assert.ok(up, "daemon did not boot:\n" + logs.join("").slice(-2000));

    // POST /teams/hire — owner UI only, hires the missing agents once, never overwrites
    let r = await post("/teams/hire", { id: "research-lab" }, false);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(await r.text(), "human UI only");
    const before = await (await fetch(base + "/teams")).json();
    const lab = before.teams.find((t) => t.id === "research-lab");
    assert.ok(lab && lab.agents.length && lab.agents.every((a) => !a.present), "fresh office: nobody from the lab yet");
    r = await post("/teams/hire", { id: "research-lab" });
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.strictEqual(j.ok, true);
    assert.deepStrictEqual(j.hired.slice().sort(), lab.agents.map((a) => a.id).sort());
    assert.deepStrictEqual(j.skipped, []);
    assert.strictEqual(j.staff, before.staff + lab.agents.length);
    assert.strictEqual(j.max, before.max);
    const after = await (await fetch(base + "/teams")).json();
    assert.ok(after.teams.find((t) => t.id === "research-lab").agents.every((a) => a.present));
    const again = await (await post("/teams/hire", { id: "research-lab" })).json();
    assert.deepStrictEqual(again.hired, []);
    assert.ok(again.skipped.length === lab.agents.length && again.skipped.every((s) => s.why === "exists"));
    r = await post("/teams/hire", { id: "no-such-team" });
    assert.strictEqual(r.status, 400);
    assert.match(await r.text(), /no such team template/);

    // POST /reports/prepare — owner UI only, saves under daemon/reports/, redacts
    r = await post("/reports/prepare", { source: "hire-team", error: "x" }, false);
    assert.strictEqual(r.status, 403);
    r = await post("/reports/prepare", { source: "hire-team", step: "จ้างทีม", context: { team: "research-lab" },
      error: `HTTP 500 · boom ${FAKE.hf} ${OFFICE_KEY} ${TG} at C:\\Users\\somchai\\bagidea and /home/somchai/x` });
    assert.strictEqual(r.status, 200);
    const rep = await r.json();
    made.push(rep.file);
    assert.ok(rep.ok && rep.file.startsWith(path.join(DAEMON, "reports") + path.sep) && fs.existsSync(rep.file), "saved " + rep.file);
    assert.match(rep.id, /^\d{8}-\d{6}-hire-team(-\d+)?$/);
    const full = fs.readFileSync(rep.file, "utf8");
    for (const leak of [FAKE.hf, OFFICE_KEY, TG, "somchai"]) {
      assert.ok(!rep.body.includes(leak) && !full.includes(leak) && !decodeURIComponent(rep.issueUrl).includes(leak), "leaked " + leak.slice(0, 8));
    }
    assert.ok(rep.body.includes("hf_[REDACTED]") && rep.body.includes("C:\\Users\\<user>\\bagidea"));
    for (const s of ["จ้างทีม", "`hire-team`", "team: `research-lab`", "Node: " + process.version]) assert.ok(rep.body.includes(s), "body has " + s);
    assert.match(rep.body, /Office: v\d+\.\d+\.\d+/);
    assert.ok(rep.issueUrl.startsWith(report.ISSUE_NEW + "?title=") && rep.issueUrl.length < 7000);
    r = await fetch(base + "/reports/prepare", { method: "POST", headers: { "x-bagidea-ui": "1" }, body: "{not json" });
    assert.strictEqual(r.status, 400);
  } finally {
    d.kill("SIGTERM");
    await Promise.race([exited, sleep(10000)]);
    keep.forEach((f, i) => { if (saved[i]) fs.writeFileSync(f, saved[i]); else fs.rmSync(f, { force: true }); });
    for (const f of made) if (f) fs.rmSync(f, { force: true });
  }
});
