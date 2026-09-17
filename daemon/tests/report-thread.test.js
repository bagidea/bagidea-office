// PR #41 (part 2) — a delegated result comes back to the thread the order was
// given on. makeDelegateFilter used to capture `session` by value; on a fresh
// thread that is undefined, and the report-back 4.5 s later resolved it as
// "the latest thread" — which a job, a heartbeat or a social turn may have moved.
// The filter now takes a getter and resolves the thread at dispatch time.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").split("\r").join("");
const block = (from, to) => { const i = SERVER.indexOf(from); assert.ok(i > -1, "not found: " + from.slice(0, 40)); const j = SERVER.indexOf(to, i + from.length); return SERVER.slice(i, j > -1 ? j : i + 6000); };

test("the delegate filter resolves the thread at dispatch time, never from a value frozen at build time", () => {
  const filter = block("function makeDelegateFilter(depth, session, onHit) {", "// Optional QA gate");
  assert.match(filter, /const sessionNow = \(\) => \(typeof session === "function"/, "a getter is accepted");
  assert.ok(!/, depth, session\)/.test(filter), "no hand-off inside the filter passes the frozen value");
  for (const s of ['reportToMain("codex", text, !!r.ok, depth, sessionNow())', "verifyThenReport(t, inst, out, ok, depth, sessionNow(), proj)", "false, depth, sessionNow());"])
    assert.ok(filter.includes(s), "filter should contain: " + s);
});

test("every owner-facing builder hands the filter a getter over keyRef", () => {
  assert.match(block("function ceoFlow(", "// ---------------------------------------------------------------- report-back"), /makeDelegateFilter\(0, \(\) => keyRef\.key,/, "ceoFlow");
  assert.match(block("function reportToMain(", "// Optional QA gate"), /makeDelegateFilter\(depth \+ 1, \(\) => keyRef\.key,/, "reportToMain");
  assert.match(SERVER, /const df = makeDelegateFilter\(0, \(\) => keyRef\.key, \(\) => \{ dele\.hit = true; \}\);\n\s+return runClaude\("main", prompt \+ directorNote\(\)/, "the direct Director chat path");
  assert.match(block("function decideProposal(", '} else if (decision === "reject" && note) {'), /filterText: makeDelegateFilter\(0, \(\) => pKey\.key\),\s*onEntry: \(k\) => \{ pKey\.key = k; \}/, "an approved proposal reports back to its own thread");
  assert.ok(!/makeDelegateFilter\(0, undefined\)/.test(SERVER), "no caller passes a frozen undefined any more");
});
