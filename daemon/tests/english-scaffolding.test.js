// 🌐 Issue #67 — everything the daemon says ON ITS OWN is English: prompt
// scaffolding (memory note, workflow analysis, channel wrapper, meeting nudge,
// image transcription, thread summary), system notices pushed into the chat
// (chat.message text), log labels (logPrompt), HTTP/API error strings and the
// persona-draft tool menu. Agents reply in the office language (officeLangNote);
// the program's own voice is English, the global default.
//
// Thai is still allowed where it is DATA, never a prompt: the migration
// constants for old Thai files, regex character classes, the Thai voice preview,
// the th/en banter + mood tables, and the "(in Thai use ครับ/ผม)" voice hints.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const THAI = /[\u0E00-\u0E7F]/;
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8").split(/\r?\n/);

// A line's code part — the trailing `// comment` dropped (string-aware).
function codeOf(line) {
  let inq = null;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (inq) { if (c === "\\") j++; else if (c === inq) inq = null; }
    else if (c === '"' || c === "'" || c === "`") inq = c;
    else if (c === "/" && line[j + 1] === "/") return line.slice(0, j);
  }
  return line;
}

test("server.js: no Thai in system notices, log labels, prompts or error strings", () => {
  const lines = read("server.js");
  // Line shapes that reach the owner or the model verbatim.
  const SPEAKS = /logPrompt:|\btext: [`"']|throw new Error\(|\bfail\(|\bdone\((?:true|false|!)|res\.end\(|reject\(new Error\(|\bmsg: "|recall = `|const header = `|analysis:|keep\.push\(|onDone\("|logCall\(|title: \(social|const why = /;
  const bad = [];
  lines.forEach((l, i) => {
    const code = codeOf(l);
    if (!THAI.test(code) || !SPEAKS.test(code)) return;
    if (/in Thai/.test(code)) return;            // the voice/gender hint names Thai particles
    bad.push(`${i + 1}: ${l.trim().slice(0, 120)}`);
  });
  assert.deepStrictEqual(bad, [], "Thai in a line the daemon speaks:\n" + bad.join("\n"));
});

test("server.js: the prompt constants themselves are English", () => {
  const src = read("server.js").join("\n");
  const grab = (re) => { const m = src.match(re); assert.ok(m, re); return m[0]; };
  for (const re of [
    /const WORKFLOW_ANALYZE_PROMPT = \[[\s\S]*?\]\.join/,                 // Builder analysis
    /function memoryNote\([\s\S]*?<\/office-memory>/,                     // memory block in every prompt
    /function channelCommand\([\s\S]*?\n\}/,                              // slash replies on channels
    /async function summarizeThread\([\s\S]*?\n\}/,                       // auto-compact summary
    /Contents of the attached image/,                                     // image transcription wrapper
    /This message came in from \$\{channel\.toUpperCase\(\)\}/,           // channel wrapper
    /If real data would make your point stronger/,                        // meeting nudge
    /# Office Notes — the shared note board/,                             // notes.md header
    /# Memory of \$\{agent\}/,                                            // memory file header
    /push\("trigger", "When told to start"\)/,                            // Builder trigger node
  ]) assert.ok(!THAI.test(grab(re)), "Thai inside " + re);
});

test("server.js: canned banter + mood lines are keyed by office language", () => {
  const src = read("server.js").join("\n");
  assert.match(src, /const BANTER = \{\s*th: \[/);
  assert.match(src, /en: \[\s*\["\{a\}: The cat/);
  assert.match(src, /BANTER\[reg\.lang === "th" \? "th" : "en"\]/);
  assert.match(src, /MOOD_LINES\[reg\.lang === "th" \? "th" : "en"\]/);
});

test("constants.js: the persona-draft prompt lists tools in English", () => {
  const c = require("../constants");
  assert.ok(c.BUILTIN_TOOLS_EN, "BUILTIN_TOOLS_EN exported");
  assert.deepStrictEqual(Object.keys(c.BUILTIN_TOOLS_EN), Object.keys(c.BUILTIN_TOOLS), "same tool ids");
  for (const [id, d] of Object.entries(c.BUILTIN_TOOLS_EN)) assert.ok(!THAI.test(d), id + " description is English");
  const src = read("server.js").join("\n");
  assert.match(src, /const toolMenu = Object\.entries\(BUILTIN_TOOLS_EN\)/, "toolMenu built from the English table");
});

test("overlay.html: the feed/log chrome it writes itself goes through tr()", () => {
  // #feed / #log are NO_I18N subtrees (agent text is data), so any Thai literal the
  // overlay puts there must be wrapped in tr(...) to be translated from the seeds.
  const lines = read("overlay.html");
  const bad = [];
  lines.forEach((l, i) => {
    const code = codeOf(l);
    if (!/\b(addFeed|addLog|resolveFeedPerm)\(/.test(code) || !THAI.test(code)) return;
    const stripped = code.replace(/\btr\((?:[^()]|\([^()]*\))*\)/g, "");
    if (THAI.test(stripped)) bad.push(`${i + 1}: ${l.trim().slice(0, 120)}`);
  });
  assert.deepStrictEqual(bad, [], "Thai feed/log literal outside tr():\n" + bad.join("\n"));
});

test("i18n seeds: every tr() key used by the feed/log lines is pre-translated in all 14 languages", () => {
  const src = read("overlay.html").join("\n");
  const keys = new Set();
  // tr("...") and tr(cond ? "..." : "...") on feed/log lines only.
  for (const line of src.split("\n")) {
    if (!/\b(addFeed|addLog|resolveFeedPerm)\(/.test(line)) continue;
    for (const m of line.matchAll(/"([^"\\]*[\u0E00-\u0E7F][^"\\]*)"/g)) keys.add(m[1]);
  }
  assert.ok(keys.size >= 20, "found the feed keys (" + keys.size + ")");
  const dir = path.join(__dirname, "..", "i18n-seed");
  const langs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  assert.strictEqual(langs.length, 14, "14 seed files");
  for (const l of langs) {
    const seed = JSON.parse(fs.readFileSync(path.join(dir, l + ".json"), "utf8"));
    for (const k of keys) {
      assert.ok(k in seed, `${l}.json is missing "${k}"`);
      assert.ok(!THAI.test(seed[k]), `${l}.json still Thai for "${k}"`);
      // A %-placeholder in the key must survive translation, or the value is lost.
      for (const ph of k.match(/%[a-z]/g) || []) assert.ok(seed[k].includes(ph), `${l}.json dropped ${ph} in "${k}"`);
    }
  }
});
