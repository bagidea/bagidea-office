// v1.6 (design J): skill regression — cases per skill, judged by a model turn,
// and the gate a self-correction must pass. A fake `ask` stands in for the model.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");

function mk(answers) {
  const reg = { skills: { "curl-utf8": { name: "curl-utf8", auto: true, content: "POST JSON via a UTF-8 file with --data-binary @file" }, builtin: { name: "Builtin", builtin: true, content: "x" } } };
  const saved = { n: 0 }, asked = [];
  const st = require("../skilltests")({ reg, saveReg: () => { saved.n++; }, log: () => {},
    ask: async (prompt) => { asked.push(prompt); return typeof answers === "function" ? answers(prompt) : answers; } });
  return { reg, st, saved, asked };
}

test("cases: set, validate, cap, clear", () => {
  const { st, reg, saved } = mk("");
  const c = st.setCases("curl-utf8", [{ prompt: "How do I POST Thai text?", expect: "data-binary" }, { prompt: "", expect: "x" }, { prompt: "y", expect: "" }]);
  assert.strictEqual(c.length, 1, "blank cases are dropped");
  assert.strictEqual(saved.n, 1);
  assert.throws(() => st.setCases("nope", []), /no such skill/);
  assert.throws(() => st.setCases("curl-utf8", [{ prompt: "p", expect: "(" }]), /bad expect pattern/);
  assert.strictEqual(st.setCases("curl-utf8", new Array(20).fill({ prompt: "p", expect: "e" })).length, st.MAX_CASES);
  st.setCases("curl-utf8", []);
  assert.strictEqual(st.cases("curl-utf8").length, 0);
  assert.strictEqual("curl-utf8" in reg.skillTests, false);
});

test("judge: a regex, case-insensitive, and a ! negation", () => {
  const { st } = mk("");
  assert.strictEqual(st.judge("data-binary", "use --DATA-BINARY @body.json"), true);
  assert.strictEqual(st.judge("!inline", "put it in a file"), true);
  assert.strictEqual(st.judge("!inline", "pass it inline"), false);
});

test("run: every case gets its own model turn with the skill text as the only instructions", async () => {
  const { st, asked } = mk((p) => /Thai/.test(p) ? "Write the JSON to a file and send --data-binary @body.json" : "just -d it inline");
  st.setCases("curl-utf8", [{ prompt: "How do I POST Thai text?", expect: "data-binary" }, { prompt: "How do I POST ascii?", expect: "!data-binary" }]);
  const r = await st.run("curl-utf8");
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.results.map((x) => x.pass), [true, true]);
  assert.strictEqual(asked.length, 2);
  assert.match(asked[0], /<skill name="curl-utf8">\nPOST JSON via a UTF-8 file/);
  assert.match(asked[0], /Task: How do I POST Thai text\?/);
  // a candidate text is what gets tested, not the stored one
  await st.run("curl-utf8", "CANDIDATE TEXT");
  assert.match(asked[2], /CANDIDATE TEXT/);
  await assert.rejects(st.run("nope"), /no such skill/);
});

test("gate: no cases → accepted; a failing case → refused and recorded on the skill; a model error counts as a failure", async () => {
  const { st, reg, saved } = mk((p) => /inline/i.test(p) ? "pass it inline" : "use --data-binary @file");
  const open = await st.gate("curl-utf8", "anything");
  assert.deepStrictEqual([open.ok, open.skipped], [true, true]);
  st.setCases("curl-utf8", [{ prompt: "POST Thai", expect: "data-binary" }]);
  const good = await st.gate("curl-utf8", "keep using the file");
  assert.strictEqual(good.ok, true);
  assert.deepStrictEqual([reg.skills["curl-utf8"].lastTest.ok, reg.skills["curl-utf8"].lastTest.candidate], [true, false]);
  const bad = await st.gate("curl-utf8", "just send it inline, it is fine");
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(reg.skills["curl-utf8"].lastTest.candidate, true, "the failing run was a candidate, not the live text");
  assert.ok(saved.n >= 3);
  const { st: st2 } = mk(async () => { throw new Error("model down"); });
  st2.setCases("curl-utf8", [{ prompt: "p", expect: "e" }]);
  const r = await st2.gate("curl-utf8", "c");
  assert.strictEqual(r.ok, false);
  assert.match(r.results[0].error, /model down/);
  assert.deepStrictEqual(Object.keys(st.summary()), ["curl-utf8"]);
});

test("wiring: the daemon gates self-corrections, keeps learning the new skill after a refusal, serves the routes, and hands plugins skillTests", () => {
  for (const s of ['require("./skilltests")', "await skillTests.gate(rf.id, rf.content)", 'type: "skill.refine.blocked"', "return finishLearn();", "function finishLearn() {",
    'req.url.split("?")[0] === "/skills/tests"', 'req.url === "/skills/tests/run"'])
    assert.ok(SERVER.includes(s), "server.js should contain: " + s);
  assert.match(SERVER, /  skillTests,\r?\n\}\);/, "plugins are handed skillTests");
  // the refusal comes before the live text is touched
  const i = SERVER.indexOf("await skillTests.gate(rf.id, rf.content)"), j = SERVER.indexOf("cur.prev = cur.content;");
  assert.ok(i > -1 && j > i, "the gate runs before cur.prev is written");
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "daemon", "plugin-library", "skill-regression", "plugin.json"), "utf8"));
  assert.strictEqual(man.id, "skill-regression");
});
