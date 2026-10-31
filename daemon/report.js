// 🐞 "แจ้งทีมพัฒนา" (report to the dev team) — the daemon half.
//
// When a step fails in the office (hiring a team, a copilot job, …) the owner can
// press "แจ้งทีมพัฒนา". POST /reports/prepare turns that failure into a report:
//   office version · OS/arch · Node · GPU (nvidia-smi, cached, 3 s timeout)
//   the failed step · the raw error · a small context object
//   the tail of daemon/daemon.log
// Everything passes redactSecrets() first: every token/key the registry holds,
// well-known secret shapes (sk-…, hf_…, AIza…, ghp_…, xox?-…, Bearer …, JWTs,
// Telegram bot tokens…), user names inside home-folder paths, this machine's user
// name and host name. The full redacted report is saved as
// daemon/reports/<yyyymmdd-hhmmss>-<source>.md and the UI gets a prefilled
// github.com/…/issues/new link kept under 7000 characters.
//
// NOTHING is sent automatically: the owner reads the text in the dialog, and
// GitHub files the issue only when they press Submit there.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const ISSUE_NEW = "https://github.com/bagidea/bagidea-office/issues/new";
const URL_MAX = 7000;          // the prefilled link stays below this many characters
const ISSUE_LOG_LINES = 60;    // log tail inside the issue body …
const FILE_LOG_LINES = 400;    // … and inside the saved report
const ISSUE_ERROR_MAX = 3000;  // error text inside the issue body …
const FILE_ERROR_MAX = 20000;  // … and inside the saved report
const KEEP_REPORTS = 50;       // daemon/reports/ keeps the newest N files
const R = "[REDACTED]";

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wellFormed = (s) => (typeof s.toWellFormed === "function" ? s.toWellFormed() : s);
const oneLine = (v, n = 300) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const noFence = (s) => String(s == null ? "" : s).replace(/`{3,}/g, "'''");

// ---- secrets -------------------------------------------------------------------
// Field names whose string values are credentials, wherever they sit in the registry.
const SECRET_FIELD = /token|secret|passw(or)?d|api[-_]?key|^key$|^auth(orization)?$|bearer|cookie|credential/i;

// Every credential the office stores — providerConfig.*.token, apiKeys.*,
// channels.*.{token,secret} — plus any other secret-named field (MCP server
// env/headers, exec backends, webhook secrets, fields added later). Longest
// first, so a key that contains another one is replaced whole.
function collectSecrets(reg) {
  const out = new Set();
  if (!reg || typeof reg !== "object") return [];
  const keyNames = new Set(Object.keys(reg.apiKeys || {}));   // a field that NAMES a key isn't one
  const add = (v) => {
    if (typeof v !== "string") return;
    v = v.trim();
    if (v.length >= 6 && !keyNames.has(v)) out.add(v);
  };
  for (const pc of Object.values(reg.providerConfig || {})) if (pc && typeof pc === "object") { add(pc.token); add(pc.apiKey); add(pc.key); }
  for (const v of Object.values(reg.apiKeys || {})) add(v);
  for (const ch of Object.values(reg.channels || {})) if (ch && typeof ch === "object") { add(ch.token); add(ch.secret); }
  const walk = (o, depth, all) => {
    if (!o || typeof o !== "object" || depth > 8) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") { if (all ? v.trim().length >= 8 : SECRET_FIELD.test(k)) add(v); }
      else if (v && typeof v === "object") walk(v, depth + 1, all || /^(env|headers)$/i.test(k));
    }
  };
  walk(reg, 0, false);
  return [...out].sort((a, b) => b.length - a.length);
}

// Account names that identify no one — never swapped out as "the user".
const GENERIC_NAME = /^(root|user|users|admin|administrator|default|public|guest|node|app|home|system|test|owner|shared|localhost|runner)$/i;

// Redact credentials and identity from any text. opts = { reg | secrets,
// username, hostname, home } — the last three default to this machine (tests
// pin them). Idempotent: running it twice changes nothing more.
function redactSecrets(text, opts = {}) {
  let s = text == null ? "" : wellFormed(String(text));
  if (!s) return s;
  // 1. the office's own credentials, verbatim
  const secrets = Array.isArray(opts.secrets) ? opts.secrets : collectSecrets(opts.reg);
  for (const v of secrets) if (typeof v === "string" && v.length >= 6 && s.includes(v)) s = s.split(v).join(R);
  // 2. well-known credential shapes, whether the office knows them or not
  s = s
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED-JWT]")
    .replace(/\b(Bearer)(\s+)(?!\[REDACTED)[A-Za-z0-9._~+/=-]{8,}/gi, "$1$2" + R)
    .replace(/\bsk[-_](?!\[REDACTED)[A-Za-z0-9_-]{8,}/g, (m) => m.slice(0, 3) + R)
    .replace(/\bhf_[A-Za-z0-9]{8,}/g, "hf_" + R)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza" + R)
    .replace(/\b(gh[pousr]_)[A-Za-z0-9]{16,}/g, "$1" + R)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_" + R)
    .replace(/\b(xox[abposr]-)[A-Za-z0-9-]{8,}/g, "$1" + R)
    .replace(/\d{6,12}:[A-Za-z0-9_-]{30,}/g, "[REDACTED-BOT-TOKEN]")
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED-AWS-KEY]")
    // HF_TOKEN=…  ·  token=… / api_key: '…'  ·  --token …  ·  "apiKey": "…"  ·  ?key=…
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))(\s*=\s*)(["']?)(?!\[REDACTED)[^\s"'&,;]{6,}/g, "$1$2$3" + R)
    .replace(/\b((?:api|access|auth|refresh|bot|client)?[-_]?(?:api[-_]?key|apikey|token|secret|password|passwd))(\s*[=:]\s*)(["']?)(?!\[REDACTED)[^\s"'&,;]{6,}/gi, "$1$2$3" + R)
    .replace(/(^|[^\w-])(--?(?:api[-_]?key|token|secret|password|hf[-_]token|auth[-_]?token)(?:=|[ \t]+))(["']?)(?!\[REDACTED)[^\s"']{6,}/gim, "$1$2$3" + R)
    .replace(/("(?:[\w-]*(?:token|secret|password|passwd|api[-_]?key|apikey)|key|authorization)"\s*:\s*")(?!\[REDACTED)[^"]{6,}"/gi, "$1" + R + '"')
    .replace(/([?&](?:key|api[-_]?key|token|access_token|auth|secret|sig|signature|x-amz-signature|x-amz-credential)=)(?!\[REDACTED)[^&\s"'#]+/gi, "$1" + R)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "<email>");
  // 3. who and where: the user name inside home-folder paths (Windows, also
  //    JSON-escaped and forward-slashed; Linux; macOS), then this machine's home
  //    folder, user name and host name wherever they still appear.
  s = s
    .replace(/([A-Za-z]:(?:\\{1,2}|\/)(?:Users|Documents and Settings)(?:\\{1,2}|\/))((?:[^\\/\s"'<>|:*?]{1,40} ){0,3}[^\\/\s"'<>|:*?]{1,40}(?=\\|\/)|[^\\/\s"'<>|:*?]+)/gi, "$1<user>")
    .replace(/(\/(?:home|Users)\/)([^/\s"'<>:]+)/g, "$1<user>");
  const home = opts.home !== undefined ? opts.home : safe(() => os.homedir(), "");
  if (typeof home === "string" && home.length >= 6 && !/^([A-Za-z]:)?[\\/]+(root)?[\\/]*$/i.test(home)) {
    for (const h of new Set([home, home.replace(/\\/g, "/"), home.replace(/\\/g, "\\\\")]))
      s = s.replace(new RegExp(reEsc(h) + "(?![\\w.-])", "gi"), "~");
  }
  const who = [];
  const users = opts.username !== undefined ? [opts.username] : [safe(() => os.userInfo().username, ""), process.env.USERNAME, process.env.USER];
  const hosts = opts.hostname !== undefined ? [opts.hostname] : [safe(() => os.hostname(), ""), process.env.COMPUTERNAME];
  for (const u of users) who.push([u, "<user>"]);
  for (const h of hosts) { who.push([h, "<host>"]); if (typeof h === "string" && h.includes(".")) who.push([h.split(".")[0], "<host>"]); }
  who.filter(([n]) => typeof n === "string" && n.trim().length >= 3 && !GENERIC_NAME.test(n.trim()))
    .sort((a, b) => b[0].trim().length - a[0].trim().length)
    .forEach(([n, tag]) => { s = s.replace(new RegExp("(?<![A-Za-z0-9_])" + reEsc(n.trim()) + "(?![A-Za-z0-9_])", "gi"), tag); });
  return s;
}

// ---- machine facts --------------------------------------------------------------
// The office version is the VERSION file (what /version and the updater use);
// package.json is only the fallback — its "version" field is not maintained.
function officeVersion(daemonDir = __dirname) {
  const root = path.join(daemonDir, "..");
  const v = safe(() => fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(), "");
  if (v) return v;
  return safe(() => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, "") || "unknown";
}

// GPU line via nvidia-smi (absent on most machines → "none detected"). Runs at
// most once per daemon — a failed probe is retried after 10 minutes — with a
// 3 s timeout, and never through a shell.
let _gpu = null;
function gpuInfo() {
  if (_gpu && (_gpu.ok || Date.now() - _gpu.at < 600000)) return _gpu.p;
  const me = { at: Date.now(), ok: false, p: null };
  me.p = new Promise((resolve) => {
    try {
      execFile("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
        { timeout: 3000, windowsHide: true }, (err, out) => {
          if (err) return resolve(err.code === "ENOENT" ? "none detected (no nvidia-smi)" : `unknown (nvidia-smi ${err.killed ? "timed out" : "failed"})`);
          const gpus = String(out || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s*,\s*/).join(" · "));
          resolve(gpus.join("; ") || "none detected");
        });
    } catch { resolve("unknown"); }
  }).then((v) => { me.ok = !/^unknown/.test(v); return v; });
  _gpu = me;
  return me.p;
}

// The last `n` lines of a log (reads at most its final 512 KB). A missing file
// comes back as missing.
function tailLines(file, n = FILE_LOG_LINES) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, "r");
    if (len) fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/)
      .map((l) => (l.includes("\r") ? l.slice(l.lastIndexOf("\r") + 1) : l));   // progress bars redraw with \r
    if (size > len) lines.shift();                       // the first line was cut in half
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return { lines: lines.slice(-n).map((l) => (l.length > 1000 ? l.slice(0, 1000) + " …" : l)), missing: false };
  } catch { return { lines: [], missing: true }; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch {} } }
}

// ---- the report -----------------------------------------------------------------
// A small, flat context object: ≤ 12 keys, one-line values.
function cleanContext(ctx) {
  const out = {};
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return out;
  for (const [k, v] of Object.entries(ctx).slice(0, 12)) {
    const key = String(k).replace(/[^\w.-]/g, "").slice(0, 40);
    if (!key || v === undefined || typeof v === "function") continue;
    out[key] = oneLine(v !== null && typeof v === "object" ? safe(() => JSON.stringify(v), String(v)) : v, 300);
  }
  return out;
}

function reportTitle(r) {
  const first = String(r.error || "").split(/\r?\n/).find((l) => l.trim()) || "";
  return oneLine(`[${r.source}] ${oneLine(r.step, 60) || "error"}${first ? ": " + oneLine(first, 90) : ""}`, 140);
}

// Markdown for one report. r = { source, step, error, context, when,
// env: { version, os, platform, arch, node, gpu }, logName, logMissing, logLines }.
// o = { logLines: how many tail lines to include, errorMax, note }.
function buildReport(r, o = {}) {
  const env = r.env || {};
  const all = r.logLines || [];
  const want = o.logLines !== undefined ? o.logLines : all.length;
  const lines = want > 0 ? all.slice(-want) : [];
  const errMax = o.errorMax || FILE_ERROR_MAX;
  let err = noFence(r.error).trim();
  if (err.length > errMax) err = err.slice(0, errMax) + `\n… (${err.length - errMax} more characters)`;
  const L = [
    "### 🐞 Problem report",
    "",
    `**Step:** ${oneLine(r.step) || "—"}  `,
    `**Source:** \`${r.source}\`  `,
    `**When:** ${r.when || new Date().toISOString()}`,
    "",
    "**Environment**",
    `- Office: v${env.version || "?"}`,
    `- OS: ${env.os || "?"} (${env.platform || "?"}/${env.arch || "?"})`,
    `- Node: ${env.node || "?"}`,
    `- GPU: ${env.gpu || "?"}`,
    "",
    "**Error**",
    "```",
    err || "(no error text)",
    "```",
  ];
  const ctx = Object.entries(r.context || {});
  if (ctx.length) { L.push("", "**Context**"); for (const [k, v] of ctx) L.push(`- ${k}: \`${noFence(v).replace(/`/g, "'")}\``); }
  L.push("");
  if (r.logMissing) L.push(`**Log:** \`${r.logName}\` was not found on this machine.`);
  else if (!lines.length) L.push(`**Log:** \`${r.logName}\` — ${all.length ? "left out to keep the link short" : "empty"}.`);
  else L.push(`<details><summary>${r.logName} — last ${lines.length} line${lines.length === 1 ? "" : "s"}</summary>`, "", "```", ...lines.map(noFence), "```", "", "</details>");
  if (o.note) L.push("", "> " + o.note);
  L.push("", "_Prepared by BagIdea Office's “report to the dev team” button. Tokens, keys, user names and the computer name were redacted automatically; nothing was sent until the reporter pressed Submit on GitHub._");
  return L.join("\n");
}

