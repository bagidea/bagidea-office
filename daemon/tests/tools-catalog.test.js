// Unit tests for the tool catalog (web/tools.json) and the MCP launch spec.
// Pure (no daemon required): the catalog is a plain data file and mcpEntry is a
// pure function. The /tools/catalog endpoint is integration-tested in
// api.test.js against a running daemon.
//
// Why a test at all: this catalog sits behind one-click Add buttons, and it had
// silently rotted — seven entries pointed at npm packages that are deprecated
// and one at a package that never existed. A shape test cannot know what npm
// deprecated overnight, but it can stop a hand-edit from shipping an entry with
// no description, a duplicate id, or a command nobody can run.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CATALOG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "web", "tools.json"), "utf8"));
const TOOLS = CATALOG.tools;
const MCP = TOOLS.filter((t) => t.kind === "mcp");

// ── mcpEntry ───────────────────────────────────────────────────────────
// Mirrors the helper in daemon/server.js that turns a one-line spec into the
// object written to an --mcp-config. A hosted server arrives as a URL, a local
// one as a program plus arguments; the URL is what tells them apart.
function mcpEntry(spec) {
  const s = String((spec && spec.command) || "").trim();
  if (/^https?:[/][/]/i.test(s)) return { type: "http", url: s.split(/\s+/)[0] };
  const parts = s.split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

test("mcpEntry: a plain program becomes command + args", () => {
  assert.deepStrictEqual(
    mcpEntry({ command: "npx -y @playwright/mcp@latest --headed" }),
    { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headed"] });
});

test("mcpEntry: a program with no arguments gets an empty args list", () => {
  assert.deepStrictEqual(mcpEntry({ command: "uvx blender-mcp" }),
    { command: "uvx", args: ["blender-mcp"] });
});

test("mcpEntry: an https URL becomes a hosted http server", () => {
  assert.deepStrictEqual(mcpEntry({ command: "https://mcp.linear.app/mcp" }),
    { type: "http", url: "https://mcp.linear.app/mcp" });
});

test("mcpEntry: http:// counts too, and the scheme is case-insensitive", () => {
  assert.deepStrictEqual(mcpEntry({ command: "HTTP://localhost:9000/mcp" }),
    { type: "http", url: "HTTP://localhost:9000/mcp" });
});

test("mcpEntry: a URL with trailing text keeps only the URL", () => {
  // Someone pastes the URL with a stray note after it; a two-word "url" would
  // be a connection error with no clue why.
  assert.deepStrictEqual(mcpEntry({ command: "https://mcp.notion.com/mcp  (sign in)" }),
    { type: "http", url: "https://mcp.notion.com/mcp" });
});

test("mcpEntry: a command that merely MENTIONS a url is still a program", () => {
  // The Postgres entry carries a postgresql:// connection string as an argument.
  const e = mcpEntry({ command: "npx -y @henkey/postgres-mcp-server --connection-string postgresql://u:p@h/db" });
  assert.strictEqual(e.command, "npx");
  assert.ok(!e.type, "must not be treated as a hosted server");
});

test("mcpEntry: an empty or missing spec does not throw", () => {
  assert.deepStrictEqual(mcpEntry(undefined), { command: "", args: [] });
  assert.deepStrictEqual(mcpEntry({}), { command: "", args: [] });
});

// ── the catalog file ───────────────────────────────────────────────────
test("catalog: parses and has both kinds of tool", () => {
  assert.ok(Array.isArray(TOOLS) && TOOLS.length > 0);
  assert.ok(TOOLS.some((t) => t.kind === "builtin"), "no builtin tools listed");
  assert.ok(MCP.length > 0, "no MCP servers listed");
});

test("catalog: every id is unique", () => {
  // The hub keys installed-state by id; a duplicate would light up two cards.
  const ids = TOOLS.map((t) => t.id);
  assert.deepStrictEqual(ids.length, new Set(ids).size,
    "duplicate id in web/tools.json");
});

test("catalog: every entry is renderable in both source languages", () => {
  for (const t of TOOLS) {
    assert.ok(t.id, "entry with no id");
    assert.ok(t.name, `${t.id}: no name`);
    assert.ok(t.icon, `${t.id}: no icon`);
    assert.ok(["builtin", "mcp"].includes(t.kind), `${t.id}: bad kind ${t.kind}`);
    for (const lang of ["en", "th"]) {
      assert.ok(t[lang] && t[lang].desc, `${t.id}: no ${lang} description`);
    }
  }
});

test("catalog: every MCP entry carries a risk label in both languages", () => {
  // The hub prints this on a pill. It is the one line telling the owner what
  // they are letting run on their machine, so it may not be missing.
  for (const t of MCP) {
    for (const lang of ["en", "th"]) {
      assert.ok(t[lang] && t[lang].risk, `${t.id}: no ${lang} risk label`);
    }
  }
});

test("catalog: every MCP command is launchable or a hosted URL", () => {
  for (const t of MCP) {
    if (!t.cmd) continue;                       // the catch-all card has none
    const e = mcpEntry({ command: t.cmd });
    if (e.type === "http") {
      assert.doesNotThrow(() => new URL(e.url), `${t.id}: unparseable URL`);
    } else {
      assert.ok(e.command.length > 0, `${t.id}: empty command`);
      assert.ok(!/\s/.test(e.command), `${t.id}: command has whitespace`);
    }
  }
});

test("catalog: a command with a placeholder says so in 'needs'", () => {
  // The hub refuses to add a command still containing <...>. If the card does
  // not also SAY to edit it, that refusal looks like a broken button.
  for (const t of MCP) {
    if (t.cmd && t.cmd.includes("<")) {
      assert.ok(t.en.needs, `${t.id}: has a <placeholder> but no 'needs' note`);
    }
  }
});

test("catalog: a setup note exists in both languages or neither", () => {
  // 'needs' lives beside desc and risk precisely so a Thai office does not get
  // an English instruction; a half-filled pair is how that regresses.
  for (const t of MCP) {
    assert.strictEqual(!!(t.en && t.en.needs), !!(t.th && t.th.needs),
      `${t.id}: 'needs' present in only one language`);
    assert.ok(!("needs" in t), `${t.id}: 'needs' left at top level, so it will not translate`);
  }
});

test("catalog: no entry points at a package the ecosystem retired", () => {
  // These were live in this catalog and are now deprecated on npm or gone
  // entirely — each one was a one-click button that could only fail.
  const retired = [
    "@modelcontextprotocol/server-github",
    "@modelcontextprotocol/server-brave-search",
    "@modelcontextprotocol/server-postgres",
    "@modelcontextprotocol/server-slack",
    "@modelcontextprotocol/server-puppeteer",
    "@modelcontextprotocol/server-gdrive",
    "@modelcontextprotocol/server-google-maps",
    "@google-workspace/mcp-server",          // never existed at all
  ];
  for (const t of MCP) {
    for (const dead of retired) {
      assert.ok(!(t.cmd || "").includes(dead),
        `${t.id}: points at retired package ${dead}`);
    }
  }
});

test("catalog: the game and 3D tools are present", () => {
  // The reason this catalog got overhauled — an office that builds games needs
  // to be able to reach the engines.
  for (const id of ["blender", "godot", "unity", "unreal", "roblox"]) {
    const t = MCP.find((x) => x.id === id);
    assert.ok(t, `missing ${id} entry`);
    assert.strictEqual(t.group, "create", `${id} should sit in the create group`);
    assert.ok(t.cmd, `${id}: no launch command`);
  }
});

// ── every language, every string ────────────────────────────────────────
// This product ships globally and English is its default language, so a tool
// card must not fall back to English on 12 of the 14 supported languages just
// because someone added an entry and forgot the translations.
//
// Thai is authored inline in the catalog; the other twelve overlay the English
// source from assets/tools-i18n/<lang>.json, keyed by that source string. This
// test is the thing that makes "we support 14 languages" checkable rather than
// aspirational.
const I18N_DIR = path.join(__dirname, "..", "..", "web", "assets", "tools-i18n");
// The site's own list, minus the two that live in the catalog itself.
const OVERLAY_LANGS = ["zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr", "ko", "id", "vi"];

function sourceStrings() {
  const out = new Set();
  for (const t of TOOLS) {
    for (const k of ["desc", "risk", "needs"]) if (t.en && t.en[k]) out.add(t.en[k]);
  }
  return out;
}

test("i18n: every supported language has an overlay file", () => {
  for (const l of OVERLAY_LANGS) {
    assert.ok(fs.existsSync(path.join(I18N_DIR, l + ".json")),
      `no tool translations for "${l}" — that language would read English`);
  }
});

test("i18n: every English string is translated in every language", () => {
  const src = sourceStrings();
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const missing = [...src].filter((s) => !(s in map));
    assert.deepStrictEqual(missing, [],
      `${l}.json is missing ${missing.length} string(s), starting with: ` +
      (missing[0] || "").slice(0, 60));
  }
});

test("i18n: no translation is just the English left in place", () => {
  // A copied-through string is the failure that looks like success — the file
  // has the key, the card renders, and the reader still gets English.
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const copied = Object.keys(map).filter((k) => map[k] === k);
    assert.deepStrictEqual(copied, [],
      `${l}.json leaves ${copied.length} string(s) in English`);
  }
});

test("i18n: no overlay carries a string the catalog no longer has", () => {
  // Stale keys are how a file drifts: it looks complete while translating text
  // nobody shows any more.
  const src = sourceStrings();
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const stale = Object.keys(map).filter((k) => !src.has(k));
    assert.deepStrictEqual(stale, [],
      `${l}.json has ${stale.length} stale key(s), starting with: ` +
      (stale[0] || "").slice(0, 60));
  }
});

test("i18n: every entry is authored in Thai in the catalog itself", () => {
  // Thai does not use an overlay file — it is written next to the English.
  for (const t of TOOLS) {
    assert.ok(t.th && t.th.desc, `${t.id}: no Thai description`);
  }
});
