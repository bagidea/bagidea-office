// 🛠 DEV MODE — real tests (no placeholders).
//   (a) daemon/devmode.js unit tests
//   (b) overlay.html: the actual redactSecrets / devLog* / addToolRow /
//       Clear+Export sources lifted into node:vm with a minimal fake DOM
//   (c) live daemon (127.0.0.1:8787) — skipped when the daemon is down;
//       always restores the previous devMode value
//   (d) i18n completeness: inline DICT + 13 seed files, 14 languages
//   (e) toggle-handler / roster.sync state transitions
//   (f) feed-mode CSS rule parsed, not grepped
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const crypto = require("node:crypto");

const DAEMON = path.join(__dirname, "..");
const OVERLAY = path.join(DAEMON, "overlay.html");
const SEED_DIR = path.join(DAEMON, "i18n-seed");
const html = fs.readFileSync(OVERLAY, "utf8");
const serverSrc = fs.readFileSync(path.join(DAEMON, "server.js"), "utf8");
const devmode = require("../devmode");

const LANGS = ["en", "zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr", "ko", "id", "vi"]; // + th (source)
const DEV_MODE_KEYS = [
  "🛠 DEV MODE — โหมดนักพัฒนา: แสดงแผงละเอียด พร้อม scroll bar บันทึกงานแบบเต็มรูปแบบ สำหรับการดีบักและตรวจสอบงานรายละเอียด",
  "🛠 เปิด Dev Mode — แผงละเอียดและ scroll bar พร้อมใช้งาน",
  "🛠 ปิด Dev Mode — กลับมาสู่โหมดปกติ",
  "🛠 แผงดีบัก DEV MODE",
  "📊 สตรีมเหตุการณ์",
  "🔧 การเรียกใช้เครื่องมือ",
  "📨 ข้อความจาก agent",
  "⚡ ประสิทธิภาพ",
  "🧹 ล้าง Log ทั้งหมด",
  "📤 ส่งออก Log",
  "❌ เปิด/ปิด Dev Mode ไม่สำเร็จ:",
  "🧹 ล้าง Dev Mode log แล้ว",
  "ไม่มี log ให้ส่งออก",
  "📤 คัดลอก Dev Mode log ไปที่คลิปบอร์ดแล้ว",
  "📥 ดาวน์โหลด Dev Mode log แล้ว",
  "ไม่มีรายละเอียดที่บันทึกไว้สำหรับการเรียกนี้",
];

const RAW_KEY = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
// Dev Mode redaction is a FULL replacement: every secret → the fixed "••••••".
const RAW_KEY_MASK = "••••••";
// The Office Settings modal (NOT a Dev Mode path) keeps its first-8 + last-4
// key-recognition form so the owner can tell which key is configured.
const SETTINGS_KEY_FORM = "sk-abcde••••••6789";

// ------------------------------------------------------------ (a) devmode.js
test("devmode: nested objects/arrays — secret keys masked, innocent keys kept", () => {
  const input = {
    command: "echo hi",
    api_key: RAW_KEY,
    apiKey: "short",
    headers: { Authorization: "Bearer " + RAW_KEY, "x-api-key": RAW_KEY, "content-type": "json" },
    list: [{ password: "p@ssw0rd-long-enough" }, { name: "ok", refresh_token: "r".repeat(30) }],
    usage: { input_tokens: 123, output_tokens: 45, max_tokens: 8000 },
    credentials: { user: "bob", nested: { anything: "value-under-credentials" } },
    cookie: "session=abc", "set-cookie": "a=b",
    client_secret: "cs", private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg", passwd: "pw12345678901234",
  };
  const before = JSON.stringify(input);
  const r = devmode.redactSecrets(input);
  assert.strictEqual(JSON.stringify(input), before, "input must not be mutated");
  assert.strictEqual(r.command, "echo hi");
  assert.strictEqual(r.api_key, RAW_KEY_MASK);
  assert.strictEqual(r.apiKey, "••••••", "short secrets get the same fixed placeholder (not length-revealing)");
  assert.ok(!r.headers.Authorization.includes(RAW_KEY), "Authorization header masked");
  assert.strictEqual(r.headers.Authorization, "••••••", "value under a secret key: whole value replaced, scheme word included");
  assert.strictEqual(r.headers["x-api-key"], RAW_KEY_MASK);
  assert.strictEqual(r.headers["content-type"], "json");
  assert.strictEqual(r.list[0].password, "••••••");
  assert.strictEqual(r.list[1].name, "ok");
  assert.strictEqual(r.list[1].refresh_token, "••••••");
  assert.deepStrictEqual(r.usage, { input_tokens: 123, output_tokens: 45, max_tokens: 8000 }, "token COUNTS are not secrets");
  assert.strictEqual(r.credentials.user, "••••••", "every leaf under a credentials key is masked");
  assert.strictEqual(r.credentials.nested.anything, "••••••");
  assert.strictEqual(r.cookie, "••••••");
  assert.strictEqual(r["set-cookie"], "••••••");
  assert.strictEqual(r.client_secret, "••••••");
  assert.strictEqual(r.private_key, "••••••", "private key body fully replaced");
  assert.ok(!r.private_key.includes("MIIEvQIBADANBg") && !r.private_key.includes("BEGIN"));
  assert.strictEqual(r.passwd, "••••••");
  // forced (under a secret key) non-string leaves are replaced too
  assert.deepStrictEqual(devmode.redactSecrets({ credentials: { port: 5432, ok: true, big: 10n } }), { credentials: { port: "••••••", ok: "••••••", big: "••••••" } });
  assert.strictEqual(devmode.mask(""), ""); assert.strictEqual(devmode.mask(null), ""); assert.strictEqual(devmode.mask(undefined), "");
  for (const k of ["api_key", "apikey", "api-key", "apiKey", "authorization", "bearer", "token", "access_token",
    "refresh_token", "password", "passwd", "secret", "client_secret", "private_key", "credential", "credentials",
    "cookie", "set-cookie", "x-api-key", "Authorization", "ACCESS_TOKEN", "authToken", "clientSecret"])
    assert.ok(devmode.isSecretKey(k), k + " must be a secret key");
  for (const k of ["input_tokens", "max_tokens", "tokens", "keyboard", "tokenizer", "secretary", "name", "command", "file_path"])
    assert.ok(!devmode.isSecretKey(k), k + " must NOT be a secret key");
});

test("devmode: circular references, depth and breadth limits, long strings", () => {
  const a = { name: "a" }; a.self = a; a.arr = [a];
  const r = devmode.redactSecrets(a);
  assert.strictEqual(r.self, "<circular>");
  assert.strictEqual(r.arr[0], "<circular>");
  // depth: 12 nested levels → cut at depth > 10
  let deep = { v: "leaf" }; for (let i = 0; i < 12; i++) deep = { d: deep };
  let cur = devmode.redactSecrets(deep), levels = 0;
  while (cur && typeof cur === "object" && "d" in cur) { cur = cur.d; levels++; }
  assert.strictEqual(cur, "<max-depth>");
  assert.strictEqual(levels, devmode.MAX_DEPTH + 1, "objects at depth 0..10 are expanded, depth 11 is cut");
  // breadth: 150 items / 150 keys → 100 + marker
  const arr = devmode.redactSecrets(Array.from({ length: 150 }, (_, i) => i));
  assert.strictEqual(arr.length, 101); assert.strictEqual(arr[100], "<+50 more>");
  const wide = {}; for (let i = 0; i < 150; i++) wide["k" + i] = i;
  const rw = devmode.redactSecrets(wide);
  assert.strictEqual(Object.keys(rw).length, 101); assert.strictEqual(rw["<more>"], "+50 keys");
  // strings: > 1024 truncated, WITH the secret masked before the cut
  const long = "Authorization: Bearer " + RAW_KEY + " " + "x".repeat(5000);
  const rs = devmode.redactSecrets(long);
  assert.ok(rs.startsWith("Authorization: Bearer " + RAW_KEY_MASK + " x"), rs.slice(0, 80));
  assert.ok(!rs.includes(RAW_KEY));
  assert.ok(rs.endsWith("…<truncated>"));
  assert.strictEqual(rs.length, devmode.MAX_STRING + "…<truncated>".length);
  // odd values
  assert.strictEqual(devmode.redactSecrets(null), null);
  assert.strictEqual(devmode.redactSecrets(undefined), undefined);
  assert.strictEqual(devmode.redactSecrets(42), 42);
  assert.strictEqual(devmode.redactSecrets(true), true);
  assert.strictEqual(devmode.redactSecrets(() => 1), "<function>");
  assert.strictEqual(devmode.redactSecrets(Buffer.from("abc")), "<binary 3 bytes>");
});