// ---- the GitHub link -------------------------------------------------------------
function issueLink(title, body) {
  return ISSUE_NEW + "?title=" + encodeURIComponent(wellFormed(String(title || ""))) +
    "&body=" + encodeURIComponent(wellFormed(String(body || "")));
}
const cutAt = (s, n) => { let c = s.slice(0, Math.max(0, n)); if (/[\uD800-\uDBFF]$/.test(c)) c = c.slice(0, -1); return c; };

// Prefilled issues/new link kept under `max` characters. A body that doesn't fit
// is cut (an open code fence / <details> is closed again) and `note` is appended
// so the reporter knows to attach the saved file. → { url, body, truncated }
function issueUrl(title, body, { max = URL_MAX, note = "" } = {}) {
  title = oneLine(title, 140);
  body = wellFormed(String(body == null ? "" : body));
  const whole = issueLink(title, body);
  if (whole.length < max) return { url: whole, body, truncated: false };
  const finish = (cut) => {
    cut = cut.replace(/\s+$/, "") + " …";
    if ((cut.match(/^```/gm) || []).length % 2) cut += "\n```";
    if ((cut.match(/<details>/g) || []).length > (cut.match(/<\/details>/g) || []).length) cut += "\n\n</details>";
    return cut + "\n\n> " + (note || "✂ Shortened to fit the link.");
  };
  let lo = 0, hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (issueLink(title, finish(cutAt(body, mid))).length < max) lo = mid; else hi = mid - 1;
  }
  let b = finish(cutAt(body, lo));
  // the closers make the length a little non-monotonic — step back until it fits
  for (let n = lo; issueLink(title, b).length >= max && n > 0; n -= 50) b = finish(cutAt(body, n - 50));
  return { url: issueLink(title, b), body: b, truncated: true };
}

// Shrink a report until its link fits: fewer log lines first, then a shorter
// error, and only then a hard cut. compose({ logLines, errorMax, note }) → markdown.
function fitIssue(title, compose, { max = URL_MAX, note = "" } = {}) {
  const t = oneLine(title, 140);
  let body = compose({ logLines: ISSUE_LOG_LINES, errorMax: ISSUE_ERROR_MAX });
  let url = issueLink(t, body);
  if (url.length < max) return { url, body, truncated: false };
  for (const [n, em] of [[40, ISSUE_ERROR_MAX], [25, ISSUE_ERROR_MAX], [12, 2000], [6, 1500], [0, 1200], [0, 700], [0, 400]]) {
    body = compose({ logLines: n, errorMax: em, note });
    url = issueLink(t, body);
    if (url.length < max) return { url, body, truncated: true };
  }
  return issueUrl(t, compose({ logLines: 0, errorMax: 400 }), { max, note });
}

// Keep daemon/reports/ bounded (names start with the timestamp → sort = age).
function pruneReports(dir, keep = KEEP_REPORTS) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  } catch {}
}

