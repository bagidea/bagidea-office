"use strict";

// Portable office configuration, deliberately separate from runtime history and
// credential storage. ZIP members are descriptions, never extraction targets.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const zip = require("./office-zip");
const { BUILTIN_TOOLS, DEFAULT_SKILLS, SKILL_LIBRARY } = require("./constants");
const { frontmatter } = require("./skills");

const FORMAT = "bagidea-office";
const VERSION = 1;
const CATEGORIES = ["team", "skills", "mcp", "workflows", "settings"];
const BOOL_SETTINGS = ["sound", "tts", "ecoMode", "autoSkills", "nativeSkills", "verifyDelegated", "channelNotify"];
const NUMBER_SETTINGS = ["heartbeatMin", "socialMin", "proposalMin"];
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MARKDOWN_DIRS = new Set(["instructions", "settings", "rules", "skills", "workflows", ".claude", ".codex", ".agents"]);
const SECRET_KEY = /^(?:key|api.?key|access.?token|refresh.?token|auth.?token|token|secret|password|passwd|authorization|proxy-authorization|cookie|set-cookie|credential|private.?key)$/i;
const SECRET_FLAG = /(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|secret|password|passwd|authorization|credential)/i;
const PLACEHOLDER = /^(?:\$\{[\w-]+\}|\$[A-Z_][A-Z_0-9]*|%[\w-]+%|\[REDACTED\])$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) { throw new Error("Office import/export: " + message); }
function own(o, key) { return Object.prototype.hasOwnProperty.call(o, key); }
function optional(o, key, fallback) { return own(o, key) ? o[key] : fallback; }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(label + " must be an object");
  return value;
}
function inspect(value, depth = 0) {
  if (depth > 24) fail("configuration is too deeply nested");
  if (typeof value === "number" && !Number.isFinite(value)) fail("configuration has a non-finite number");
  if (typeof value === "string" && value.length > zip.MAX_ENTRY_BYTES) fail("configuration text is too large");
  if (!value || typeof value !== "object") return;
  if (Object.keys(value).length > 10000) fail("configuration has too many fields");
  for (const [key, v] of Object.entries(value)) {
    if (BAD_KEYS.has(key)) fail("unsafe configuration key: " + key);
    inspect(v, depth + 1);
  }
}
function parse(bytes, label) {
  let out;
  try { out = JSON.parse(UTF8.decode(bytes)); } catch { fail(label + " is not valid UTF-8 JSON"); }
  inspect(out); return out;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function string(o, key, max, fallback = "") {
  if (!own(o, key)) return fallback;
  if (typeof o[key] !== "string" || o[key].length > max) fail(key + " must be text of at most " + max + " characters");
  return o[key];
}
function number(o, key, min, max, fallback) {
  if (!own(o, key)) return fallback;
  if (typeof o[key] !== "number" || !Number.isFinite(o[key]) || o[key] < min || o[key] > max) fail(key + " is outside the allowed range");
  return o[key];
}
function strings(value, label, max = 300) {
  if (!Array.isArray(value) || value.length > max || value.some((x) => typeof x !== "string" || x.length > 200)) fail(label + " must be a bounded list of text values");
  return [...new Set(value)];
}
function id(value, label = "id") {
  if (typeof value !== "string" || !/^[\w-]{1,80}$/.test(value) || BAD_KEYS.has(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) fail("invalid " + label);
  return value;
}
function map(value, label, clean, max = 1000) {
  const out = {}, seen = new Set(); object(value, label);
  if (Object.keys(value).length > max) fail(label + " has too many entries");
  for (const [key, v] of Object.entries(value)) {
    id(key, label + " id");
    if (seen.has(key.toLowerCase())) fail(label + " has case-colliding IDs");
    seen.add(key.toLowerCase()); out[key] = clean(v, key);
  }
  return out;
}
function selected(value, fallback = CATEGORIES) {
  if (value === undefined) return fallback.slice();
  if (!Array.isArray(value) || !value.length || value.some((s) => !CATEGORIES.includes(s))) fail("select at least one valid category");
  return [...new Set(value)];
}
function counts(entries) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const e of entries) out[e.category]++;
  return out;
}
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function isAbsolute(value) { return path.isAbsolute(value) || path.win32.isAbsolute(value); }

