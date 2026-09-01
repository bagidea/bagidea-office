// The website's own i18n, guarded the same way the tool catalog is.
//
// This product ships worldwide and English is its canonical, default language.
// The failure this file exists to catch is not a crash — it is a page that
// renders perfectly while a reader in Japanese or Arabic gets English cards
// inside a translated layout. That looks like success from every angle except
// the reader's.
//
// English lives inline in web/assets/i18n.js (I18N.en) and is the source of
// truth. German and Thai are inline beside it; the other eleven languages are
// per-language JSON files fetched on demand, and a missing key there silently
// falls back to English — which is exactly why "it renders" proves nothing.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "..", "web");
const I18N_JS = path.join(WEB, "assets", "i18n.js");
const I18N_DIR = path.join(WEB, "assets", "i18n");
const PAGES = ["index.html", "docs.html", "tools.html", "plugins.html", "showcase.html"];

// The tail of i18n.js is browser code (localStorage, document); only the two
// literals at the top are data, so pull those out rather than running the file.
function load() {
  const src = fs.readFileSync(I18N_JS, "utf8");
  const langsStart = src.indexOf("const LANGS = [");
  const langsEnd = src.indexOf("\n];", langsStart) + 3;
  const i18nStart = src.indexOf("const I18N = {");
  const i18nEnd = src.indexOf("\n};", i18nStart) + 3;
  assert.ok(langsStart >= 0 && i18nStart >= 0, "i18n.js no longer declares LANGS / I18N");
  const ctx = {};
  vm.runInNewContext(
    src.slice(langsStart, langsEnd) + "\n" + src.slice(i18nStart, i18nEnd) +
    "\nout = { LANGS, I18N };", ctx);
  return ctx.out;
}

const { LANGS, I18N } = load();
const EN = I18N.en;
const CODES = LANGS.map((l) => l[0]);
const OVERLAY = CODES.filter((c) => !(c in I18N));

function table(code) {
  if (I18N[code]) return I18N[code];
  return JSON.parse(fs.readFileSync(path.join(I18N_DIR, code + ".json"), "utf8"));
}

test("the site advertises 14 languages and English is the source", () => {
  assert.strictEqual(CODES.length, 14, "LANGS no longer lists 14 languages");
  assert.strictEqual(CODES[0], "en", "English must lead the list — it is the default");
  assert.ok(Object.keys(EN).length > 300, "I18N.en looks truncated");
});

test("i18n: every advertised language has a table", () => {
  for (const code of CODES) {
    const inline = !!I18N[code];
    const file = fs.existsSync(path.join(I18N_DIR, code + ".json"));
    assert.ok(inline || file,
      `"${code}" is offered in the picker with no translations at all — ` +
      `that language would read English end to end`);
  }
});

test("i18n: every English key is translated in every language", () => {
  const keys = Object.keys(EN);
  for (const code of CODES) {
    if (code === "en") continue;
    const t = table(code);
    const missing = keys.filter((k) => !(k in t));
    assert.deepStrictEqual(missing, [],
      `"${code}" is missing ${missing.length} key(s) — they would fall back to ` +
      `English. Starting with: ${missing.slice(0, 4).join(", ")}`);
  }
});

test("i18n: no language carries a key English has dropped", () => {
  // Stale keys are how a file drifts: it looks complete while carrying text
  // nobody renders any more.
  for (const code of CODES) {
    if (code === "en") continue;
    const stale = Object.keys(table(code)).filter((k) => !(k in EN));
    assert.deepStrictEqual(stale, [],
      `"${code}" has ${stale.length} stale key(s): ${stale.slice(0, 4).join(", ")}`);
  }
});

test("i18n: no paragraph is just the English left in place", () => {
  // Short values legitimately match across languages — "GitHub", "Media Studio",
  // a shell command, a version badge. A long one never does: that is a
  // paragraph somebody pasted through, and it is the failure that looks like
  // success, because the key is present and the page renders.
  const NAME_LIKE = 60;
  for (const code of CODES) {
    if (code === "en") continue;
    const t = table(code);
    const copied = Object.keys(EN)
      .filter((k) => typeof EN[k] === "string" && EN[k].length > NAME_LIKE && t[k] === EN[k]);
    assert.deepStrictEqual(copied, [],
      `"${code}" leaves ${copied.length} long string(s) in English: ` +
      copied.slice(0, 4).join(", "));
  }
});

test("i18n: every data-i18n key on every page exists in English", () => {
  // A typo'd key renders the hard-coded English in the markup forever, in all
  // 14 languages, and nothing anywhere reports it.
  const unknown = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(WEB, page), "utf8");
    for (const m of html.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) {
      if (!(m[1] in EN)) unknown.push(page + " → " + m[1]);
    }
  }
  assert.deepStrictEqual(unknown, [],
    `${unknown.length} data-i18n key(s) have no English source: ` +
    unknown.slice(0, 5).join(", "));
});

test("i18n: the v1.0 capabilities are documented on the site, in every language", () => {
  // The five things v1.0.0 added are the reason someone reads the page at all.
  // Guarded by key rather than by prose so a rewrite is free and a deletion is not.
  const KEYS = [
    "f_runloc_t", "f_runloc_d",     // 📦 RUN LOCATION
    "f_recall_t", "f_recall_d",     // 🔎 SEMANTIC RECALL
    "f_media_t", "f_media_d",       // 🎨 Media Studio
    "f_selfskill_t", "f_selfskill_d",
    "d_where_h", "d_where_p",
    "d_ghostiso_h", "d_ghostiso_p",
    "d_recall_h", "d_recall_p",
    "d_selfskill_h", "d_selfskill_p",
    "d_tools_h", "d_tools_p",
    "d_media_h", "d_media_p",
  ];
  for (const code of CODES) {
    const t = table(code);
    const gone = KEYS.filter((k) => !t[k]);
    assert.deepStrictEqual(gone, [], `"${code}" lost: ${gone.join(", ")}`);
  }
});

test("the English settings names the docs cite are the ones the app shows", () => {
  // The chat window is Thai-source and machine-translated at runtime, so the
  // ALL-CAPS English term is the part that survives unchanged — it is the name
  // an English office actually shows, and the only name a doc can cite. If the
  // overlay renames one, the docs and the website start pointing at nothing.
  const overlay = fs.readFileSync(path.join(__dirname, "..", "overlay.html"), "utf8");
  for (const term of ["RUN LOCATION", "GHOST ISOLATION", "SEMANTIC RECALL",
                      "MCP SERVERS", "SYSTEM TOOLS", "API KEYS"]) {
    assert.ok(overlay.includes(term),
      `the overlay no longer has "${term}" — the docs cite that name`);
  }
  for (const term of ["RUN LOCATION", "GHOST ISOLATION", "SEMANTIC RECALL"]) {
    assert.ok(EN.d_where_p.includes(term) || EN.d_ghostiso_p.includes(term) ||
              EN.d_recall_p.includes(term),
      `no site copy cites "${term}"`);
  }
});