// Build, redact and save one report → what the UI dialog shows.
// input = { source, step, error, context, logSource: "daemon" }
// deps  = { reg, daemonDir, version, now, gpu, username, hostname, home }
//         (tests pin the machine facts; the daemon passes reg + its own dir).
async function prepareReport(input, deps = {}) {
  const p = input && typeof input === "object" ? input : {};
  const daemonDir = deps.daemonDir || __dirname;
  const redOpts = { secrets: collectSecrets(deps.reg), username: deps.username, hostname: deps.hostname, home: deps.home };
  const red = (s) => redactSecrets(s, redOpts);
  const source = String(p.source || "ui").replace(/[^\w-]/g, "").slice(0, 40) || "ui";
  const logName = "daemon.log";
  const tail = tailLines(path.join(daemonDir, logName), FILE_LOG_LINES);
  const now = deps.now instanceof Date ? deps.now : new Date();
  // Redact the pieces BEFORE they are trimmed to fit, so a cut can never leave
  // half a token behind; the composed markdown is redacted once more.
  const ctx = cleanContext(p.context);
  for (const k of Object.keys(ctx)) ctx[k] = red(ctx[k]);
  const r = {
    source, step: red(oneLine(p.step, 160)), error: red(String(p.error == null ? "" : p.error).slice(0, FILE_ERROR_MAX * 2)),
    context: ctx, when: now.toISOString(),
    env: {
      version: deps.version || officeVersion(daemonDir),
      os: `${safe(() => os.type(), "?")} ${safe(() => os.release(), "")}`.trim(),
      platform: process.platform, arch: process.arch, node: process.version,
      gpu: deps.gpu !== undefined ? deps.gpu : await gpuInfo(),
    },
    logName, logMissing: tail.missing, logLines: tail.lines.map(red),
  };
  const title = red(reportTitle(r));
  // the full report → daemon/reports/<yyyymmdd-hhmmss>-<source>.md
  const dir = path.join(daemonDir, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let id = `${stamp}-${source}`;
  for (let i = 2; fs.existsSync(path.join(dir, id + ".md")); i++) id = `${stamp}-${source}-${i}`;
  const file = path.join(dir, id + ".md");
  fs.writeFileSync(file, red(`# ${title}\n\n` + buildReport(r, { logLines: FILE_LOG_LINES, errorMax: FILE_ERROR_MAX })) + "\n", "utf8");
  pruneReports(dir);
  // the issue body: the same report, trimmed until the prefilled link fits
  const note = `✂ Shortened to fit the link. The full report is saved on the reporter's computer as \`daemon/reports/${id}.md\` — please attach it.`;
  const fit = fitIssue(title, (o) => red(buildReport(r, o)), { note });
  return { ok: true, id, file, title, body: fit.body, issueUrl: fit.url, truncated: fit.truncated };
}

module.exports = {
  redactSecrets, collectSecrets, buildReport, reportTitle, cleanContext, issueLink, issueUrl, fitIssue,
  prepareReport, tailLines, gpuInfo, officeVersion, ISSUE_NEW, URL_MAX,
};