function cleanAgent(value, aid) {
  const a = object(value, "agent " + aid), px = object(optional(a, "persona", {}), "persona");
  const out = { name: string(a, "name", 80, aid), role: string(a, "role", 80, "Specialist"),
    avatar: number(a, "avatar", 1, 12, 1), aura: string(a, "aura", 40), prompt: string(a, "prompt", 32000),
    persona: { expertise: string(px, "expertise", 8000), personality: string(px, "personality", 8000), language: string(px, "language", 160), rules: string(px, "rules", 8000) },
    tier: number(a, "tier", 1, 3, 3), voice: string(a, "voice", 80),
    skills: strings(optional(a, "skills", []), "agent skills"), tools: strings(optional(a, "tools", []), "agent tools"),
    provider: string(a, "provider", 80, "claude"), model: string(a, "model", 160),
    memoryPlugins: strings(optional(a, "memoryPlugins", []), "memory plugins", 20) };
  if (!Number.isInteger(out.avatar) || !Number.isInteger(out.tier)) fail("agent avatar and tier must be integers");
  for (const s of out.skills) id(s, "assigned skill");
  if (own(a, "team")) out.team = string(a, "team", 80);
  return out;
}
function cleanSkill(value, sid) {
  const s = object(value, "skill " + sid);
  return { name: string(s, "name", 200, sid), description: string(s, "description", 2000), content: string(s, "content", 512000), edited: true };
}
function cleanTests(value) {
  if (!Array.isArray(value) || value.length > 12) fail("skill tests must be a list of at most 12 cases");
  return value.map((v) => {
    object(v, "skill test");
    const c = { prompt: string(v, "prompt", 1500), expect: string(v, "expect", 300), note: string(v, "note", 200) };
    if (!c.prompt || !c.expect) fail("skill tests require prompt and expect");
    try { new RegExp(c.expect.replace(/^!/, ""), "i"); } catch { fail("invalid skill test pattern"); }
    return c;
  });
}
function redactText(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join("[REDACTED]");
  // Preserve environment references, but never transport literal credentials.
  out = out.replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/g, "[REDACTED]");
  out = out.replace(/(\b([A-Z_][A-Z0-9_]*)\s*=\s*)("[^"]*"|'[^']*'|[^\s;]+)/g, (all, prefix, key, value) => (SECRET_KEY.test(key) || SECRET_FLAG.test(key)) && !PLACEHOLDER.test(value.replace(/^["']|["']$/g, "")) ? prefix + "[REDACTED]" : all);
  out = out.replace(/(^|\s)(--?[\w-]*(?:key|token|secret|password|passwd|authorization|credential)[\w-]*)(\s*=\s*|\s+)("[^"]*"|'[^']*'|[^\s]+)/g, (all, prefix, flag, sep, value) => !PLACEHOLDER.test(value.replace(/^["']|["']$/g, "")) ? prefix + flag + sep + "[REDACTED]" : all);
  out = out.replace(/((?:Authorization|Proxy-Authorization)\s*:\s*)(?:Bearer\s+|Basic\s+)?([^\s"'<>]+)/gi, (all, prefix, value) => PLACEHOLDER.test(value) ? all : prefix + "[REDACTED]");
  out = out.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const u = new URL(raw); let dirty = false;
      if (u.username || u.password) { u.username = ""; u.password = ""; dirty = true; }
      for (const key of [...u.searchParams.keys()]) if (SECRET_KEY.test(key) || SECRET_FLAG.test(key)) { u.searchParams.set(key, "[REDACTED]"); dirty = true; }
      return dirty ? u.toString() : raw;
    } catch { return raw; }
  });
  return out;
}
function sanitize(value, secrets = [], key = "") {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => sanitize(v, secrets));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "env" && v && typeof v === "object" && !Array.isArray(v)) { out[k] = Object.fromEntries(Object.keys(v).filter((n) => !BAD_KEYS.has(n)).map((n) => [n, ""])); continue; }
    if (BAD_KEYS.has(k) || SECRET_KEY.test(k)) continue;
    if (["cwd", "dir", "path", "workingDirectory", "backend"].includes(k) && typeof v === "string" && isAbsolute(v)) continue;
    out[k] = sanitize(v, secrets, k);
  }
  return out;
}
function cleanMcp(value, name) {
  const m = object(value, "MCP " + name), out = {};
  if (own(m, "command")) out.command = redactText(string(m, "command", 4000));
  if (own(m, "url")) out.url = redactText(string(m, "url", 4000));
  if (!out.command && !out.url) fail("MCP " + name + " needs a command or URL");
  if (out.command && isAbsolute(out.command.split(/\s/)[0])) { out.command = "[REDACTED]"; }
  if (own(m, "args")) {
    if (!Array.isArray(m.args) || m.args.length > 100 || m.args.some((a) => typeof a !== "string" || a.length > 4000)) fail("MCP args must be a bounded text list");
    out.args = m.args.map((v, i) => (i && SECRET_FLAG.test(m.args[i - 1]) && /^--?/.test(m.args[i - 1]) && !PLACEHOLDER.test(v)) || isAbsolute(v) ? "[REDACTED]" : redactText(v));
  }
  if (own(m, "env")) {
    object(m.env, "MCP environment"); out.env = {};
    if (Object.keys(m.env).length > 100) fail("too many MCP environment variables");
    for (const [key, value] of Object.entries(m.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(key) || BAD_KEYS.has(key) || typeof value !== "string") fail("invalid MCP environment variable");
      out.env[key] = "";
    }
  }
  return out;
}
function cleanWorkflow(value, wid) {
  const w = object(value, "workflow " + wid);
  if (w.id !== wid || wid.startsWith("example-")) fail("workflow id must match its filename and cannot replace examples");
  const inputEdges = optional(w, "edges", []);
  if (!Array.isArray(w.nodes) || w.nodes.length > 500 || !Array.isArray(inputEdges) || inputEdges.length > 2000) fail("invalid workflow graph");
  const seen = new Set();
  const nodes = w.nodes.map((n) => {
    object(n, "workflow node"); id(n.id, "node id");
    if (seen.has(n.id)) fail("duplicate workflow node id"); seen.add(n.id);
    const out = { id: n.id, type: string(n, "type", 40, "action"), text: string(n, "text", 32000), x: number(n, "x", -1000000, 1000000, 0), y: number(n, "y", -1000000, 1000000, 0) };
    id(out.type, "node type");
    if (own(n, "cfg")) out.cfg = sanitize(object(n.cfg, "node configuration"));
    return out;
  });
  const edges = inputEdges.map((e) => {
    object(e, "workflow edge");
    if (!seen.has(e.from) || !seen.has(e.to)) fail("workflow edge references a missing node");
    const out = { from: e.from, to: e.to };
    if (own(e, "label")) out.label = string(e, "label", 200);
    return out;
  });
  return { id: wid, name: string(w, "name", 200, wid), nodes, edges };
}
function cleanTrigger(value) {
  const t = object(value, "trigger"), cfg = object(optional(t, "cfg", {}), "trigger configuration");
  id(t.id, "trigger id"); id(t.workflowId, "trigger workflow");
  id(t.kind, "trigger kind");
  const out = { id: t.id, name: string(t, "name", 200), kind: t.kind, workflowId: t.workflowId, enabled: false, cfg: {}, lastRun: 0, runs: 0 };
  if (t.kind === "schedule") {
    out.cfg.everyMin = number(cfg, "everyMin", 0, 5256000, 0);
    out.cfg.at = string(cfg, "at", 5);
    if (out.cfg.at && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(out.cfg.at)) fail("invalid trigger time");
    if (own(cfg, "weekday")) { out.cfg.weekday = number(cfg, "weekday", 0, 6, 0); if (!Number.isInteger(out.cfg.weekday)) fail("invalid weekday"); }
  }
  if (t.kind === "event") out.cfg.type = string(cfg, "type", 100);
  if (t.kind === "file") out.cfg = { dir: "", glob: string(cfg, "glob", 200, "*") };
  if (t.kind === "channel") out.cfg.keyword = string(cfg, "keyword", 80);
  if (!["schedule", "webhook", "event", "file", "channel"].includes(t.kind)) {
    for (const [key, value] of Object.entries(sanitize(cfg))) {
      if (!/^[\w-]{1,40}$/.test(key) || !["string", "number", "boolean"].includes(typeof value)) fail("custom trigger settings must be primitive values");
      if (typeof value === "string" && value.length > 500) fail("custom trigger setting is too long");
      out.cfg[key] = value;
    }
  }
  return out;
}
function cleanPreferences(value) {
  const p = object(value, "office preferences"), out = {};
  for (const key of BOOL_SETTINGS) if (own(p, key)) { if (typeof p[key] !== "boolean") fail(key + " must be boolean"); out[key] = p[key]; }
  for (const key of NUMBER_SETTINGS) if (own(p, key)) out[key] = number(p, key, 0, 5256000);
  if (own(p, "lang")) { out.lang = string(p, "lang", 12); if (!/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(out.lang)) fail("invalid office language"); }
  if (own(p, "daylight")) { if (p.daylight !== "auto" && (typeof p.daylight !== "number" || p.daylight < 0 || p.daylight > 24)) fail("invalid daylight setting"); out.daylight = p.daylight; }
  for (const key of ["fallbackProvider", "fallbackModel"]) if (own(p, key)) out[key] = string(p, key, 160);
  return out;
}
function cleanOffice(value, categories) {
  const o = object(value, "office configuration"), out = { version: VERSION };
  if (o.version !== VERSION) fail("unsupported office configuration version");
  if (own(o, "team")) {
    if (!categories.includes("team")) fail("team is outside the manifest categories");
    object(o.team, "team"); out.team = { agents: map(optional(o.team, "agents", {}), "agents", cleanAgent, 100), roles: strings(optional(o.team, "roles", []), "roles", 100) };
  }
  if (own(o, "skills")) {
    if (!categories.includes("skills")) fail("skills are outside the manifest categories");
    object(o.skills, "skills"); out.skills = { definitions: map(optional(o.skills, "definitions", {}), "skills", cleanSkill), tests: map(optional(o.skills, "tests", {}), "skill tests", cleanTests) };
    for (const sid of Object.keys(out.skills.tests)) if (!own(out.skills.definitions, sid)) fail("skill tests reference an absent skill");
  }
  if (own(o, "mcp")) {
    if (!categories.includes("mcp")) fail("MCP is outside the manifest categories");
    object(o.mcp, "MCP"); out.mcp = { servers: map(optional(o.mcp, "servers", {}), "MCP", cleanMcp, 200) };
  }
  if (own(o, "workflows")) {
    if (!categories.includes("workflows")) fail("workflows are outside the manifest categories");
    object(o.workflows, "workflows");
    const inputTriggers = optional(o.workflows, "triggers", []);
    if (!Array.isArray(inputTriggers) || inputTriggers.length > 1000) fail("invalid trigger list");
    const triggers = inputTriggers.map(cleanTrigger), seen = new Set();
    for (const t of triggers) { if (seen.has(t.id.toLowerCase())) fail("duplicate trigger id"); seen.add(t.id.toLowerCase()); }
    out.workflows = { definitions: map(optional(o.workflows, "definitions", {}), "workflows", cleanWorkflow, 1000), triggers };
  }
  if (own(o, "settings")) {
    if (!categories.includes("settings")) fail("settings are outside the manifest categories");
    object(o.settings, "settings"); out.settings = { preferences: cleanPreferences(optional(o.settings, "preferences", {})) };
  }
  return out;
}

