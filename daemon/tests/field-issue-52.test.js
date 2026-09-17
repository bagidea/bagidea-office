// Issue #52 — an abnormal end must be written into the persistent session history
// (entry.log, what GET /sessions/log reads), not only broadcast to a live viewer.
// Four branches detect a failure and used to say nothing to a later reader: the
// watchdog kill, the no-result backstop in fireDone, the child "error" event, and
// the brain-dead key branch. Guarded by code shape: each branch calls abnormalEnd().
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// CRLF-insensitive: the file is read with every carriage return removed.
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").split("\r").join("");
const block = (from, to) => {
  const i = SERVER.indexOf(from);
  assert.ok(i > -1, "block not found: " + from.slice(0, 40));
  const j = SERVER.indexOf(to, i + from.length);
  return SERVER.slice(i, j > -1 ? j : i + 3000);
};

test("#52 every abnormal end writes one visible line into entry.log and persists it", () => {
  const helper = block("const abnormalEnd = (why) => {", "const fireDone = (text, ok) => {");
  assert.match(helper, /entry\.log\.push\(\{ who: "agent", text: "⚠ Run ended abnormally — "/, "the helper writes a real message");
  assert.match(helper, /saveSess\(\);/, "…and persists it at once");
  assert.match(helper, /if \(abnormalNoted\) return;/, "…once per run");
  assert.match(block("onKill: (reason) => {", "watchdog.start();"), /abnormalEnd\(`the watchdog stopped this run/, "watchdog kill");
  assert.match(block("const fireDone = (text, ok) => {", "watchdog.clear();"), /if \(!ok\) abnormalEnd\("the run ended without a result"/, "no-result backstop");
  assert.match(block('child.on("error", (e) => {', 'child.on("close"'), /abnormalEnd\("adapter error: " \+ e\.message\)/, "adapter error");
  assert.match(block("if (permanent || dead) {", "} else {"), /abnormalEnd\(`the brain \$\{mtag\} could not answer/, "dead key");
});

test("#52 a normal finish never writes the abnormal line", () => {
  const backstop = block("const fireDone = (text, ok) => {", "watchdog.clear();");
  assert.match(backstop, /if \(!ok\) abnormalEnd\(/, "the backstop only notes a failure");
  // the helper is the only writer of that line — a result event goes through the normal path
  assert.strictEqual((SERVER.match(/⚠ Run ended abnormally/g) || []).length, 1, "one writer");
});