test("devmode: bearer / sk- / key=value tokens are masked inside innocent strings", () => {
  // [input, raw secret, EXACT expected output]
  const cases = [
    ["curl -H 'Authorization: Bearer " + RAW_KEY + "' https://x", RAW_KEY, "curl -H 'Authorization: ••••••' https://x"],
    ["export OPENAI_KEY=" + RAW_KEY, RAW_KEY, "export OPENAI_KEY=••••••"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==", "dXNlcjpwYXNzd29yZDEyMw==", "Authorization: Basic ••••••"],
    ["https://api?api_key=ABCDEFGHIJKLMNOP&x=1", "ABCDEFGHIJKLMNOP", "https://api?api_key=••••••&x=1"],
    ["password: hunter2hunter2hunter2", "hunter2hunter2hunter2", "password: ••••••"],
    ["token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", "token=••••••"],
    ["xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij", "••••••"],
  ];
  for (const [s, raw, expected] of cases) {
    const out = devmode.redactSecrets({ command: s }).command;
    assert.ok(!out.includes(raw), "raw secret leaked: " + out);
    assert.strictEqual(out, expected);
  }
  // innocent text untouched
  assert.strictEqual(devmode.redactSecrets("git status && npm test").toString(), "git status && npm test");
  assert.strictEqual(devmode.redactSecrets("max_tokens=8000 input_tokens: 12").toString(), "max_tokens=8000 input_tokens: 12");
});

test("devmode: toolDetail for Bash / PowerShell / Skill / Read / Grep / Agent / unknown", () => {
  let d = devmode.toolDetail("Bash", { command: "curl -H 'Authorization: Bearer " + RAW_KEY + "' https://x\nsecond line", description: "x" });
  assert.strictEqual(d.kind, "command");
  assert.ok(d.detail.includes(RAW_KEY_MASK) && !d.detail.includes(RAW_KEY));
  assert.ok(d.detail.includes("\nsecond line"));
  assert.ok(d.label.startsWith("curl -H") && !d.label.includes("\n") && d.label.length <= 60);
  d = devmode.toolDetail("PowerShell", { command: "Get-Process" });
  assert.deepStrictEqual(d, { kind: "command", label: "Get-Process", detail: "Get-Process" });
  d = devmode.toolDetail("Skill", { skill: "code-review", args: "--strict" });
  assert.deepStrictEqual(d, { kind: "skill", label: "code-review", detail: "code-review --strict" });
  d = devmode.toolDetail("Read", { file_path: "C:\\proj\\daemon\\server.js", limit: 10 });
  assert.deepStrictEqual(d, { kind: "file", label: "server.js", detail: "C:\\proj\\daemon\\server.js" });
  d = devmode.toolDetail("Grep", { pattern: "devMode", path: "daemon/" });
  assert.deepStrictEqual(d, { kind: "search", label: "devMode", detail: "devMode  in daemon/" });
  d = devmode.toolDetail("Agent", { description: "Explore tests", prompt: "long prompt" });
  assert.strictEqual(d.kind, "tool"); assert.strictEqual(d.detail, "Explore tests");
  d = devmode.toolDetail("mcp__foo__bar", { url: "https://h", api_key: RAW_KEY });
  assert.strictEqual(d.kind, "tool"); assert.strictEqual(d.label, "");
  assert.ok(d.detail.includes('"api_key": "' + RAW_KEY_MASK + '"') && !d.detail.includes(RAW_KEY));
  assert.ok(d.detail.includes('"url": "https://h"'));
  d = devmode.toolDetail("Bash", { command: "x".repeat(5000) });
  assert.strictEqual(d.detail.length, devmode.MAX_DETAIL);
  assert.ok(d.detail.endsWith("…"));
  assert.deepStrictEqual(devmode.toolDetail("Whatever", null), { kind: "tool", label: "", detail: "" });
});

test("devmode: task.progress payload carries input/detail ONLY when devMode is true", () => {
  const base = { type: "task.progress", agent: "jeje", task: "t1", tool: "Bash", session: "s1" };
  const input = { command: "curl -H 'Authorization: Bearer " + RAW_KEY + "'", api_key: RAW_KEY };
  const off = devmode.progressEvent(base, input, false);
  assert.deepStrictEqual(off, base);
  assert.deepStrictEqual(devmode.progressEvent(base, input, undefined), base);
  assert.deepStrictEqual(devmode.progressEvent(base, input, "true"), base, "only boolean true enables");
  const on = devmode.progressEvent(base, input, true);
  assert.strictEqual(on.type, "task.progress"); assert.strictEqual(on.tool, "Bash"); assert.strictEqual(on.session, "s1");
  assert.strictEqual(on.kind, "command");
  assert.ok(on.detail.includes(RAW_KEY_MASK) && !on.detail.includes(RAW_KEY));
  assert.strictEqual(on.input.api_key, RAW_KEY_MASK);
  assert.ok(!JSON.stringify(on).includes(RAW_KEY), "no raw secret anywhere in the live frame");
  assert.ok(!("input" in base) && !("detail" in base), "base is not mutated");
  assert.deepStrictEqual(devmode.progressEvent(base, undefined, true), { ...base, kind: "command" }, "no input → no input/detail keys (kind still classified)");
});

test("server.js: tool_use branch uses devmode.progressEvent gated on reg.devMode and journals the plain event", () => {
  assert.match(serverSrc, /const devmode = require\("\.\/devmode"\);/);
  const i = serverSrc.indexOf('if (b.type === "tool_use") {');
  assert.ok(i > 0);
  const branch = serverSrc.slice(i, i + 1200);
  assert.match(branch, /entry\.log\.push\(\{ who: "tool", text: b\.name, ts: Date\.now\(\) \}\);/, "session history stays name-only");
  assert.match(branch, /const progress = \{ type: "task\.progress", agent, task, tool: b\.name,\s*session: entry\.key \};/);
  assert.match(branch, /broadcast\(devmode\.progressEvent\(progress, b\.input, reg\.devMode === true\), progress\);/);
  assert.ok(!/entry\.log\.push\([^)]*b\.input/.test(branch), "b.input never goes into entry.log");
  // broadcast() also accepts a lean event for every persisted output.
  assert.match(serverSrc, /const persistedJson = journal && journal !== true\s*\? JSON\.stringify\(\{ \.\.\.journal, ts: evt\.ts \}\) : json;/);
});

test("server.js: ghost tool progress has the same Dev Mode enrichment and plain journal payload", () => {
  const i = serverSrc.indexOf('const progress = { type: "subagent.progress"');
  assert.ok(i > 0, "ghost tool progress is defined");
  const branch = serverSrc.slice(i, i + 400);
  assert.match(branch, /agent: parentId, sub: subId,\s*tool: b\.name, session: entry\.key \}/);
  assert.match(branch, /broadcast\(devmode\.progressEvent\(progress, b\.input, reg\.devMode === true\), progress\);/);
});

function bootBroadcast() {
  const source = serverSrc.match(/function broadcast\(evt, journal = true\) \{[\s\S]*?\r?\n\}/);
  assert.ok(source, "could not extract broadcast from server.js");
  const writes = [], output = [], clients = [[], []], hooks = [], timestamp = 123456789;
  const sandbox = {
    fs: { appendFile(file, data, done) { writes.push({ file, data }); done(); } },
    JOURNAL: "test-journal.jsonl",
    Date: { now: () => timestamp },
    wsFrame: (json) => json,
    wsClients: clients.map((frames) => ({ write(frame) { frames.push(frame); } })),
    console: { log(...args) { output.push(args); }, error() { throw new Error("unexpected broadcast hook failure"); } },
    onBroadcastHook: (event) => hooks.push(event),
  };
  vm.runInNewContext(source[0] + "; globalThis.send = broadcast;", sandbox, { filename: "server-broadcast.js" });
  return { send: sandbox.send, writes, output, clients, hooks, timestamp };
}

test("server.js: main and ghost Dev Mode details reach WebSockets while journal and stdout receive only plain progress", () => {
  for (const type of ["task.progress", "subagent.progress"]) {
    const b = bootBroadcast();
    const plain = { type, agent: "main", tool: "Bash", session: "s1" };
    if (type === "subagent.progress") plain.sub = "main#ghost"; else plain.task = "t1";
    const enriched = devmode.progressEvent(plain, { command: "echo debug-only-body", api_key: RAW_KEY }, true);
    b.send(enriched, plain);
    for (const frames of b.clients) {
      assert.strictEqual(frames.length, 1);
      const live = JSON.parse(frames[0]);
      assert.strictEqual(live.input.command, "echo debug-only-body");
      assert.strictEqual(live.input.api_key, RAW_KEY_MASK);
      assert.strictEqual(live.detail, "echo debug-only-body");
      assert.strictEqual(live.ts, b.timestamp);
      assert.ok(!frames[0].includes(RAW_KEY));
    }
    const persisted = { ...plain, ts: b.timestamp };
    assert.strictEqual(b.writes.length, 1);
    assert.strictEqual(b.writes[0].file, "test-journal.jsonl");
    assert.strictEqual(b.writes[0].data, JSON.stringify(persisted) + "\n");
    assert.deepStrictEqual(b.output, [["[oep] →", JSON.stringify(persisted)]], "stdout must use the same lean event as the journal");
    assert.ok(!JSON.stringify(b.writes).includes("debug-only-body") && !JSON.stringify(b.output).includes("debug-only-body"));
    assert.strictEqual(plain.ts, undefined, "the plain journal variant is not mutated");
    assert.strictEqual(b.hooks[0], enriched, "live trigger hooks retain the live event");
  }
});

