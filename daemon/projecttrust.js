// Issue #39 — a project's own .claude/settings.json is EXECUTABLE configuration.
// It can name a command hook (SessionStart, PreCompact, …) that runs the moment a
// session opens in that folder — before the model says a word, so the office's
// PreToolUse permission broker never sees it and the Security Center stays silent.
//
// The office pre-trusts every project directory (headless claude can't show the
// "do you trust this folder?" dialog, so it would stall forever on it). That is
// necessary, but it must not turn "I registered a folder" into "yes, run whatever
// code this repo ships". This module reads WHAT would actually run and fingerprints
// it, so the office can ask the owner once — and ask again the moment it changes.
//
// Scope is deliberately narrow: **command hooks only**. A project settings file
// that merely carries `permissions` rules is not gated — those are still funnelled
// through our own PreToolUse broker, and prompting on them would fire for a large
// share of ordinary repos, training the owner to click through the one card that
// matters. `.mcp.json` is not gated either: Claude Code approves project MCP
// servers separately (enabledMcpjsonServers), which the trust flag does not grant.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Both are project-supplied: settings.local.json is gitignored, but it still
// arrives inside a tarball/zip, so it is exactly as untrusted as its sibling.
const SETTINGS_FILES = ["settings.json", "settings.local.json"];
const MAX_SCRIPTS = 20;            // referenced files fingerprinted per project
const MAX_SCRIPT_BYTES = 1 << 20;  // 1 MB of any one of them

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Every command a hook block in this project would run, flattened.
// Shape: { "hooks": { "SessionStart": [ { matcher, hooks: [{type,command}] } ] } }
function readHooks(dir) {
  const out = [];
  for (const name of SETTINGS_FILES) {
    const file = path.join(dir, ".claude", name);
    if (!fs.existsSync(file)) continue;
    const j = readJson(file);
    const hooks = j && j.hooks;
    if (!hooks || typeof hooks !== "object") continue;
    for (const event of Object.keys(hooks)) {
      const blocks = Array.isArray(hooks[event]) ? hooks[event] : [hooks[event]];
      for (const block of blocks) {
        if (!block) continue;
        const list = Array.isArray(block.hooks) ? block.hooks : [block];
        for (const h of list) {
          if (!h || typeof h.command !== "string" || !h.command.trim()) continue;
          out.push({ file: ".claude/" + name, event: String(event),
            command: h.command.trim().slice(0, 2000) });
        }
      }
    }
  }
  return out;
}

// A command is a shell string ("node marker-hook.js", "$CLAUDE_PROJECT_DIR/.claude/x.sh").
// Pull out the tokens that name a real file, so EDITING the script — without touching
// settings.json — still invalidates the owner's approval.
function referencedScripts(dir, commands) {
  const seen = new Map();
  let root;
  try { root = fs.realpathSync(dir); } catch { root = path.resolve(dir); }
  for (const cmd of commands) {
    for (let tok of String(cmd).split(/[\s;|&<>()]+/)) {
      if (seen.size >= MAX_SCRIPTS) break;
      tok = tok.replace(/^["']|["']$/g, "")
        .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?[\\/]?/, "")
        .replace(/^\.[\\/]/, "");
      if (!tok || tok.length > 400 || !/[\\/.]/.test(tok)) continue;
      const abs = path.isAbsolute(tok) ? tok : path.join(dir, tok);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile() || st.size > MAX_SCRIPT_BYTES) continue;
      // A symlink may point outside the project; hash what it ACTUALLY resolves to
      // and say so, rather than trusting the name inside the folder.
      let real = abs;
      try { real = fs.realpathSync(abs); } catch {}
      const inside = (real + path.sep).toLowerCase()
        .startsWith((root + path.sep).toLowerCase());
      let body = "";
      try { body = fs.readFileSync(real, "utf8"); } catch { continue; }
      const rel = path.relative(dir, abs).replace(/\\/g, "/") || path.basename(abs);
      if (!seen.has(rel)) seen.set(rel, { rel, outside: !inside, hash: sha(body) });
    }
  }
  return [...seen.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

// The whole answer for one directory:
//   hooks   — what would run, for the card the owner reads
//   scripts — the referenced files that were fingerprinted too
//   hash    — "" when the project ships NO hooks (nothing to approve, trust it
//             silently as before); otherwise the identity of this exact setup.
function fingerprint(dir) {
  let hooks = [];
  try { hooks = readHooks(dir); } catch { hooks = []; }
  if (!hooks.length) return { hooks: [], scripts: [], hash: "" };
  let scripts = [];
  try { scripts = referencedScripts(dir, hooks.map((h) => h.command)); } catch {}
  const canon = [
    ...hooks.map((h) => `hook|${h.file}|${h.event}|${h.command}`).sort(),
    ...scripts.map((s) => `file|${s.rel}|${s.outside ? "outside" : "inside"}|${s.hash}`),
  ].join("\n");
  return { hooks, scripts, hash: sha(canon) };
}

module.exports = { fingerprint, readHooks, referencedScripts, SETTINGS_FILES };
