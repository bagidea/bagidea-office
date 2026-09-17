// Five bugs reported from a real office running v1.0.4 (issues #46-#50).
//
// Each one is guarded here by the property that was actually violated, not by
// the shape of the fix — so a rewrite is free and a regression is not.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const OVERLAY = fs.readFileSync(path.join(ROOT, "daemon", "overlay.html"), "utf8");
const THAI = /[฀-๿]/;

// ── #50: job ids collided inside one millisecond ────────────────────────────
test("#50 job ids survive a burst of creations in the same millisecond", () => {
  // "j" + Date.now() is unique only if nothing ever creates two jobs in one
  // millisecond. A plugin queueing a meeting's action items created seven in a
  // loop, two pairs collided, and each "create then disable" disabled the first
  // twin — leaving the other ENABLED. Two of those fired work that was meant to
  // wait for a human.
  assert.doesNotMatch(SERVER, /id:\s*"j"\s*\+\s*Date\.now\(\)/,
    "job ids are time-only again; two in one millisecond will collide");
  assert.match(SERVER, /function nextJobId\(\)/, "the collision-proof generator is gone");

  // Run the real generator against the reporter's exact burst.
  const src = SERVER.slice(SERVER.indexOf("let jobSeqMs"), SERVER.indexOf("function nextJobId") +
    SERVER.slice(SERVER.indexOf("function nextJobId")).indexOf("\n}") + 2);
  const sandbox = { Date: { now: () => 1789075784266 }, jobs: [{ id: "j1789075784266" }] };
  require("vm").runInNewContext(src + "\nout = [];for (let i=0;i<7;i++){const id=nextJobId();jobs.push({id});out.push(id);}", sandbox);
  const ids = sandbox.out;
  assert.strictEqual(new Set(ids).size, 7, "seven jobs in one millisecond produced a duplicate: " + ids);
  assert.ok(!ids.includes("j1789075784266"),
    "reissued an id that jobs.json already holds — a restart would collide with disk");
});

// ── #48: enabled:false discarded, and "now" fired before you could stop it ──
test("#48 a job created with enabled:false lands disabled and does not fire", () => {
  // v1.4 moved the job's birth into createJob() (shared with plugins' ctx.schedule).
  const handler = SERVER.slice(SERVER.indexOf("function createJob("),
                               SERVER.indexOf("function jobDue("));
  assert.doesNotMatch(handler, /^\s*enabled: true,\s*$/m,
    "`enabled` is hardcoded again — a caller's enabled:false is discarded");
  assert.match(handler, /enabled:\s*p\.enabled === false \? false : true/,
    "the caller's enabled flag is not honoured");
  // dispatchJob() never consults .enabled, and the scheduler's jobDue() never
  // looks at mode:"now" — so this call site is the only gate that exists.
  assert.match(handler, /if \(job\.mode === "now" && job\.enabled\) dispatchJob\(job\)/,
    'a mode:"now" job still dispatches synchronously regardless of enabled');
});

// ── #46: compaction never fired; one thread reached 9.5M/1M tokens ──────────
test("#46 the compaction check uses the real token count, not a byte guess", () => {
  const fn = SERVER.slice(SERVER.indexOf("function overBudget("),
                          SERVER.indexOf("function overBudget(") + 1400);
  assert.match(fn, /entry\.lastUsage && entry\.lastUsage\.in/,
    "overBudget ignores lastUsage.in — the real number the API reports every turn");
  // The byte-size estimate may remain, but only as the fallback for a thread
  // that has not completed a turn yet. It must not be the primary gate: it
  // under-counts tool-heavy transcripts and goes blind if `sid` ever moves.
  const real = fn.indexOf("lastUsage");
  const guess = fn.indexOf("statSync");
  assert.ok(real > -1 && (guess === -1 || real < guess),
    "the byte-size estimate is still consulted before the real usage figure");
});

// ── #47: raw agent ids in two UI surfaces ───────────────────────────────────
test("#47 chat bubbles and Mission Control resolve the display name", () => {
  assert.match(OVERLAY, /createTextNode\(nameOf\(who\)\.toUpperCase\(\)\)/,
    "the chat sender label shows the raw agent id again");
  const missions = OVERLAY.slice(OVERLAY.indexOf("function renderMissions()"),
                                 OVERLAY.indexOf("function renderMissions()") + 900);
  assert.match(missions, /nameOf\(m\.agent\)/, "Mission Control shows the raw agent id again");
  // nameOf() returns a field the owner types. It must never reach innerHTML.
  assert.doesNotMatch(missions, /innerHTML\s*=\s*`[^`]*\$\{(nameOf\(m\.agent\)|m\.agent|m\.tool)\}/,
    "a user-typed agent name is being interpolated into innerHTML unescaped");
});