test("server.js: broadcast preserves default, true and false journal behavior and quiet world.pos stdout", () => {
  for (const journal of [undefined, true, false]) {
    const b = bootBroadcast(), event = { type: "chat.message", agent: "main", text: "hello" };
    b.send(event, journal);
    const serialized = JSON.stringify({ ...event, ts: b.timestamp });
    assert.strictEqual(b.writes.length, journal === false ? 0 : 1);
    if (journal !== false) assert.strictEqual(b.writes[0].data, serialized + "\n");
    assert.deepStrictEqual(b.output, [["[oep] →", serialized]], "journal=false still preserves console output");
    assert.ok(b.clients.every((frames) => frames.length === 1 && frames[0] === serialized));
    assert.strictEqual(b.hooks[0], event);
  }
  const b = bootBroadcast();
  b.send({ type: "world.pos", agents: [] }, false);
  assert.strictEqual(b.output.length, 0);
  assert.strictEqual(b.writes.length, 0);
  assert.ok(b.clients.every((frames) => frames.length === 1), "quiet position updates still reach WebSockets");
});

// ------------------------------------------------- (b) overlay.html in node:vm
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this._html = ""; this._text = ""; this.className = ""; this.style = {}; this.scrollTop = 0;
    this.clicks = 0; this.disabled = false; this.id = ""; this.open = false; this.attributes = {};
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + " " + c).trim(); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle: (c, force) => { const on = force === undefined ? !self.classList.contains(c) : !!force; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
    };
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get scrollHeight() { return this.children.length * 10; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  prepend(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.unshift(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i < 0) throw new Error("not a child"); this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(c) {
    if (!this.parentNode) return;
    const parent = this.parentNode, i = parent.children.indexOf(this);
    if (c.parentNode) c.parentNode.removeChild(c);
    parent.children[i] = c; c.parentNode = parent; this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  querySelectorAll(selector) {
    const matches = (e) => selector.startsWith(".") ? e.classList.contains(selector.slice(1))
      : selector.startsWith("#") ? e.id === selector.slice(1) : e.tagName === selector.toUpperCase();
    return this.children.flatMap((c) => [...(matches(c) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(v) { this._html = String(v); this._text = ""; this.children = []; }
  get innerHTML() { return this._html + this.children.map((c) => c.outerHTML).join(""); }
  set textContent(v) { this._text = String(v); this._html = ""; this.children = []; }
  get textContent() { return this._text + stripTags(this._html) + this.children.map((c) => c.textContent).join(""); }
  get outerHTML() { return `<${this.tagName.toLowerCase()} class="${this.className}">${this._text}${this.innerHTML}</${this.tagName.toLowerCase()}>`; }
  click() { this.clicks++; if (typeof this.onclick === "function") return this.onclick({ currentTarget: this, preventDefault() {} }); }
}
function makeDom() {
  const byId = new Map(), created = [];
  const document = {
    createElement: (t) => { const e = new FakeEl(t); created.push(e); return e; },
    getElementById: (id) => byId.get(id) || null,
    body: new FakeEl("body"),
  };
  const add = (id, tag = "div") => { const e = new FakeEl(tag); e.id = id; byId.set(id, e); document.body.appendChild(e); return e; };
  for (const id of ["log", "devEventLog", "devToolLog", "devAgentLog", "devPerfLog", "devModeTitle", "devModePanel", "compName", "compRole", "compBody", "liveBtn"]) add(id);
  add("devClearLogs", "button"); add("devExportLogs", "button");
  return { document, byId, created, add };
}
function slice(re, label) {
  const m = html.match(re);
  assert.ok(m, "could not extract " + label + " from overlay.html");
  return m[0];
}
// Real production functions are lifted verbatim (CRLF-tolerant). The dev block
// also wires the sidebar controls immediately, without visiting Settings.
const DEV_BLOCK = slice(/  \/\/ 🛠 DEV MODE DEBUG LOGGING[\s\S]*?(?=\r?\n  function renderMissions\(\))/, "dev block");
const ADD_TOOL_ROW = slice(/  function addToolRow\(name, ev\) \{[\s\S]*?\r?\n  \}\r?\n/, "addToolRow");
const TOGGLE = slice(/const dmsw = modalCard\.querySelector\("#devModeSw"\);[\s\S]*?(?=\r?\n      wireFilter\()/, "toggle handlers");
const API = slice(/  async function api\(url, body, checkStatus = false\) \{[\s\S]*?\r?\n  \}/, "API helper");
const ROSTER_SYNC = slice(/    if \(ev.type === "roster.sync"\) \{[\s\S]*?(?=\r?\n    if \(ev.type === "roster.removed"\))/, "roster.sync handler");
const TARGET_CHROME = slice(/  function refreshTargetChrome\(\) \{[\s\S]*?\r?\n  \}/, "target chrome");
const ROUTE_SUB = slice(/  function routeSub\(ev, subId\) \{[\s\S]*?\r?\n  \}/, "ghost event handler");

for (const [name, src] of [["dev block", DEV_BLOCK], ["addToolRow", ADD_TOOL_ROW]]) {
  for (const fn of name === "dev block" ? ["function esc(", "function redactSecrets(", "function devLogEvent(", "function devLogTool(", "function devLogAgent(", "function devLogPerf(", "function setDevMode(", "function wireDevLogControls("] : [])
    assert.ok(src.includes(fn), name + " must contain " + fn);
}

function bootOverlay({ devMode = true, clipboard, secure = true, fetch: fetchImpl } = {}) {
  const dom = makeDom();
  const chips = [], blobs = [], written = [], requests = [];
  const sandbox = {
    document: dom.document, console, chips, blobs,
    navigator: { clipboard: clipboard === null ? undefined : { writeText: clipboard || ((t) => { written.push(t); return Promise.resolve(); }) } },
    isSecureContext: secure,
    Blob: class Blob { constructor(parts, opts) { this.text = parts.join(""); this.type = opts && opts.type; blobs.push(this); } },
    URL: { createObjectURL: (b) => "blob:fake/" + blobs.indexOf(b), revokeObjectURL() {} },
    setTimeout, clearTimeout,
    fetch: (url, options) => {
      requests.push({ url, ...options });
      return fetchImpl ? fetchImpl(url, options) : Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    },
    localStorage: { getItem: () => "en" },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const script = `
    let DEV_MODE = ${devMode ? "true" : "false"};
    const log = document.getElementById("log");
    let ROSTER, REGROLES, REGSKILLS, REGTOOLS, BUILTIN_DESC, REGMCP, REGBACKENDS, REGBACKEND,
      GHOSTWT, SEMANTIC = {}, AUTOSKILLS, VERIFY, AUTOAPPROVE, AUTOPILOT, AUTOPILOTMAX,
      SOUND, monMode, monCount, HEARTBEAT, FEATURES, TTSON, SOCIALMIN, PROPOSALMIN, MAXSTAFF, LANG = "en";
    let target = "main", groupView = "meeting-1", historyRefreshes = 0, composerRefreshes = 0;
    function refreshThreadBar() { historyRefreshes++; log.innerHTML = ""; }
    function setTarget(id) { target = id; groupView = null; refreshThreadBar(); }
    function refreshDispVisibility() {}
    function gateVoiceUI() {}
    function ensureAgent() {}
    function renderRail() {}
    function roleOf(id) { return "role(" + id + ")"; }
    function body(el, id) { el.textContent = id; }
    function setComposerHint() { composerRefreshes++; }
    function addLog() {}
    function showTyping() {}
    function toolLabel(tool) { return tool; }
    function nameOf(id) { return "N(" + id + ")"; }
    function tr(s) { return s; }
    function addChip(h) { chips.push(String(h)); }
    ${DEV_BLOCK}
    ${ADD_TOOL_ROW}
    ${API}
    ${TARGET_CHROME}
    ${ROUTE_SUB}
    function routeRoster(ev) { ${ROSTER_SYNC} }
    function wireToggle(modalCard) { ${TOGGLE} }
    globalThis.__api = { setDev: setDevMode, syncDevModeUI, wireToggle, routeRoster, routeSub, api,
      state: () => ({ devMode: DEV_MODE, pending: devModePending, groupView, target, historyRefreshes, composerRefreshes }),
      redactSecrets, maskInString, maskSecret, maskKey, esc,
      devLogEvent, devLogTool, devLogAgent, devLogPerf, addToolRow };
  `;
  vm.runInNewContext(script, sandbox, { filename: "overlay-devmode-block.js" });
  const openSettings = () => {
    const old = dom.byId.get("devModeSw"); if (old) old.remove();
    const sw = dom.add("devModeSw");
    const state = sandbox.__api.state();
    sw.className = "switch" + (state.devMode ? " on" : "");
    sw.setAttribute("role", "switch"); sw.setAttribute("tabindex", "0");
    sw.setAttribute("aria-checked", state.devMode); sw.setAttribute("aria-disabled", state.pending);
    sandbox.__api.wireToggle({ querySelector: (selector) => selector === "#devModeSw" ? sw : null });
    return sw;
  };
  return { ...dom, chips, blobs, written, requests, openSettings, api: sandbox.__api, sandbox };
}
const tick = () => new Promise((r) => setImmediate(r));

test("overlay: the lifted block executes and its redactSecrets matches daemon/devmode.js on shared fixtures", () => {
  const { api } = bootOverlay();
  for (const fn of ["redactSecrets", "maskInString", "maskSecret", "devLogEvent", "devLogTool", "devLogAgent", "devLogPerf", "addToolRow", "esc", "maskKey"])
    assert.strictEqual(typeof api[fn], "function", fn);
  const a = { name: "a" }; a.self = a;
  const fixtures = [
    { api_key: RAW_KEY, apiKey: "short", headers: { Authorization: "Bearer " + RAW_KEY }, usage: { input_tokens: 1 }, list: [{ password: "p".repeat(20) }], credentials: { user: "bob", port: 5432 } },
    "curl -H 'Authorization: Bearer " + RAW_KEY + "' ?api_key=ABCDEFGHIJKLMNOP",
    "x".repeat(3000) + RAW_KEY,
    a,
    Array.from({ length: 150 }, (_, i) => ({ i })),
    // URL credentials + CLI flags (Gaps 2 & 3) must agree too
    "DATABASE_URL=postgres://alice:hunter2@db.local:5432/app mongodb+srv://u:p@c.net/db bare alice:hunter2@db.local https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123@github.com/o/r",
    "curl -H 'Authorization: Bearer abc123def456' -H \"x-api-key: abc\" -H 'Content-Type: text/plain' --token xyz789abc -u bob:pw12345 --password 'SuperSecret1Word!' --password=Sup3r -p hunter2 --port 5432 top-p 0.9",
    { command: "mysql -u root -p hunter2 -h db", args: ["--api-key", "k", "--secret=\"s s\""], password: "SuperSecret1Word!" },
  ];
  for (const f of fixtures) {
    assert.strictEqual(JSON.stringify(api.redactSecrets(f)), JSON.stringify(devmode.redactSecrets(f)), "client and daemon redaction agree");
    if (typeof f === "string") assert.strictEqual(api.maskInString(f), devmode.maskInString(f), "client and daemon maskInString agree");
  }
  // the client-side redaction placeholder is the fixed "••••••", never a slice of the secret
  assert.strictEqual(api.maskSecret(RAW_KEY), "••••••");
  assert.strictEqual(api.maskSecret("abcdefghijkl"), "••••••", "12-char secret → same placeholder");
  assert.strictEqual(api.maskSecret(""), "");
  // Settings-page key recognition is a SEPARATE function with the HEAD behaviour (not a Dev Mode path)
  assert.notStrictEqual(api.maskKey, api.maskSecret, "maskKey must not alias maskSecret");
  assert.strictEqual(api.maskKey(RAW_KEY), SETTINGS_KEY_FORM);
  assert.strictEqual(api.maskKey("abcdefghij"), "••••••••••", "≤ 10 chars fully masked on the settings page");
  assert.strictEqual(api.maskKey("abcdefghijkl"), "abcdefgh••••••ijkl", "settings page keeps first 8 + last 4 above 10 chars");
  assert.strictEqual(api.maskKey(""), "");
  assert.strictEqual(api.esc('<b a="1">&'), "&lt;b a=&quot;1&quot;&gt;&amp;");
});

// ------------------------------------------------ owner's brief: 3 gaps closed
// Both the daemon module and the overlay-lifted block are checked on every input.
function bothAgree(api, fn, input, label) {
  const d = devmode[fn](input), c = api[fn](input);
  assert.strictEqual(JSON.stringify(c), JSON.stringify(d), "overlay " + fn + " disagrees with daemon on " + (label || JSON.stringify(input)));
  return d;
}
// every substring of `secret` with length ≥ 3 must be absent from `text`
function assertNoFragment(text, secret, label) {
  for (let i = 0; i + 3 <= secret.length; i++) {
    const frag = secret.slice(i, i + 3);
    assert.ok(!text.includes(frag), label + ": fragment " + JSON.stringify(frag) + " of the secret survived in " + JSON.stringify(text));
  }
}

test("devmode: mask is a fixed placeholder — no secret characters, not length-revealing", () => {
  const { api } = bootOverlay();
  const PW = "SuperSecret1Word!";
  const short = "abcdefghijklm";                 // 13 chars
  const long = "Q".repeat(100) + "z".repeat(100); // 200 chars
  assert.strictEqual(devmode.mask(short), "••••••");
  assert.strictEqual(devmode.mask(long), "••••••");
  assert.strictEqual(devmode.mask(short), devmode.mask(long), "same output regardless of length");
  assert.strictEqual(devmode.mask(PW), "••••••");
  assert.strictEqual(devmode.mask("a"), "••••••", "even a 1-char secret is not length-revealing");
  assert.strictEqual(devmode.mask(1234567890), "••••••"); assert.strictEqual(devmode.mask(false), "••••••"); assert.strictEqual(devmode.mask(99n), "••••••");
  assert.strictEqual(devmode.mask(""), ""); assert.strictEqual(devmode.mask(null), ""); assert.strictEqual(devmode.mask(undefined), "");
  for (const v of [short, long, PW, "a", 1234567890, false, "", null, undefined])
    assert.strictEqual(api.maskSecret(v), devmode.mask(v), "overlay maskSecret agrees for " + String(v).slice(0, 20));
  // No ≥3-char fragment of the password survives redactSecrets — neither under
  // the secret key nor inside an innocent `command` string. The key NAME
  // "password" itself contains "ord" (a fragment of this password), so strip
  // the key name before scanning.
  const r = bothAgree(api, "redactSecrets", { password: PW, command: "password: " + PW });
  assert.strictEqual(r.password, "••••••");
  assert.strictEqual(r.command, "password: ••••••");
  assertNoFragment(JSON.stringify(r).split("password").join(""), PW, "redactSecrets");
  const r2 = bothAgree(api, "redactSecrets", { command: "{ password: \"" + PW + "\" }" });
  assert.strictEqual(r2.command, "{ password: \"••••••\" }");
  assertNoFragment(r2.command.split("password").join(""), PW, "redactSecrets(JSON-ish)");
  const s = bothAgree(api, "maskInString", "password: " + PW);
  assert.strictEqual(s, "password: ••••••");
  assertNoFragment(s.split("password").join(""), PW, "maskInString");
  // the old first-8/last-4 leak is gone from the live task.progress frame too
  const ev = devmode.progressEvent({ type: "task.progress", tool: "Bash" }, { command: "password: " + PW, password: PW }, true);
  assertNoFragment(JSON.stringify(ev).split("password").join(""), PW, "progressEvent");
});

test("devmode: URL credentials are fully replaced", () => {
  const { api } = bootOverlay();
  const cases = [
    // [input, expected, secrets that must be gone]
    ["https://alice:hunter2@db.local/path", "https://••••••@db.local/path", ["alice", "hunter2"]],
    ["postgres://alice:hunter2@db.local:5432/app", "postgres://••••••@db.local:5432/app", ["alice", "hunter2"]],
    ["postgresql://alice:hunter2@db.local:5432/app?sslmode=require", "postgresql://••••••@db.local:5432/app?sslmode=require", ["alice", "hunter2"]],
    ["mongodb+srv://u1:p%40ss@cluster0.x.mongodb.net/db?retryWrites=true", "mongodb+srv://••••••@cluster0.x.mongodb.net/db?retryWrites=true", ["u1", "p%40ss"]],
    ["mysql://root:r00tpw@127.0.0.1:3306/db", "mysql://••••••@127.0.0.1:3306/db", ["root", "r00tpw"]],
    ["redis://:redispass@[::1]:6379/0", "redis://••••••@[::1]:6379/0", ["redispass"]],
    ["amqp://guest:guest@rabbit:5672/", "amqp://••••••@rabbit:5672/", ["guest"]],
    // bare user:pass@host, no scheme
    ["alice:hunter2@db.local:5432/app", "••••••@db.local:5432/app", ["alice", "hunter2"]],
    ["DSN=alice:hunter2@db.local:5432/app", "DSN=••••••@db.local:5432/app", ["alice", "hunter2"]],
    ["psql \"alice:hunter2@db.local/app\"", "psql \"••••••@db.local/app\"", ["alice", "hunter2"]],
    // token-only userinfo (GitHub style)
    ["git clone https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123@github.com/org/repo.git", "git clone https://••••••@github.com/org/repo.git", ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"]],
    ["https://token@host", "https://••••••@host", ["token"]],
    ["https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123@github.com/o/r", "https://••••••@github.com/o/r", ["x-access-token", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"]],
  ];
  for (const [input, expected, secrets] of cases) {
    const out = bothAgree(api, "maskInString", input);
    assert.strictEqual(out, expected);
    for (const s of secrets) assert.ok(!out.includes(s), "secret " + s + " leaked in: " + out);
    const host = expected.slice(expected.indexOf("@") + 1);
    assert.ok(host.length > 0 && out.endsWith(host), "host survives: " + out);
    // the same through redactSecrets on a command string
    assert.strictEqual(bothAgree(api, "redactSecrets", { command: "echo " + input }).command, "echo " + expected);
  }
  // innocent look-alikes untouched: colon-space headers, clock times, e-mail / mailto, git scp-style, plain URLs
  for (const s of ["Authorization: Bearer", "meet at 12:30@office", "mailto:alice@x.com", "alice@example.com", "git@github.com:org/repo",
    "https://example.com/a@b", "https://example.com/?next=x@y", "key: value@2x", "input_tokens: 12"])
    assert.strictEqual(bothAgree(api, "maskInString", s), s, "must be untouched: " + s);
  // the existing Bearer rule still keeps its scheme word in bare text
  assert.strictEqual(bothAgree(api, "maskInString", "Authorization: Bearer abc123def456"), "Authorization: Bearer ••••••");
});

test("devmode: CLI flag arguments are masked", () => {
  const { api } = bootOverlay();
  const COMBINED = "curl -H 'Authorization: Bearer abc123def456' --token xyz789abc https://alice:hunter2@db.local -u bob:pw12345 --password 'SuperSecret1Word!'";
  const out = bothAgree(api, "maskInString", COMBINED);
  assert.strictEqual(out, "curl -H 'Authorization: ••••••' --token •••••• https://••••••@db.local -u •••••• --password '••••••'");
  // (the flag name `--password` itself contains "ord", a fragment of the
  // password — strip the flag name before the fragment scan)
  for (const s of ["abc123def456", "xyz789abc", "hunter2", "alice", "pw12345", "SuperSecret1Word!"]) {
    assert.ok(!out.includes(s), s + " leaked in: " + out);
    assertNoFragment(out.split("password").join(""), s, "combined/" + s);
  }
  // the same line as a Bash tool call: detail + label + input all clean
  const d = devmode.toolDetail("Bash", { command: COMBINED });
  assert.strictEqual(d.detail, out);
  for (const s of ["abc123def456", "xyz789abc", "hunter2", "pw12345", "SuperSecret1Word!"]) assert.ok(!d.label.includes(s) && !d.detail.includes(s), s);
  const cases = [
    // long flags, space / = / quoted / unquoted, punctuation inside quotes
    ["--password SuperSecret1Word!", "--password ••••••"],
    ["--password=SuperSecret1Word!", "--password=••••••"],
    ["--password 'SuperSecret1Word!'", "--password '••••••'"],
    ["--password \"Super Secret 1 Word!\"", "--password \"••••••\""],
    ["--password=x", "--password=••••••"],
    ["--passwd x1 --pass x2 --token x3 --api-key x4 --apikey x5 --api_key x6 --secret x7 --client-secret x8 --access-token x9 --auth x10 --bearer x11 --key x12 --private-key x13 --cookie x14",
      "--passwd •••••• --pass •••••• --token •••••• --api-key •••••• --apikey •••••• --api_key •••••• --secret •••••• --client-secret •••••• --access-token •••••• --auth •••••• --bearer •••••• --key •••••• --private-key •••••• --cookie ••••••"],
    ["--PASSWORD Abc --Token=Def", "--PASSWORD •••••• --Token=••••••"],
    // short flags
    ["mysql -u root -p hunter2 -h db", "mysql -u root -p •••••• -h db"],
    ["-P hunter2", "-P ••••••"],
    ["-k hunter2", "-k ••••••"],
    ["tool -p \"hun ter2\"", "tool -p \"••••••\""],
    ["curl -u bob:pw12345 https://x", "curl -u •••••• https://x"],
    ["curl --user bob:pw12345 https://x", "curl --user •••••• https://x"],
    ["curl --user=bob:pw12345 https://x", "curl --user=•••••• https://x"],
    ["curl -u 'bob:pw 12345' https://x", "curl -u '••••••' https://x"],
    // -H / --header: header VALUE masked as a whole, header NAME kept, quotes kept
    ["-H \"Authorization: Bearer abc123def456\"", "-H \"Authorization: ••••••\""],
    ["-H 'Authorization: Bearer abc123def456'", "-H 'Authorization: ••••••'"],
    ["-H \"x-api-key: abc\"", "-H \"x-api-key: ••••••\""],
    ["-H 'Cookie: session=abc'", "-H 'Cookie: ••••••'"],
    ["-H 'X-Auth-Token: abc'", "-H 'X-Auth-Token: ••••••'"],
    ["--header \"Authorization: Basic dXNlcjpwYXNz\"", "--header \"Authorization: ••••••\""],
    ["--header 'Authorization: Bearer abc123def456' -H \"Content-Type: application/json\"", "--header 'Authorization: ••••••' -H \"Content-Type: application/json\""],
    ["-H Authorization:abc123", "-H Authorization: ••••••"],
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(bothAgree(api, "maskInString", input), expected);
    assert.strictEqual(bothAgree(api, "redactSecrets", { command: input }).command, expected);
  }
  // negatives: not flags / other flags / innocent tokens must be untouched
  for (const s of ["top-p 0.9", "--top-p 0.9", "--port 5432", "-p --flag", "-p -x", "--password --other", "--password", "--token-file t.json",
    "--passphrase-file f", "git push -u origin main", "mysql -u root", "curl -k https://example.com/x", "-H \"Content-Type: application/json\"",
    "-H 'Accept: text/plain'", "git status && npm test", "max_tokens=8000 input_tokens: 12", "-H", "--header"])
    assert.strictEqual(bothAgree(api, "maskInString", s), s, "must be untouched: " + s);
});

test("overlay: redaction is applied in devLogEvent, devLogTool, devLogAgent and devLogPerf — before truncation", () => {
  const o = bootOverlay();
  const text = (id) => o.byId.get(id).textContent;
  o.api.devLogEvent("task.progress", "Tool: Bash Bearer " + RAW_KEY, "Agent: x api_key=" + RAW_KEY);
  o.api.devLogTool("jeje", "Bash", { command: "curl -H 'Authorization: Bearer " + RAW_KEY + "'", api_key: RAW_KEY }, "out token=" + RAW_KEY, 12);
  // secret FIRST then 2000 chars of padding: an implementation that truncates
  // before redacting would still leak it inside the first 500 chars.
  o.api.devLogAgent("jeje", "Task completed", "Authorization: Bearer " + RAW_KEY + " " + "x".repeat(2000));
  o.api.devLogPerf("Token usage", { input_tokens: 10, api_key: RAW_KEY }, "Model: m password=" + RAW_KEY);
  for (const id of ["devEventLog", "devToolLog", "devAgentLog", "devPerfLog"]) {
    assert.strictEqual(o.byId.get(id).children.length, 1, id);
    assert.ok(!text(id).includes(RAW_KEY), id + " leaked the raw secret: " + text(id));
    assert.ok(text(id).includes(RAW_KEY_MASK), id + " should show the mask: " + text(id));
  }
  assert.ok(text("devToolLog").includes("Agent: N(jeje)") && text("devToolLog").includes("Duration: 12ms"));
  assert.ok(text("devToolLog").includes("Input:") && text("devToolLog").includes("Output:"));
  assert.ok(text("devPerfLog").includes('"input_tokens": 10'), "token counts survive redaction");
  assert.ok(text("devAgentLog").length < 800, "agent detail is cut to ~500 chars after masking");
  // Dev Mode off → nothing is logged
  const off = bootOverlay({ devMode: false });
  off.api.devLogEvent("t", "l", "d"); off.api.devLogTool("a", "Bash", { x: 1 }); off.api.devLogAgent("a", "e", "d"); off.api.devLogPerf("m", 1, "d");
  for (const id of ["devEventLog", "devToolLog", "devAgentLog", "devPerfLog"]) assert.strictEqual(off.byId.get(id).children.length, 0);
});

test("overlay: every log section caps at 200 entries with FIFO eviction", () => {
  const o = bootOverlay();
  assert.ok(DEV_BLOCK.includes("const DEV_LOG_LIMIT = 200;"));
  for (let i = 0; i < 250; i++) {
    o.api.devLogEvent("t", "E" + i + "#", "");
    o.api.devLogTool("a", "T" + i + "#", null, null);
    o.api.devLogAgent("a", "A" + i + "#", "");
    o.api.devLogPerf("P" + i + "#", i, "");
  }
  for (const [id, p] of [["devEventLog", "E"], ["devToolLog", "T"], ["devAgentLog", "A"], ["devPerfLog", "P"]]) {
    const el = o.byId.get(id);
    assert.strictEqual(el.children.length, 200, id);
    assert.ok(el.firstChild.textContent.includes(p + "50#"), id + " oldest surviving entry is #50, got: " + el.firstChild.textContent);
    assert.ok(el.lastChild.textContent.includes(p + "249#"), id + " newest entry is #249");
    assert.ok(!el.children.some((c) => c.textContent.includes(p + "49#")), id + " entry #49 was evicted");
  }
});

test("overlay: Clear works at boot without opening Settings and empties all 4 sections", () => {
  const o = bootOverlay();
  assert.strictEqual(o.byId.has("devModeSw"), false, "Settings has never been opened");
  for (let i = 0; i < 5; i++) { o.api.devLogEvent("t", "l" + i); o.api.devLogTool("a", "T"); o.api.devLogAgent("a", "e"); o.api.devLogPerf("m", i); }
  const btn = o.byId.get("devClearLogs");
  assert.strictEqual(typeof btn.onclick, "function", "Clear button got a handler");
  btn.click();
  for (const id of ["devEventLog", "devToolLog", "devAgentLog", "devPerfLog"]) assert.strictEqual(o.byId.get(id).children.length, 0, id);
  assert.ok(o.chips.includes("🧹 ล้าง Dev Mode log แล้ว"));
});

test("overlay: Export works at boot through the clipboard and never contains raw secrets", async () => {
  const o = bootOverlay();
  o.api.devLogTool("jeje", "Bash", { command: "Bearer " + RAW_KEY });
  o.byId.get("devExportLogs").click();
  await tick(); await tick();
  assert.strictEqual(o.written.length, 1, "clipboard.writeText called once");
  assert.ok(o.written[0].includes("=== devToolLog ===") && o.written[0].includes(RAW_KEY_MASK) && !o.written[0].includes(RAW_KEY));
  assert.strictEqual(o.blobs.length, 0, "no download when the clipboard worked");
  assert.ok(o.chips.includes("📤 คัดลอก Dev Mode log ไปที่คลิปบอร์ดแล้ว"));
});

test("overlay: Export falls back to a .txt download when the clipboard rejects, or when not secure/available", async () => {
  // 1) clipboard present but rejects
  let o = bootOverlay({ clipboard: () => Promise.reject(new Error("denied")) });
  o.api.devLogEvent("t", "hello-export");
  o.byId.get("devExportLogs").click();
  await tick(); await tick();
  assert.strictEqual(o.blobs.length, 1, "a Blob was built for download");
  assert.ok(o.blobs[0].text.includes("hello-export") && o.blobs[0].type.startsWith("text/plain"));
  const anchors = o.created.filter((e) => e.tagName === "A");
  assert.strictEqual(anchors.length, 1);
  assert.match(anchors[0].download, /^devmode-logs-\d+\.txt$/);
  assert.strictEqual(anchors[0].clicks, 1, "the anchor was clicked");
  assert.ok(o.chips.includes("📥 ดาวน์โหลด Dev Mode log แล้ว"));
  // 2) insecure context → straight to download, clipboard untouched
  o = bootOverlay({ secure: false });
  o.byId.get("devExportLogs").click();
  await tick();
  assert.strictEqual(o.written.length, 0); assert.strictEqual(o.blobs.length, 1);
  assert.strictEqual(o.blobs[0].text, "ไม่มี log ให้ส่งออก", "empty export still produces the placeholder text");
  // 3) no clipboard API at all
  o = bootOverlay({ clipboard: null });
  o.byId.get("devExportLogs").click();
  await tick();
  assert.strictEqual(o.blobs.length, 1);
});

test("overlay: addToolRow renders a collapsible, redacted detail row only when DEV_MODE is on", () => {
  const ev = { type: "task.progress", tool: "Bash", kind: "command", label: "curl -H 'Authorization: Bearer " + RAW_KEY + "'",
    detail: "curl -H 'Authorization: Bearer " + RAW_KEY + "' https://x\nline2", input: { command: "x", api_key: RAW_KEY } };
  const on = bootOverlay();
  on.api.addToolRow("Bash", ev);
  const row = on.byId.get("log").children[0];
  assert.strictEqual(row.tagName, "DETAILS");
  assert.strictEqual(row.className, "toolrow dev command");
  const [summary, pre] = row.children;
  assert.strictEqual(summary.tagName, "SUMMARY");
  assert.ok(summary.textContent.startsWith("⚙ Bash · curl -H"), summary.textContent);
  assert.ok(!summary.textContent.includes(RAW_KEY) && summary.textContent.includes(RAW_KEY_MASK), "label redacted client-side");
  assert.strictEqual(pre.tagName, "PRE"); assert.strictEqual(pre.className, "dev-detail");
  assert.ok(pre.textContent.includes("line2") && pre.textContent.includes(RAW_KEY_MASK) && !pre.textContent.includes(RAW_KEY), pre.textContent);
  // input-only event → redacted JSON body; hostile kind is sanitised
  on.api.addToolRow("mcp__x", { input: { api_key: RAW_KEY, url: "u" }, kind: "<img>" });
  const row2 = on.byId.get("log").children[1];
  assert.strictEqual(row2.className, "toolrow dev img");
  assert.ok(row2.children[1].textContent.includes('"api_key": "' + RAW_KEY_MASK + '"'));
  assert.strictEqual(row2.children[0].textContent, "⚙ mcp__x");
  // long detail capped at 2000
  on.api.addToolRow("Bash", { detail: "y".repeat(5000) });
  assert.strictEqual(on.byId.get("log").children[2].children[1].textContent.length, 2000);
  // Calls without recorded input still offer an arrow and an explicit fallback.
  on.api.addToolRow("Read", { type: "task.progress", tool: "Read" });
  const plain = on.byId.get("log").children[3];
  assert.strictEqual(plain.tagName, "DETAILS"); assert.strictEqual(plain.className, "toolrow dev");
  assert.strictEqual(plain.children[0].textContent, "⚙ Read");
  assert.strictEqual(plain.children[1].textContent, "ไม่มีรายละเอียดที่บันทึกไว้สำหรับการเรียกนี้");
  // Dev Mode off → the plain marker even when the event carries detail
  const off = bootOverlay({ devMode: false });
  off.api.addToolRow("Bash", ev);
  const p2 = off.byId.get("log").children[0];
  assert.strictEqual(p2.tagName, "DIV"); assert.strictEqual(p2.className, "toolrow"); assert.strictEqual(p2.textContent, "⚙ Bash");
  assert.ok(!p2.innerHTML.includes(RAW_KEY));
  // the task.progress handler passes the event through and logs input
  assert.match(html, /addToolRow\(ev\.tool \|\| "…", ev\)/);
  assert.match(html, /devLogTool\(ev\.agent, ev\.tool, ev\.input, null, null\)/);
});

// ------------------------------------------- (e) real toggle / roster handlers
function assertMode(o, enabled) {
  assert.strictEqual(o.api.state().devMode, enabled);
  for (const id of ["devModeTitle", "devModePanel"])
    assert.strictEqual(o.byId.get(id).style.display, enabled ? "block" : "none", id);
  const sw = o.byId.get("devModeSw");
  if (sw) {
    assert.strictEqual(sw.classList.contains("on"), enabled);
    assert.strictEqual(sw.getAttribute("aria-checked"), String(enabled));
  }
}
const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) });

test("overlay: toggling off then on restores tool arrows, redacted bodies and open state without replacing conversation content", async () => {
  const o = bootOverlay(), log = o.byId.get("log"), sw = o.openSettings();
  const message = o.document.createElement("div"); message.className = "msg"; message.textContent = "keep conversation"; log.appendChild(message);
  o.api.addToolRow("Bash", { detail: "echo hello\npassword=" + RAW_KEY, label: "hello", kind: "command" });
  let row = log.children[1]; row.open = true;
  const originalBody = row.children[1].textContent;
  log.scrollTop = 7;
  await sw.click();
  assertMode(o, false);
  assert.strictEqual(log.scrollTop, 7);
  assert.strictEqual(log.children[0], message, "chat message is retained");
  assert.strictEqual(log.children[1].tagName, "DIV");
  o.api.addToolRow("Skill", { tool: "Skill" }); // event captured while details were disabled
  log.scrollTop = 4;
  await sw.click();
  assertMode(o, true);
  assert.strictEqual(log.scrollTop, 4);
  row = log.children[1];
  assert.strictEqual(row.tagName, "DETAILS"); assert.strictEqual(row.open, true);
  assert.strictEqual(row.children[0].tagName, "SUMMARY");
  assert.strictEqual(row.children[1].textContent, originalBody);
  assert.ok(originalBody.includes(RAW_KEY_MASK) && !originalBody.includes(RAW_KEY));
  assert.strictEqual(log.children[2].tagName, "DETAILS", "rows recorded while off also regain arrows");
  assert.strictEqual(log.children[2].children[1].textContent, DEV_MODE_KEYS.at(-1));
  assert.deepStrictEqual(o.requests.map((r) => [r.url, JSON.parse(r.body).enabled]), [["/registry/devmode", false], ["/registry/devmode", true]]);
  assert.ok(o.requests.every((r) => r.headers["x-bagidea-ui"] === "1"));
});

test("overlay: roster.sync preserves live/group history while updating every built-in, Skill, MCP and empty-input row", () => {
  const o = bootOverlay(), log = o.byId.get("log"), sw = o.openSettings();
  const tools = [...Object.keys(require("../constants").BUILTIN_TOOLS), "PowerShell", "Agent", "mcp__files__read", "UnknownTool"];
  for (const name of tools) {
    o.api.addToolRow(name, { input: { api_key: RAW_KEY, tool: name } });
    o.api.addToolRow(name);
  }
  const bodies = log.children.map((row) => row.children[1].textContent);
  log.children[0].open = true; log.scrollTop = 13;
  for (const devMode of [false, true, true, false, true]) {
    const previousFirst = log.children[0], previousMode = o.api.state().devMode;
    o.api.routeRoster({ type: "roster.sync", devMode, agents: { main: {} } });
    assertMode(o, devMode);
    assert.strictEqual(o.api.state().groupView, "meeting-1", "roster updates must not exit the group view");
    assert.strictEqual(o.api.state().historyRefreshes, 0, "roster updates must not refetch and erase live tool details");
    assert.strictEqual(o.api.state().composerRefreshes, 0, "roster updates must preserve the group composer hint");
    assert.strictEqual(log.scrollTop, 13);
    assert.strictEqual(log.children.length, tools.length * 2);
    for (const [i, row] of log.children.entries()) {
      assert.strictEqual(row.tagName, devMode ? "DETAILS" : "DIV", tools[Math.floor(i / 2)]);
      if (devMode) {
        assert.strictEqual(row.children[0].tagName, "SUMMARY");
        assert.strictEqual(row.children[1].textContent, bodies[i]);
        assert.strictEqual(row.open, i === 0);
      }
    }
    if (devMode === previousMode) assert.strictEqual(log.children[0], previousFirst, "unchanged mode does not rebuild rows");
    assert.strictEqual(sw.disabled, false);
  }
});

test("overlay: ghost progress passes its details to group rows and logs redacted tools only in Dev Mode", () => {
  const ev = { type: "subagent.progress", agent: "main", sub: "main#ghost", session: "meeting-1", tool: "Skill",
    kind: "skill", detail: "code-review --token " + RAW_KEY, input: { skill: "code-review", token: RAW_KEY } };
  const o = bootOverlay();
  o.api.routeSub(ev, ev.sub);
  const row = o.byId.get("log").children[0];
  assert.strictEqual(row.tagName, "DETAILS");
  assert.strictEqual(row.className, "toolrow dev skill");
  assert.strictEqual(row.children[1].textContent, "code-review --token " + RAW_KEY_MASK);
  for (const id of ["devEventLog", "devToolLog"]) assert.strictEqual(o.byId.get(id).children.length, 1, id);
  const toolText = o.byId.get("devToolLog").textContent;
  assert.ok(toolText.includes("code-review") && toolText.includes(RAW_KEY_MASK) && !toolText.includes(RAW_KEY));
  o.api.routeSub({ ...ev, replay: true }, ev.sub);
  assert.strictEqual(o.byId.get("log").children.length, 1, "replay does not duplicate ghost tool rows");
  o.api.routeSub({ ...ev, session: "another-meeting" }, ev.sub);
  assert.strictEqual(o.byId.get("log").children.length, 1, "another group does not get an inline row");
  const off = bootOverlay({ devMode: false });
  off.api.routeSub(ev, ev.sub);
  assert.strictEqual(off.byId.get("log").children[0].tagName, "DIV");
  for (const id of ["devEventLog", "devToolLog"]) assert.strictEqual(off.byId.get(id).children.length, 0, id);
});

test("overlay: a pending request blocks rapid clicks and a newly opened Settings toggle", async () => {
  let finish;
  const o = bootOverlay({ devMode: false, fetch: () => new Promise((resolve) => { finish = resolve; }) });
  const first = o.openSettings(), request = first.click();
  assert.strictEqual(o.api.state().pending, true);
  assert.strictEqual(first.disabled, true);
  assert.strictEqual(first.getAttribute("aria-disabled"), "true");
  await first.click();
  const replacement = o.openSettings();
  assert.notStrictEqual(replacement, first);
  assert.strictEqual(replacement.getAttribute("aria-disabled"), "true");
  await replacement.click();
  assert.strictEqual(o.requests.length, 1, "shared request lock survives modal replacement");
  finish(okResponse()); await request;
  assertMode(o, true);
  assert.strictEqual(o.api.state().pending, false);
  assert.strictEqual(first.disabled, false);
  assert.strictEqual(replacement.disabled, false);
  assert.strictEqual(replacement.getAttribute("aria-disabled"), "false");
});

test("overlay: rejected HTTP and network requests keep the authoritative mode and re-enable the toggle", async () => {
  for (const [fetch, error] of [
    [async () => ({ ok: false, status: 403, json: async () => ({}) }), "HTTP 403"],
    [async () => { throw new Error("offline"); }, "offline"],
  ]) {
    const o = bootOverlay({ fetch }), sw = o.openSettings();
    o.api.addToolRow("Read", { detail: "file.txt" });
    const row = o.byId.get("log").children[0];
    await sw.click();
    assertMode(o, true);
    assert.strictEqual(o.byId.get("log").children[0], row, "failure must retain current row and detail");
    assert.strictEqual(sw.disabled, false);
    assert.strictEqual(sw.getAttribute("aria-disabled"), "false");
    assert.strictEqual(o.api.state().pending, false);
    assert.ok(o.chips.some((chip) => chip.includes("❌ เปิด/ปิด Dev Mode ไม่สำเร็จ:") && chip.includes(error)));
  }
});

test("overlay: a roster snapshot received during the request wins over a late HTTP success or failure", async () => {
  for (const rejectRequest of [false, true]) {
    let finish, fail;
    const o = bootOverlay({ devMode: false, fetch: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) });
    const sw = o.openSettings(), request = sw.click(); // asks to turn on
    o.api.routeRoster({ type: "roster.sync", devMode: true });
    o.api.routeRoster({ type: "roster.sync", devMode: false }); // another client's newer setting
    if (rejectRequest) fail(new Error("late failure")); else finish(okResponse());
    await request;
    assertMode(o, false);
    assert.strictEqual(sw.disabled, false);
    assert.strictEqual(o.api.state().pending, false);
  }
});

test("overlay: Dev Mode keyboard activation and checked-status API behavior", async () => {
  const o = bootOverlay({ devMode: false }), sw = o.openSettings();
  let prevented = 0;
  sw.onkeydown({ key: "a", preventDefault() { prevented++; } });
  assert.strictEqual(o.requests.length, 0);
  for (const key of ["Enter", " "]) {
    sw.onkeydown({ key, preventDefault() { prevented++; } });
    await tick();
  }
  assert.strictEqual(prevented, 2); assert.strictEqual(o.requests.length, 2); assertMode(o, false);
  assert.match(html, /id="devModeSw" role="switch" tabindex="0" aria-checked="\$\{DEV_MODE\}" aria-disabled="\$\{devModePending\}"/);
  const failed = bootOverlay({ fetch: async () => ({ ok: false, status: 500, json: async () => ({ error: "oops" }) }) });
  assert.strictEqual((await failed.api.api("/unchanged-caller", {})).error, "oops", "existing API callers retain their response handling");
  await assert.rejects(failed.api.api("/registry/devmode", { enabled: true }, true), /HTTP 500/);
});

// ---------------------------------------------------- (f) feed-mode CSS rule
function cssRules() {
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style, "first <style> block");
  const css = style[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  // flatten one level of @media by dropping the wrapper braces
  const flat = css.replace(/@media[^{]*\{([\s\S]*?)\}\s*\}/g, "$1}");
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(flat))) {
    const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(";")) { const i = d.indexOf(":"); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    rules.push({ selectors, decls });
  }
  return rules;
}
test("overlay: feed mode hides #devModeTitle and #devModePanel (parsed CSS rule)", () => {
  const rules = cssRules();
  for (const sel of ["body.feedmode #devModeTitle", "body.feedmode #devModePanel"]) {
    const hit = rules.filter((r) => r.selectors.includes(sel));
    assert.ok(hit.length >= 1, "no CSS rule for " + sel);
    assert.ok(hit.some((r) => /^none\s*!important$/.test(r.decls.display || "")), sel + " must be display: none !important, got " + JSON.stringify(hit.map((r) => r.decls)));
  }
  const detail = rules.find((r) => r.selectors.includes(".dev-detail"));
  assert.ok(detail, ".dev-detail rule");
  assert.strictEqual(detail.decls["max-height"], "160px");
  assert.strictEqual(detail.decls.overflow, "auto");
  assert.strictEqual(detail.decls["user-select"], "text");
  assert.match(detail.decls["font-family"] || "", /monospace/);
  assert.ok(/pre-wrap/.test(detail.decls["white-space"]) && detail.decls["word-wrap"] === "break-word");
  const devLog = rules.find((r) => r.selectors.includes(".dev-log"));
  assert.ok(devLog && devLog.decls["overflow-y"] === "auto" && devLog.decls["max-height"], ".dev-log scrolls");
  assert.ok(rules.some((r) => r.selectors.includes("details.toolrow.dev")), "details.toolrow.dev rule");
});

// --------------------------------------------------------- (d) localisation
function extractDict() {
  const m = html.match(/\r?\n  const DICT = (\{[\s\S]*?\r?\n  \});\r?\n/);
  assert.ok(m, "DICT literal");
  return vm.runInNewContext("(" + m[1] + ")", {});
}
test("i18n: inline DICT has every Dev Mode key in all 13 non-Thai languages", () => {
  const DICT = extractDict();
  for (const k of DEV_MODE_KEYS) {
    assert.ok(DICT[k], "DICT missing " + k);
    for (const l of LANGS) assert.ok(typeof DICT[k][l] === "string" && DICT[k][l].trim(), `DICT[${k}].${l}`);
    assert.deepStrictEqual(Object.keys(DICT[k]).sort(), [...LANGS].sort(), "exactly the 13 languages for " + k);
  }
  // the strings are actually used (static HTML → DOM walker, JS → tr())
  for (const k of DEV_MODE_KEYS) assert.ok(html.split(k).length >= 3, "key must appear in DICT and at a use site: " + k);
  assert.ok(html.includes('<h2 id="devModeTitle" style="display:none">🛠 แผงดีบัก DEV MODE</h2>'));
  assert.ok(html.includes('<button class="dev-btn" id="devClearLogs">🧹 ล้าง Log ทั้งหมด</button>'), "static HTML carries plain Thai, not a ${tr()} template");
  assert.ok(!html.includes('${tr("🧹 ล้าง Log ทั้งหมด")}'));
  // the LANGS menu really is 14 entries
  const langs = html.match(/const LANGS = \[([\s\S]*?)\];/)[1].match(/\["([a-z]{2})"/g).map((s) => s.slice(2, 4));
  assert.deepStrictEqual(langs.sort(), [...LANGS, "th"].sort());
  // log bodies are excluded from the translation API
  assert.match(html, /const NO_I18N = new Set\(\[[^\]]*"devEventLog", "devToolLog", "devAgentLog", "devPerfLog"\]\)/);
});

test("i18n: all 13 seed files parse, keep their HEAD format, and carry every Dev Mode key matching DICT", () => {
  const DICT = extractDict();
  assert.ok(!fs.existsSync(path.join(SEED_DIR, "add-devmode-translations.js")), "one-shot script must be deleted");
  for (const l of LANGS) {
    const file = path.join(SEED_DIR, l + ".json");
    const raw = fs.readFileSync(file, "utf8");
    assert.ok(!raw.startsWith("\uFEFF"), l + ": no BOM");
    const data = JSON.parse(raw);
    const lines = raw.split("\n");
    if (l === "en") {
      // en.json is pretty-printed with a 1-space indent at HEAD; keep it that way
      assert.strictEqual(lines[0], "{"); assert.strictEqual(lines[lines.length - 1], "}");
      assert.ok(lines.slice(1, -1).every((ln) => ln.startsWith(' "')), "en.json: 1-space indent");
      assert.strictEqual(raw, JSON.stringify(data, null, 1), "en.json: canonical 1-space JSON, no trailing newline");
    } else {
      assert.strictEqual(lines.length, 1, l + ".json must be single-line minified");
      assert.strictEqual(raw, JSON.stringify(data), l + ".json: canonical minified JSON, no trailing newline");
    }
    const keys = Object.keys(data);
    for (const k of DEV_MODE_KEYS) {
      assert.ok(k in data, `${l}.json missing ${k}`);
      assert.strictEqual(data[k], DICT[k][l], `${l}.json value differs from DICT for ${k}`);
    }
    assert.deepStrictEqual(keys.slice(-DEV_MODE_KEYS.length), DEV_MODE_KEYS, l + ".json: Dev Mode keys appended at the end, in order");
    assert.ok(keys.length > 600, l + ".json still has its full seed set");
  }
});

// ------------------------------------------------------- (c) live daemon
// Override for an isolated test daemon, e.g. DEVMODE_TEST_BASE=http://127.0.0.1:18787.
const BASE = process.env.DEVMODE_TEST_BASE || "http://127.0.0.1:8787";
function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request(BASE + p, { method, headers: { ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...headers }, timeout: 5000 }, (res) => {
      let buf = ""; res.on("data", (c) => buf += c);
      res.on("end", () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, text: buf, json }); });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}
// Minimal WebSocket client on a raw upgraded socket: no close handshake to wait
// on, so a test can never hang on a server that (by design) ignores frames.
function wsConnect(p, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const r = http.request(BASE + p, { headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key } });
    const timer = setTimeout(() => { r.destroy(); reject(new Error("ws connect timeout")); }, timeoutMs);
    r.on("upgrade", (res, socket, head) => {
      clearTimeout(timer);
      const c = { socket, buf: head && head.length ? Buffer.from(head) : Buffer.alloc(0), handlers: [], events: [],
        close() { try { socket.destroy(); } catch {} },
        waitFor(pred, ms, label) {
          return new Promise((res2, rej2) => {
            const hit = c.events.find(pred); if (hit) return res2(hit);
            const t = setTimeout(() => { c.handlers.splice(c.handlers.indexOf(h), 1); rej2(new Error("timeout waiting for " + label)); }, ms);
            const h = (ev) => { if (pred(ev)) { clearTimeout(t); c.handlers.splice(c.handlers.indexOf(h), 1); res2(ev); } };
            c.handlers.push(h);
          });
        } };
      const parse = () => {
        for (;;) {
          const b = c.buf; if (b.length < 2) return;
          const op = b[0] & 0x0f; const masked = b[1] & 0x80; let len = b[1] & 0x7f; let off = 2;
          if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
          if (masked) off += 4;
          if (b.length < off + len) return;
          const payload = b.subarray(off, off + len); c.buf = b.subarray(off + len);
          if (op === 1) { let ev = null; try { ev = JSON.parse(payload.toString("utf8")); } catch {} if (ev) { ev.__at = Date.now(); c.events.push(ev); for (const h of [...c.handlers]) h(ev); } }
          else if (op === 8) { socket.destroy(); return; }
        }
      };
      socket.on("data", (chunk) => { c.buf = Buffer.concat([c.buf, chunk]); parse(); });
      socket.on("error", () => {});
      parse();
      resolve(c);
    });
    r.on("response", (res) => { clearTimeout(timer); reject(new Error("no upgrade: HTTP " + res.statusCode)); });
    r.on("error", (e) => { clearTimeout(timer); reject(e); });
    r.end();
  });
}
async function liveOrSkip(t) {
  try { const h = await req("GET", "/health"); if (h.status !== 200) { t.skip("daemon /health not 200"); return false; } return true; }
  catch (e) { if (e.code === "ECONNREFUSED") { t.skip("Daemon not running at " + BASE); return false; } throw e; }
}

test("live: POST /registry/devmode without x-bagidea-ui → 403 (and nothing changes)", async (t) => {
  if (!(await liveOrSkip(t))) return;
  const before = (await req("GET", "/registry")).json;
  const r = await req("POST", "/registry/devmode", { enabled: !(before.devMode === true) });
  if (r.status === 404) return t.skip("/registry/devmode not on this daemon build");
  assert.strictEqual(r.status, 403);
  const after = (await req("GET", "/registry")).json;
  assert.strictEqual(after.devMode === true, before.devMode === true, "value untouched by the refused request");
});

test("live: toggle with header persists in /registry, reaches two WebSocket clients within 500 ms, then is restored", async (t) => {
  if (!(await liveOrSkip(t))) return;
  const probe = await req("POST", "/registry/devmode", {}, {});   // no header: harmless 403/404 probe
  if (probe.status === 404) return t.skip("/registry/devmode not on this daemon build");
  const prev = (await req("GET", "/registry")).json.devMode === true;
  const next = !prev;
  let a = null, b = null;
  const deadline = new Promise((_, rej) => setTimeout(() => rej(new Error("live test exceeded 20 s")), 20000).unref());
  const run = (async () => {
    [a, b] = await Promise.all([wsConnect("/ws"), wsConnect("/ws")]);
    // initial (non-replay) roster snapshot = the daemon finished the journal replay
    await Promise.all([a, b].map((c) => c.waitFor((ev) => ev.type === "roster.sync" && !ev.replay, 8000, "initial roster.sync")));
    assert.strictEqual(a.events.filter((ev) => ev.type === "roster.sync" && !ev.replay).pop().devMode === true, prev, "initial snapshot carries devMode");
    const t0 = Date.now();
    const r = await req("POST", "/registry/devmode", { enabled: next }, { "x-bagidea-ui": "1" });
    assert.strictEqual(r.status, 200, r.text);
    const [ea, eb] = await Promise.all([a, b].map((c) => c.waitFor((ev) => ev.type === "roster.sync" && !ev.replay && ev.__at >= t0 && (ev.devMode === true) === next, 2000, "roster.sync devMode=" + next)));
    assert.ok(ea.__at - t0 <= 500, "client A got roster.sync after " + (ea.__at - t0) + " ms");
    assert.ok(eb.__at - t0 <= 500, "client B got roster.sync after " + (eb.__at - t0) + " ms");
    const reg = (await req("GET", "/registry")).json;
    assert.strictEqual(reg.devMode === true, next, "/registry reflects the toggle");
  })();
  try {
    await Promise.race([run, deadline]);
  } finally {
    // ALWAYS restore the previous value, whatever happened above.
    const back = await req("POST", "/registry/devmode", { enabled: prev }, { "x-bagidea-ui": "1" });
    assert.strictEqual(back.status, 200, "restore failed: " + back.text);
    const reg = (await req("GET", "/registry")).json;
    assert.strictEqual(reg.devMode === true, prev, "devMode restored to its previous value");
    if (a) a.close(); if (b) b.close();
  }
});
