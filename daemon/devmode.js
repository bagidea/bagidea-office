"use strict";
// 🛠 DEV MODE helpers — shared by the daemon (task.progress payloads) and
// mirrored verbatim in overlay.html (client-side defence in depth).
// CommonJS, zero dependencies. Everything here is bounded: depth ≤ 10,
// breadth ≤ 100, strings ≤ 1024 chars, detail ≤ 2000 chars, circular-safe.

const MAX_DEPTH = 10;
const MAX_BREADTH = 100;
const MAX_STRING = 1024;
const MAX_DETAIL = 2000;
const MAX_LABEL = 60;

// Key-name patterns that mark a value as a secret. Keys are normalised
// (camelCase → snake_case, lower-cased) before matching, and the match must
// sit on a word boundary so `input_tokens` / `max_tokens` / `keyboard` are
// NOT treated as secrets while `apiKey` / `access_token` / `x-api-key` are.
const SECRET_KEY_RE = /(^|[^a-z0-9])(api[_-]?key|apikey|x-api-key|authorization|bearer|token|access[_-]?token|refresh[_-]?token|passw(?:or)?d|secret|client[_-]?secret|private[_-]?key|credentials?|cookie|set-cookie)(?![a-z0-9])/;

function normKey(k) {
  return String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function isSecretKey(k) { return SECRET_KEY_RE.test(normKey(k)); }

// FULL replacement: any non-empty secret becomes the fixed placeholder
// "••••••" — never a character of the secret, never its length. (The old
// first-8 + last-4 form leaked 12 characters of every secret.) Empty / null /
// undefined → "". Numbers, booleans and bigints under a secret key are
// stringified first, so they get the placeholder too.
const MASK = "••••••";
function mask(v) {
  v = String(v === undefined || v === null ? "" : v);
  return v ? MASK : "";
}

// CLI-flag replacement helper: keeps the flag (`head`) and the quotes, masks
// the inside. Exactly one of dq / sq / uq is defined (double-, single-, unquoted).
function maskFlagValue(m, head, dq, sq, uq) {
  if (dq !== undefined) return head + '"' + mask(dq) + '"';
  if (sq !== undefined) return head + "'" + mask(sq) + "'";
  return head + mask(uq);
}

// Values that look like credentials even under an innocent key name
// (e.g. a Bash command containing `Authorization: Bearer sk-…`). Every rule
// substitutes the fixed placeholder, so a span that an earlier rule already
// masked is simply re-masked by a later one (idempotent). One ordering
// constraint: the URL rules run BEFORE the key=value rule, so the userinfo of
// `https://x-access-token:ghp_…@github.com/…` is consumed as a whole and the
// key=value rule cannot swallow the host after `token:`.
const VALUE_PATTERNS = [
  // Authorization header schemes
  [/\b(Bearer|Basic)\s+([A-Za-z0-9\-._~+\/=]{8,})/g, (m, scheme, tok) => scheme + " " + mask(tok)],
  // OpenAI / Anthropic style keys
  [/\b(sk-[A-Za-z0-9_\-]{8,})/g, (m, tok) => mask(tok)],
  // GitHub tokens
  [/\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, (m, tok) => mask(tok)],
  // Slack tokens
  [/\b(xox[abpr]-[A-Za-z0-9\-]{10,})/g, (m, tok) => mask(tok)],
  // Google API keys
  [/\b(AIza[0-9A-Za-z\-_]{30,})/g, (m, tok) => mask(tok)],
  // AWS access key ids
  [/\b(AKIA[0-9A-Z]{16})\b/g, (m, tok) => mask(tok)],
  // URL / connection-string credentials: scheme://user[:pass]@host →
  // scheme://••••••@host. Any scheme (https, postgres, mongodb+srv, redis,
  // amqp, ssh…). The WHOLE userinfo goes — username included — so a
  // GitHub-style token-only userinfo (https://ghp_…@github.com) is covered.
  [/\b([a-z][a-z0-9+.\-]*:\/\/)([^\s\/@]+)@(?=[A-Za-z0-9\[])/gi, (m, scheme) => scheme + MASK + "@"],
  // Bare user:pass@host (no scheme) as found in connection strings. The
  // userinfo must be contiguous (no whitespace, so `Authorization: Bearer x`
  // cannot match), the user part must start with a letter/underscore (so a
  // clock time `12:30@…` cannot), and `@` must be followed by a host char.
  [/(^|[\s"'=,(\[])(?!mailto:)([A-Za-z_][^\s"'\/@:=,(\[]*:[^\s"'\/@]+)@(?=[A-Za-z0-9\[])/g, (m, pre) => pre + MASK + "@"],
  // key=value / key: value pairs inside free text (query strings, env lines, JSON-ish)
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|x-api-key|authorization|token|secret|passw(?:or)?d)\s*[=:]\s*["']?)(?!(?:Bearer|Basic)\b)([^\s"'&;,]{6,})/gi,
    (m, head, val) => head + mask(val)],
  // CLI header flags (-H / --header). When the header NAME is secret-ish
  // (Authorization, X-Api-Key, Cookie, X-Auth-Token…) the header VALUE is
  // masked as a whole, scheme word included: `-H 'Authorization: ••••••'`.
  // Content-Type & co. are left alone. Quotes are kept.
  [/((?:^|\s)(?:-H|--[Hh]eader)(?:\s+|=))(?:"([^"]*)"|'([^']*)'|(?!-)(\S+))/g, (m, head, dq, sq, uq) => {
    const q = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    const val = dq !== undefined ? dq : sq !== undefined ? sq : uq;
    const i = val.indexOf(":");
    if (i < 1 || !isSecretKey(val.slice(0, i).trim()) || !val.slice(i + 1).trim()) return m;
    return head + q + val.slice(0, i + 1) + " " + mask(val.slice(i + 1)) + q;
  }],
  // CLI long flags whose NEXT argument is the secret (--password x, --token=x,
  // --api-key "x"…). Quotes kept, inside masked; unquoted values run to the
  // next whitespace; a value starting with `-` is another flag and is left
  // alone. The flag name must end at whitespace or `=`, so --port /
  // --token-file / --passphrase-file do not match.
  [/((?:^|\s)--(?:password|passwd|passphrase|pass|pwd|token|api[-_]?key|apikey|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|auth|bearer|key|private[-_]?key|cookie|credentials?)(?:\s+|=))(?:"([^"]*)"|'([^']*)'|(?!-)(\S+))/gi,
    maskFlagValue],
  // CLI short flags -p / -P / -k followed by whitespace and a non-flag token
  // (mysql -p x, psql -P x). The flag must be preceded by whitespace or start
  // of string, so `top-p 0.9` is untouched. A URL value is skipped
  // (curl -k https://…): URL credentials are the URL rule's job.
  [/((?:^|\s)-[pPk]\s+)(?:"([^"]*)"|'([^']*)'|(?!-)(?![A-Za-z][A-Za-z0-9+.\-]*:\/\/)(\S+))/g, maskFlagValue],
  // CLI -u / --user user:pass (curl): the whole value goes, username too. A
  // `:` is required in the value, so `git push -u origin` / `mysql -u root`
  // are untouched.
  [/((?:^|\s)(?:-u|--user)(?:\s+|=))(?:"([^"\s]*:[^"]*)"|'([^'\s]*:[^']*)'|(?!-)(\S*:\S*))/g, maskFlagValue],
];

