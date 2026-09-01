// The Plugins Hub catalog, guarded the way the tool catalog is.
//
// `web/plugins.json` is the source of truth for the Hub — in the office and on
// the website. It carries English and Thai; the other twelve languages overlay
// the English source from `web/assets/plugins-i18n/<lang>.json`, keyed by that
// source string, exactly as the tool catalog does.
//
// Until v1.0.2 this catalog had no overlays at all, so a reader in Korean got a
// fully translated page wrapped around English plugin cards. These tests are
// what stop that coming back the next time somebody adds a plugin.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "web");
const CATALOG = JSON.parse(fs.readFileSync(path.join(WEB, "plugins.json"), "utf8"));
const PLUGINS = CATALOG.plugins || [];
const I18N_DIR = path.join(WEB, "assets", "plugins-i18n");
// The site's fourteen, minus the two authored in the catalog itself.
const OVERLAY_LANGS = ["zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr", "ko", "id", "vi"];

const sourceStrings = () =>
  new Set(PLUGINS.map((p) => p.en && p.en.desc).filter(Boolean));

test("the catalog is a list of installable plugins", () => {
  assert.ok(PLUGINS.length > 0, "plugins.json has no entries");
  for (const p of PLUGINS) {
    assert.ok(p.id, "an entry has no id");
    assert.ok(p.name, `${p.id}: no name`);
    assert.ok(/^https:\/\/github\.com\//.test(p.repo || ""),
      `${p.id}: repo must be a GitHub URL — installing clones it onto a real machine`);
  }
});

test("every entry is described in English — the canonical language", () => {
  for (const p of PLUGINS) {
    assert.ok(p.en && p.en.desc, `${p.id}: no English description`);
  }
});

test("every entry is described in Thai, in the catalog itself", () => {
  // Thai does not use an overlay file — it is written next to the English.
  for (const p of PLUGINS) {
    assert.ok(p.th && p.th.desc, `${p.id}: no Thai description`);
  }
});

test("i18n: every supported language has an overlay file", () => {
  for (const l of OVERLAY_LANGS) {
    assert.ok(fs.existsSync(path.join(I18N_DIR, l + ".json")),
      `no plugin translations for "${l}" — that language would read English`);
  }
});

test("i18n: every English description is translated in every language", () => {
  const src = sourceStrings();
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const missing = [...src].filter((s) => !(s in map));
    assert.deepStrictEqual(missing, [],
      `${l}.json is missing ${missing.length} description(s), starting with: ` +
      (missing[0] || "").slice(0, 60));
  }
});

test("i18n: no translation is just the English left in place", () => {
  // The failure that looks like success: the key is there, the card renders,
  // and the reader still gets English.
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const copied = Object.keys(map).filter((k) => map[k] === k);
    assert.deepStrictEqual(copied, [],
      `${l}.json leaves ${copied.length} description(s) in English`);
  }
});

test("i18n: no overlay carries a string the catalog no longer has", () => {
  const src = sourceStrings();
  for (const l of OVERLAY_LANGS) {
    const map = JSON.parse(fs.readFileSync(path.join(I18N_DIR, l + ".json"), "utf8"));
    const stale = Object.keys(map).filter((k) => !src.has(k));
    assert.deepStrictEqual(stale, [],
      `${l}.json has ${stale.length} stale key(s), starting with: ` +
      (stale[0] || "").slice(0, 60));
  }
});

test("the Hub page actually loads the overlays", () => {
  // A catalog translated into twelve languages that no page fetches is twelve
  // files of dead weight, and the bug it was meant to fix is still shipping.
  const html = fs.readFileSync(path.join(WEB, "plugins.html"), "utf8");
  assert.ok(html.includes("assets/plugins-i18n/"),
    "plugins.html never fetches the per-language overlay files");
  assert.ok(!html.includes('document.documentElement.lang === "th" ? "th" : "en"'),
    "plugins.html still collapses every language to en/th before rendering");
});