function markdownPath(relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/") || relative.includes(":") || relative.includes("\0") || !/\.md$/i.test(relative)) return false;
  const parts = relative.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || /[. ]$/.test(s) || /[<>"|?*\x00-\x1f]/.test(s) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) return false;
  if (parts.length === 1) return relative.toLowerCase() !== "notes.md";
  return MARKDOWN_DIRS.has(parts[0]) && !parts.slice(1).some((p) => ["node_modules", ".git", "runs", "agents", "plugins", "memory", "meetings", "projects", "uploads", "index"].includes(p.toLowerCase()));
}

module.exports = function officeTransfer(options) {
  const { reg } = options;
  const io = options.fs || fs;
  const workspace = path.resolve(options.workspace), daemonDir = path.resolve(options.daemonDir);
  const maxStaff = options.maxStaff || 18;
  const registryFile = path.join(daemonDir, "registry.json");
  const plans = new WeakMap();
  object(reg, "destination registry");
  function readBounded(file, limit = zip.MAX_ENTRY_BYTES) {
    if (io.statSync(file).size > limit) fail("existing file is too large for a portable import: " + path.basename(file));
    return io.readFileSync(file);
  }

  // Reject symlinks/junctions at every existing ancestor, including the configured
  // roots. This check is repeated immediately before each staged file is applied.
  function safeFile(root, relative) {
    if (!relative || isAbsolute(relative) || relative.includes("\\") || relative.split("/").some((s) => !s || s === "." || s === ".." || /[. ]$/.test(s) || /[<>:"|?*\x00-\x1f]/.test(s) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) fail("unsafe destination path");
    const target = path.resolve(root, ...relative.split("/"));
    const rel = path.relative(root, target);
    if (!rel || rel.startsWith(".." + path.sep) || rel === ".." || isAbsolute(rel)) fail("destination escapes its working folder");
    const parsed = path.parse(target), segments = target.slice(parsed.root.length).split(path.sep);
    let current = parsed.root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      let st; try { st = io.lstatSync(current); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
      if (st.isSymbolicLink()) fail("destination contains a symlink or junction: " + relative);
      if (i < segments.length - 1 && !st.isDirectory()) fail("destination ancestor is not a folder");
      if (i === segments.length - 1 && !st.isFile()) fail("destination is not a regular file: " + relative);
    }
    return target;
  }
  function exists(root, relative) { return io.existsSync(safeFile(root, relative)); }
  function readMarkdown() {
    const docs = []; let bytes = 0;
    function walk(relative, depth) {
      if (depth > 16) fail("Markdown folders are too deeply nested");
      const full = relative ? path.join(workspace, ...relative.split("/")) : workspace;
      let entries; try { entries = io.readdirSync(full, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return; throw e; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const name = relative ? relative + "/" + entry.name : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if ((!relative && MARKDOWN_DIRS.has(entry.name)) || (relative && markdownPath(name + "/x.md"))) walk(name, depth + 1);
        } else if (entry.isFile() && markdownPath(name)) {
          const file = safeFile(workspace, name);
          const size = io.statSync(file).size; bytes += size;
          if (size > zip.MAX_ENTRY_BYTES || bytes > zip.MAX_TOTAL_BYTES / 2) fail("Markdown files exceed the portable archive size limit");
          let content; try { content = UTF8.decode(readBounded(file)); } catch { fail("Markdown is not UTF-8: " + name); }
          docs.push({ path: name, content });
          if (docs.length > 1000) fail("too many Markdown files");
        }
      }
    }
    // Validate the workspace root before enumerating it.
    safeFile(workspace, ".office-transfer-root-check"); walk("", 0); return docs;
  }
  function workflowDefinitions() {
    const out = {}, root = path.join(workspace, "workflows"); let bytes = 0;
    safeFile(workspace, "workflows/.office-transfer-root-check");
    let files; try { files = io.readdirSync(root, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return out; throw e; }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const wid = file.name.slice(0, -5); if (wid.startsWith("example-")) continue; id(wid, "workflow id");
      const full = safeFile(workspace, "workflows/" + file.name);
      bytes += io.statSync(full).size;
      if (bytes > zip.MAX_TOTAL_BYTES / 2) fail("workflow files exceed the portable archive size limit");
      out[wid] = cleanWorkflow(parse(readBounded(full), file.name), wid);
    }
    return out;
  }
  function secretValues() {
    const values = new Set();
    function collect(o, all = false) {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && (all || SECRET_KEY.test(k) || SECRET_FLAG.test(k)) && !PLACEHOLDER.test(v) && v.length >= 4) values.add(v);
        else if (v && typeof v === "object") collect(v, all);
      }
    }
    collect(reg.apiKeys, true); collect(reg.providerConfig); collect(reg.channels); collect(reg.semantic);
    for (const m of Object.values(reg.mcpServers || {})) collect(m.env, true);
    return [...values].sort((a, b) => b.length - a.length);
  }
  function source(categories) {
    const office = { version: VERSION }, secrets = secretValues();
    if (categories.includes("team")) office.team = { agents: Object.fromEntries(Object.entries(reg.agents || {}).filter(([aid, a]) => aid !== "ceo" && !a.isUser).map(([aid, a]) => [aid, cleanAgent(a, aid)])), roles: reg.roles || [] };
    if (categories.includes("skills")) office.skills = { definitions: map(reg.skills || {}, "skills", cleanSkill), tests: Object.fromEntries(Object.entries(reg.skillTests || {}).filter(([sid]) => own(reg.skills || {}, sid)).map(([sid, tests]) => [sid, cleanTests(tests)])) };
    if (categories.includes("mcp")) office.mcp = { servers: map(reg.mcpServers || {}, "MCP", cleanMcp, 200) };
    if (categories.includes("workflows")) {
      const definitions = workflowDefinitions();
      office.workflows = { definitions, triggers: (reg.triggers || []).filter((t) => own(definitions, t.workflowId)).map(cleanTrigger) };
    }
    if (categories.includes("settings")) office.settings = { preferences: cleanPreferences(reg) };
    const docs = categories.includes("settings") ? readMarkdown().map((d) => ({ ...d, content: redactText(d.content, secrets) })) : [];
    let bytes = 0;
    function budget(v) { if (typeof v === "string") bytes += Buffer.byteLength(v); else if (v && typeof v === "object") for (const item of Object.values(v)) budget(item); if (bytes > zip.MAX_TOTAL_BYTES / 2) fail("office configuration exceeds the portable archive size limit"); }
    budget(office); budget(docs);
    return { office: cleanOffice(sanitize(office, secrets), categories), docs };
  }
  function entriesFor(data) {
    const { office, docs } = data, entries = [];
    function add(category, itemId, label, pathname, conflict, protectedItem = false) { entries.push({ category, id: itemId, label, path: pathname, conflict: !!conflict, protected: protectedItem }); }
    for (const [aid, a] of Object.entries(office.team?.agents || {})) add("team", aid, a.name, "daemon/registry.json → agents." + aid, own(reg.agents || {}, aid), aid === "ceo" || (aid !== "main" && !!reg.agents?.[aid]?.protected));
    if (office.team?.roles.length) add("team", "roles:all", "Team roles", "daemon/registry.json → roles", !!reg.roles?.length);
    for (const [sid, s] of Object.entries(office.skills?.definitions || {})) add("skills", sid, s.name, "daemon/registry.json → skills." + sid + "; assigned agents’ native SKILL.md files", own(reg.skills || {}, sid), !!(reg.skills?.[sid]?.builtin || SKILL_LIBRARY[sid]));
    for (const [mid] of Object.entries(office.mcp?.servers || {})) add("mcp", mid, mid, "daemon/registry.json → mcpServers." + mid, own(reg.mcpServers || {}, mid));
    for (const [wid, w] of Object.entries(office.workflows?.definitions || {})) add("workflows", wid, w.name, "workspace/workflows/" + wid + ".json", exists(workspace, "workflows/" + wid + ".json"));
    for (const t of office.workflows?.triggers || []) add("workflows", "trigger:" + t.id, t.name || t.id, "daemon/registry.json → triggers." + t.id, (reg.triggers || []).some((x) => x.id === t.id));
    if (office.settings && Object.keys(office.settings.preferences).length) add("settings", "preferences", "Office preferences", "daemon/registry.json → office preferences", Object.keys(office.settings.preferences).some((k) => own(reg, k)));
    for (const d of docs) add("settings", "markdown:" + d.path, d.path, "workspace/" + d.path, exists(workspace, d.path));
    return entries;
  }
  function summary() {
    const data = source(CATEGORIES), entries = entriesFor(data);
    return { categories: counts(entries), workspace, limits: { maxArchiveBytes: zip.MAX_ARCHIVE_BYTES }, warnings: ["Credentials, channel connections, machine paths, permission approvals and runtime history are excluded."] };
  }
  function exportArchive(categoriesArray) {
    const categories = selected(categoriesArray), data = source(categories), files = [];
    const add = (name, category, value) => files.push({ name, category, data: Buffer.from(value) });
    add("office.json", "configuration", JSON.stringify(data.office, null, 2));
    for (const [sid, s] of Object.entries(data.office.skills?.definitions || {})) add("skills/" + sid + "/SKILL.md", "skills", frontmatter(s, sid));
    for (const d of data.docs) add("workspace/" + d.path, "settings", d.content);
    const manifest = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), categories,
      files: files.map((f) => ({ path: f.name, category: f.category, size: f.data.length, sha256: sha(f.data) })) };
    return zip.encode([{ name: "manifest.json", data: JSON.stringify(manifest, null, 2) }, ...files]);
  }
  function readArchive(buffer) {
    const members = zip.decode(buffer), byName = new Map(members.map((f) => [f.name, f.data]));
    if (!byName.has("manifest.json") || !byName.has("office.json")) fail("ZIP must contain manifest.json and office.json");
    const manifest = object(parse(byName.get("manifest.json"), "manifest"), "manifest");
    if (manifest.format !== FORMAT || manifest.version !== VERSION) fail("unsupported archive format or version");
    const categories = selected(manifest.categories);
    if (!Array.isArray(manifest.files) || manifest.files.length !== members.length - 1) fail("manifest file list does not match the ZIP");
    const seen = new Set();
    for (const f of manifest.files) {
      object(f, "manifest file");
      if (typeof f.path !== "string" || f.path === "manifest.json" || seen.has(f.path) || !byName.has(f.path)) fail("invalid manifest file entry");
      const bytes = byName.get(f.path); seen.add(f.path);
      if (f.size !== bytes.length || f.sha256 !== sha(bytes)) fail("archive file checksum mismatch: " + f.path);
      const expected = f.path === "office.json" ? "configuration" : f.path.startsWith("skills/") ? "skills" : "settings";
      if (f.category !== expected) fail("manifest file category mismatch");
    }
    const office = cleanOffice(parse(byName.get("office.json"), "office configuration"), categories), docs = [];
    for (const [name, bytes] of byName) {
      if (name === "manifest.json" || name === "office.json") continue;
      const skill = /^skills\/([\w-]+)\/SKILL\.md$/.exec(name);
      if (skill) {
        const s = office.skills?.definitions[skill[1]];
        if (!s || UTF8.decode(bytes) !== frontmatter(s, skill[1])) fail("skill Markdown does not match its definition");
        continue;
      }
      if (!categories.includes("settings") || !name.startsWith("workspace/") || !markdownPath(name.slice(10))) fail("archive contains an unsupported file: " + name);
      let content; try { content = UTF8.decode(bytes); } catch { fail("Markdown must be UTF-8"); }
      docs.push({ path: name.slice(10), content: redactText(content) });
    }
    for (const sid of Object.keys(office.skills?.definitions || {})) if (!byName.has("skills/" + sid + "/SKILL.md")) fail("missing human-readable skill file");
    return { office, docs, selected: categories };
  }
  function validateReferences(next, workflows, changedAgents) {
    for (const aid of changedAgents) {
      const a = next.agents[aid];
      for (const sid of a.skills || []) if (!own(next.skills || {}, sid)) fail("Agent " + aid + " needs skill " + sid + ". Select the Skills category or install that skill first.");
      for (const tool of a.tools || []) {
        if (own(BUILTIN_TOOLS, tool)) continue;
        if (tool.startsWith("mcp:") && own(next.mcpServers || {}, tool.slice(4))) continue;
        fail("Agent " + aid + " needs tool " + tool + ". Select the MCP category or configure that tool first.");
      }
    }
    for (const w of Object.values(workflows)) for (const n of w.nodes) {
      const aid = (/^@([\w-]+)\s*:/.exec(n.text || "") || [])[1] || n.cfg?.agent;
      if (aid && (!own(next.agents || {}, aid) || aid === "ceo" || next.agents[aid].isUser)) fail("Workflow " + w.id + " references unavailable agent " + aid + ". Select the Team category first.");
    }
  }
  function previewArchive(buffer) {
    const data = readArchive(buffer), entries = entriesFor(data);
    checkDestinationIds(data);
    const prospective = clone(reg);
    prospective.agents = { ...(reg.agents || {}), ...(data.office.team?.agents || {}) };
    prospective.skills = { ...(reg.skills || {}), ...(data.office.skills?.definitions || {}) };
    prospective.mcpServers = { ...(reg.mcpServers || {}), ...(data.office.mcp?.servers || {}) };
    validateReferences(prospective, data.office.workflows?.definitions || {}, Object.keys(data.office.team?.agents || {}).filter((k) => k !== "ceo"));
    const definitions = data.office.workflows?.definitions || {};
    for (const t of data.office.workflows?.triggers || []) if (!own(definitions, t.workflowId) && !exists(workspace, "workflows/" + t.workflowId + ".json")) fail("trigger references a missing workflow");
    const warnings = ["Credentials, machine-specific paths, permission approvals and runtime history are excluded.", "Imported triggers remain disabled; review tools and workflows before running them."];
    if (Object.keys(data.office.mcp?.servers || {}).length) warnings.push("MCP environment values are omitted. Reconnect required credentials on this machine.");
    if (entries.some((e) => e.protected)) warnings.push("The human CEO, protected teammates and built-in skills are preserved.");
    if (data.office.team?.agents.main) warnings.push("Replacing existing items updates the Director’s portable profile while preserving the protected Director identity.");
    if ((data.office.workflows?.triggers || []).some((t) => !["schedule", "webhook", "event", "file", "channel"].includes(t.kind))) warnings.push("Custom triggers remain disabled and need their matching plugin installed.");
    const plan = { categories: counts(entries), entries, warnings };
    plans.set(plan, { bytes: Buffer.from(buffer), fingerprints: new Map(entries.map((e) => [e.category + ":" + e.id, fingerprint(e)])) }); return plan;
  }

  function fingerprint(entry) {
    let value;
    if (entry.path.startsWith("workspace/")) {
      const file = safeFile(workspace, entry.path.slice(10));
      return io.existsSync(file) ? sha(readBounded(file)) : "missing";
    }
    if (entry.category === "team") value = entry.id === "roles:all" ? reg.roles : reg.agents?.[entry.id] && { ...cleanAgent(reg.agents[entry.id], entry.id), protected: !!reg.agents[entry.id].protected, isUser: !!reg.agents[entry.id].isUser };
    if (entry.category === "skills") value = reg.skills?.[entry.id] && { definition: cleanSkill(reg.skills[entry.id], entry.id), tests: reg.skillTests?.[entry.id], builtin: !!reg.skills[entry.id].builtin };
    if (entry.category === "mcp") value = reg.mcpServers?.[entry.id];
    if (entry.category === "settings") value = cleanPreferences(reg);
    if (entry.category === "workflows") {
      const t = (reg.triggers || []).find((x) => x.id === entry.id.slice(8));
      if (t) value = { id: t.id, name: t.name, kind: t.kind, workflowId: t.workflowId, enabled: t.enabled, cfg: t.cfg };
    }
    return value === undefined ? "missing" : sha(Buffer.from(JSON.stringify(value)));
  }

  function checkDestinationIds(data) {
    const check = (incoming, current, label) => {
      const byCase = new Map(Object.keys(current || {}).map((s) => [s.toLowerCase(), s]));
      for (const key of Object.keys(incoming || {})) if (byCase.has(key.toLowerCase()) && byCase.get(key.toLowerCase()) !== key) fail(label + " ID " + key + " collides with an existing ID on this filesystem");
    };
    check(data.office.team?.agents, reg.agents, "Agent"); check(data.office.skills?.definitions, reg.skills, "Skill"); check(data.office.mcp?.servers, reg.mcpServers, "MCP");
    check(Object.fromEntries((data.office.workflows?.triggers || []).map((t) => [t.id, true])), Object.fromEntries((reg.triggers || []).map((t) => [t.id, true])), "Trigger");
    const workflowIds = {};
    safeFile(workspace, "workflows/.office-transfer-root-check");
    try { for (const f of io.readdirSync(path.join(workspace, "workflows"))) if (f.endsWith(".json")) workflowIds[f.slice(0, -5)] = true; } catch (e) { if (e.code !== "ENOENT") throw e; }
    check(data.office.workflows?.definitions, workflowIds, "Workflow");
  }

  function importArchive(plan, config = {}) {
    const saved = plans.get(plan); if (!saved) fail("preview expired; preview the archive again");
    const data = readArchive(saved.bytes), categories = selected(config.categories, data.selected), conflict = config.conflict || "skip";
    checkDestinationIds(data);
    if (!["skip", "replace"].includes(conflict)) fail("invalid conflict policy");
    if (categories.some((c) => !data.selected.includes(c))) fail("selected category is absent from this archive");
    const next = clone(reg), entries = entriesFor(data), imported = counts([]), skipped = counts([]), warnings = [], writes = new Map();
    const changedAgents = new Set(), changedSkills = new Set(), changedWorkflows = {};
    next.agents ||= {}; next.skills ||= {}; next.mcpServers ||= {};
    const taking = (category, itemId) => {
      const entry = entries.find((e) => e.category === category && e.id === itemId);
      if (!entry) return false;
      if (!categories.includes(category) || entry.protected || (entry.conflict && conflict === "skip")) { skipped[category]++; return false; }
      if (fingerprint(entry) !== saved.fingerprints.get(category + ":" + itemId)) fail(entry.label + " changed after preview. Preview the ZIP again before importing.");
      imported[category]++; return true;
    };
    const stage = (root, relative, content) => {
      const target = safeFile(root, relative), key = target.toLowerCase();
      if (writes.has(key)) fail("two imported files target the same path");
      writes.set(key, { root, relative, target, content: content === null ? null : Buffer.from(content) });
    };
    for (const [sid, sk] of Object.entries(data.office.skills?.definitions || {})) if (taking("skills", sid)) {
      next.skills[sid] = sk; changedSkills.add(sid);
      next.skillTests ||= {};
      if (own(data.office.skills.tests, sid)) next.skillTests[sid] = data.office.skills.tests[sid];
      else delete next.skillTests[sid];
    }
    for (const [mid, server] of Object.entries(data.office.mcp?.servers || {})) if (taking("mcp", mid)) {
      const old = next.mcpServers[mid] || {}, merged = { ...old, ...server };
      // Preserve configured destination credentials, including values whose
      // inline source field was deliberately redacted during export.
      if (server.env) merged.env = { ...server.env, ...(old.env || {}) };
      const oldPortable = old.command || old.url ? cleanMcp(old, mid) : {};
      for (const key of ["command", "url", "args"]) if (own(old, key) && (JSON.stringify(server[key] || "").includes("REDACTED") || JSON.stringify(oldPortable[key]) !== JSON.stringify(old[key]))) {
        merged[key] = old[key];
        warnings.push("Preserved locally configured MCP " + mid + " " + key + " to retain this machine’s credentials or executable path.");
      }
      next.mcpServers[mid] = merged;
    }
    for (const [aid, a] of Object.entries(data.office.team?.agents || {})) if (taking("team", aid)) {
      const current = next.agents[aid] || {};
      next.agents[aid] = { ...current, ...a };
      if (aid === "main") { next.agents[aid].protected = true; delete next.agents[aid].isUser; }
      changedAgents.add(aid);
    }
    if (data.office.team?.roles.length && taking("team", "roles:all")) next.roles = [...new Set([...(next.roles || []), ...data.office.team.roles])];
    if (Object.keys(next.agents).filter((k) => k !== "ceo").length > maxStaff) fail("office staff limit is " + maxStaff + "; remove teammates or import fewer team members first");
    for (const [wid, w] of Object.entries(data.office.workflows?.definitions || {})) if (taking("workflows", wid)) {
      changedWorkflows[wid] = w; stage(workspace, "workflows/" + wid + ".json", JSON.stringify(w, null, 2));
    }
    const incomingTriggers = data.office.workflows?.triggers || [];
    if (incomingTriggers.length || Object.keys(changedWorkflows).length) next.triggers ||= [];
    for (const t of next.triggers || []) if (own(changedWorkflows, t.workflowId) && t.enabled) {
      t.enabled = false; warnings.push("Disabled existing trigger " + t.id + " because its workflow was imported.");
    }
    for (const t of incomingTriggers) if (taking("workflows", "trigger:" + t.id)) {
      if (!own(changedWorkflows, t.workflowId) && !exists(workspace, "workflows/" + t.workflowId + ".json")) fail("trigger needs its workflow; include the Workflows category");
      const index = next.triggers.findIndex((x) => x.id === t.id);
      if (index < 0) next.triggers.push(t); else next.triggers[index] = t;
    }
    if (data.office.settings && Object.keys(data.office.settings.preferences).length && taking("settings", "preferences")) Object.assign(next, data.office.settings.preferences);
    for (const doc of data.docs) if (taking("settings", "markdown:" + doc.path)) stage(workspace, doc.path, doc.content);
    validateReferences(next, changedWorkflows, changedAgents);
    // Files granted to an agent are the same derived native skill projection as
    // normal daemon startup. They are included in the transaction, not a later
    // best-effort sync that might follow an attacker-controlled directory link.
    for (const [aid, a] of Object.entries(next.agents)) {
      if (a.isUser || aid === "ceo") continue;
      const effective = [...new Set([...DEFAULT_SKILLS, ...(a.skills || [])])];
      if (!changedAgents.has(aid) && !effective.some((s) => changedSkills.has(s))) continue;
      id(aid, "agent directory"); const prefix = "agents/" + aid + "/.claude/skills/", desired = {};
      for (const sid of effective) {
        const sk = next.skills[sid]; if (!sk) continue; id(sid, "skill directory");
        const body = frontmatter(sk, sid); desired[sid] = crypto.createHash("sha1").update(body).digest("hex").slice(0, 12);
        stage(workspace, prefix + sid + "/SKILL.md", body);
      }
      const syncFile = safeFile(workspace, prefix + ".synced.json");
      if (io.existsSync(syncFile)) {
        const old = parse(readBounded(syncFile), "native skill manifest"); object(old, "native skill manifest");
        for (const sid of Object.keys(old)) { id(sid, "previous skill directory"); if (!own(desired, sid) && exists(workspace, prefix + sid + "/SKILL.md")) stage(workspace, prefix + sid + "/SKILL.md", null); }
      }
      stage(workspace, prefix + ".synced.json", JSON.stringify(desired));
    }
    if (!Object.values(imported).some(Boolean)) return { ok: true, imported, skipped, warnings };
    stage(daemonDir, "registry.json", JSON.stringify(next, null, 2));
    const totalBytes = [...writes.values()].reduce((n, w) => n + (w.content?.length || 0), 0);
    if (totalBytes > zip.MAX_TOTAL_BYTES || writes.size > 10000) fail("expanded import is too large");
    // Full preflight occurs before making directories, staging, or changing data.
    for (const w of writes.values()) safeFile(w.root, w.relative);
    const stageName = ".office-transfer-" + crypto.randomBytes(12).toString("hex"), staging = path.join(daemonDir, stageName);
    safeFile(daemonDir, stageName + "/stage-check");
    const backups = new Map(), applied = [], madeDirs = []; let backupBytes = 0;
    function mkdirParents(dir) {
      const missing = []; let p = dir;
      while (!io.existsSync(p)) { missing.push(p); p = path.dirname(p); }
      for (const item of missing.reverse()) { io.mkdirSync(item); madeDirs.push(item); }
    }
    let complete = false;
    try {
      io.mkdirSync(staging);
      let n = 0;
      for (const w of writes.values()) {
        w.staged = path.join(staging, String(n++));
        const backup = io.existsSync(w.target) ? readBounded(w.target) : null;
        backupBytes += backup?.length || 0; if (backupBytes > zip.MAX_TOTAL_BYTES) fail("existing files exceed the rollback size limit");
        backups.set(w.target, backup);
        if (w.content !== null) io.writeFileSync(w.staged, w.content);
      }
      for (const w of writes.values()) {
        safeFile(w.root, w.relative); mkdirParents(path.dirname(w.target)); safeFile(w.root, w.relative);
        applied.push(w.target);
        if (w.content === null) io.unlinkSync(w.target); else io.renameSync(w.staged, w.target);
      }
      // Keep the captured registry object identity used by all daemon services.
      for (const key of Object.keys(reg)) if (!own(next, key)) delete reg[key];
      Object.assign(reg, next); complete = true;
    } catch (error) {
      const failures = [];
      for (const target of applied.reverse()) {
        try { const before = backups.get(target); if (before === null) { if (io.existsSync(target)) io.unlinkSync(target); } else io.writeFileSync(target, before); }
        catch (e) { failures.push(e.message); }
      }
      if (failures.length) fail("import failed and rollback needs attention: " + failures.join("; "));
      throw error;
    } finally {
      // The randomly generated staging directory is verified under daemonDir.
      try { if (path.dirname(staging) === daemonDir && io.existsSync(staging)) io.rmSync(staging, { recursive: true, force: true }); }
      catch { if (complete) warnings.push("Imported successfully; temporary staging files could not be removed: " + staging); }
      if (!complete) for (const dir of madeDirs.reverse()) { try { io.rmdirSync(dir); } catch {} }
    }
    plans.delete(plan);
    return { ok: true, imported, skipped, warnings };
  }
  return { summary, exportArchive, previewArchive, importArchive };
};

module.exports.FORMAT = FORMAT;
module.exports.VERSION = VERSION;
module.exports.CATEGORIES = CATEGORIES;