function maskInString(s) {
  let out = String(s);
  for (const [re, fn] of VALUE_PATTERNS) out = out.replace(re, fn);
  return out;
}

function truncStr(s) {
  return s.length > MAX_STRING ? s.slice(0, MAX_STRING) + "…<truncated>" : s;
}

// Recursive, key-pattern based redaction. Returns a NEW structure (never
// mutates the input). `force` masks every string leaf — used below a key
// that is itself secret-ish (credentials: { user, password }).
function redactSecrets(obj, depth = 0, ancestors = new Set(), force = false) {
  if (obj === null || obj === undefined) return obj;
  const t = typeof obj;
  if (t === "string") return force ? mask(obj) : truncStr(maskInString(obj));
  if (t === "number" || t === "boolean") return force ? mask(obj) : obj;
  if (t === "bigint") return force ? mask(obj) : obj.toString();
  if (t === "function" || t === "symbol") return "<" + t + ">";
  if (depth > MAX_DEPTH) return "<max-depth>";
  if (ancestors.has(obj)) return "<circular>";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(obj)) return "<binary " + obj.length + " bytes>";
  if (ArrayBuffer.isView(obj)) return "<binary " + obj.byteLength + " bytes>";
  if (obj instanceof Date) return isNaN(obj) ? "<invalid date>" : obj.toISOString();
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_BREADTH).map((v) => redactSecrets(v, depth + 1, ancestors, force));
      if (obj.length > MAX_BREADTH) out.push("<+" + (obj.length - MAX_BREADTH) + " more>");
      return out;
    }
    let keys;
    try { keys = Object.keys(obj); } catch { return "<unreadable>"; }
    const out = {};
    for (let i = 0; i < keys.length; i++) {
      if (i >= MAX_BREADTH) { out["<more>"] = "+" + (keys.length - MAX_BREADTH) + " keys"; break; }
      const k = keys[i];
      let v;
      try { v = obj[k]; } catch { out[k] = "<unreadable>"; continue; }
      const secret = force || isSecretKey(k);
      if (secret && v !== null && v !== undefined && typeof v !== "object") out[k] = mask(v);
      else out[k] = redactSecrets(v, depth + 1, ancestors, secret);
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}