// ── #49: the daemon instructed agents in Thai, then asked for English ───────
// The office ships in 14 languages and English is its canonical one. Scaffolding
// the model reads must not be written in one specific language — an English
// office was being instructed in Thai and drifted into replying in Thai.
//
// The rule is per LINE and about majority, not about any Thai character at all:
// "in Thai use ครับ/ผม" inside an English instruction is content, and a
// Thai-speaking office needs it. A whole Thai sentence is scaffolding.
function majorityThai(line) {
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length < 12) return false;
  const thai = (line.match(/[฀-๿]/g) || []).length;
  return thai / letters.length > 0.4;
}

test("#49 no prompt block instructs the model in Thai", () => {
  const BLOCKS = [
    ["personaText", "function personaText(", "function pushRoster"],
    ["SUB_NOTE", "const SUB_NOTE", "// Where an agent's run actually happens"],
    ["VOICE_NOTE", "const VOICE_NOTE = canSpeak", "const MEDIA_NOTE"],
    ["MEDIA_NOTE", "const MEDIA_NOTE", "const mediaNote ="],
    ["TOOLS_NOTE", "const TOOLS_NOTE", "const BRAIN_NOTE"],
    ["autoNote", "function autoNote()", "\n}"],
    ["Gemini Live", "systemInstruction: { parts:", "toClient({ type: \"ready\" })"],
    // v1.4: the rest of the Director's and every agent's scaffolding — found
    // while wiring Codex, one sweep after the last one.
    ["directorNote", "function directorNote()", "function ceoFlow("],
    ["DELEGATE_NOTE", "const DELEGATE_NOTE", "// ---------------------------------------------------------------- 🤖 AUTO mode"],
    ["projectNote", "function projectNote()", "function projectStatus()"],
    ["heartbeat", "function heartbeat()", "// ▶ Resume tick"],
    ["resume", "function resumePausedTick(", "\n}"],
    ["proposal approved", "function decideProposal(", "} else if (decision === \"reject\" && note) {"],
    ["SOCIAL_PROPOSAL_INSTRUCTION", "const SOCIAL_PROPOSAL_INSTRUCTION", "const MEETING_TEMPLATES"],
    ["calendar reminder", "const calendar = require(\"./calendar\")", "\n});"],
  ];
  const bad = [];
  // The standing-order notes live in their own module and were missed by the
  // v1.0.5 sweep — the same bug, one file over.
  for (const mod of ["joborder.js", "tasks.js", "codex.js", "workflows.js"]) {
    const SRC = fs.readFileSync(path.join(ROOT, "daemon", mod), "utf8");
    for (const line of SRC.split(/\r?\n/)) {
      if (/^\s*\/\//.test(line)) continue;
      if (majorityThai(line)) bad.push(mod + ": " + line.trim().slice(0, 70));
    }
  }
  for (const [name, from, to] of BLOCKS) {
    const i = SERVER.indexOf(from);
    assert.ok(i > -1, `${name}: block not found — the guard is pointing at nothing`);
    const j = SERVER.indexOf(to, i + from.length);
    const body = SERVER.slice(i, j > -1 ? j : i + 2500);
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*\/\//.test(line)) continue;            // comments may explain in any language
      // Display-only strings are not model input: `logPrompt:` is the label the
      // owner sees in the thread, `text:` on a chat.message is a line in the chat.
      if (/\blogPrompt\s*:/.test(line) || /^\s*text\s*:\s*["'`]/.test(line)) continue;
      if (majorityThai(line)) bad.push(`${name}: ${line.trim().slice(0, 70)}`);
    }
  }
  assert.deepStrictEqual(bad, [],
    "these lines instruct the model in Thai:\n  " + bad.join("\n  "));
});

test("#49 the office language is stated explicitly, in English", () => {
  // Removing the Thai stops the office contradicting itself; it does not by
  // itself say what language to use. The office knows — so it should say.
  assert.match(SERVER, /function officeLangNote\(/, "no office-language instruction");
  assert.match(SERVER, /preamble \+= officeLangNote\(a\);/, "it is never added to the preamble");
  assert.match(SERVER, /const LANG_NAMES = \{/, "no code -> language-name map");
  for (const code of ["en", "th", "zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr", "ko", "id", "vi"]) {
    assert.match(SERVER, new RegExp('\\b' + code + ':\\s*"'), `LANG_NAMES is missing "${code}"`);
  }
  // A persona that names its own language must still win — the owner meant it.
  const fn = SERVER.slice(SERVER.indexOf("function officeLangNote("),
                          SERVER.indexOf("function officeLangNote(") + 600);
  assert.match(fn, /persona && a\.persona\.language.*return ""/s,
    "the office default would override an agent's explicit language");
});

test("#49 the Thai OFFICE.md migration string is NOT translated", () => {
  // It looks like the same bug and is not: it is compared against an untouched
  // old Thai OFFICE.md to detect and replace it. Translating it silently breaks
  // that migration — the reporter flagged this, and they were right.
  const i = SERVER.indexOf("const OFFICE_MD_OLD_TH");
  assert.ok(i > -1, "OFFICE_MD_OLD_TH is gone — the OFFICE.md migration cannot work");
  assert.ok(THAI.test(SERVER.slice(i, i + 400)),
    "OFFICE_MD_OLD_TH was translated; it can no longer match the file it exists to detect");
});