function safeJson(v, indent) {
  try { return JSON.stringify(v, null, indent); } catch { return String(v); }
}
function str(v) {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : safeJson(v);
}
function cap(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function firstLine(s) { return String(s).split(/\r?\n/)[0].trim(); }
function baseName(p) { const s = String(p); const m = s.match(/([^\\\/]+)[\\\/]*$/); return m ? m[1] : s; }

// Human-readable description of one tool call. `detail` is ALWAYS redacted
// and capped at MAX_DETAIL; `label` is a ≤ 60 char one-line preview for the
// collapsed row; `kind` groups tools for styling.
function toolDetail(name, input) {
  const tool = String(name || "");
  const inp = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  let kind = "tool", detail = "", label = "";
  if (/^(bash|powershell|shell|sh|cmd|terminal)$/i.test(tool)) {
    kind = "command";
    detail = str(inp.command !== undefined ? inp.command : (inp.cmd !== undefined ? inp.cmd : inp.script));
    label = firstLine(detail);
  } else if (/^skill$/i.test(tool)) {
    kind = "skill";
    const sk = str(inp.skill !== undefined ? inp.skill : inp.name);
    const args = str(inp.args);
    detail = [sk, args].filter(Boolean).join(" ");
    label = sk;
  } else if (/^(read|write|edit|multiedit|notebookedit|notebookread)$/i.test(tool)) {
    kind = "file";
    detail = str(inp.file_path !== undefined ? inp.file_path : (inp.path !== undefined ? inp.path : inp.notebook_path));
    label = baseName(detail);
  } else if (/^(glob|grep)$/i.test(tool)) {
    kind = "search";
    detail = str(inp.pattern);
    if (inp.path) detail += "  in " + str(inp.path);
    label = firstLine(str(inp.pattern));
  } else if (/^(agent|task)$/i.test(tool)) {
    detail = str(inp.description !== undefined ? inp.description : inp.prompt);
    label = firstLine(detail);
  }
  if (!detail) {
    detail = safeJson(redactSecrets(inp), 1);
    if (detail === "{}") detail = "";
  } else {
    detail = maskInString(detail);
  }
  return { kind, label: cap(maskInString(label), MAX_LABEL), detail: cap(detail, MAX_DETAIL) };
}

// task.progress payload: the tool input (redacted) + detail are attached ONLY
// when devMode is true; otherwise the event is exactly the base event.
function progressEvent(base, input, devMode) {
  const ev = Object.assign({}, base);
  if (devMode !== true) return ev;
  if (input && typeof input === "object") ev.input = redactSecrets(input);
  const d = toolDetail(base && base.tool, input);
  ev.kind = d.kind;
  if (d.label) ev.label = d.label;
  if (d.detail) ev.detail = d.detail;
  return ev;
}

module.exports = {
  redactSecrets, toolDetail, progressEvent, mask, maskInString, isSecretKey,
  MAX_DEPTH, MAX_BREADTH, MAX_STRING, MAX_DETAIL, MAX_LABEL,
};
