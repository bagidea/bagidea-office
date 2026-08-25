// The artifact pattern: the teammate's result goes to disk, the Director's
// thread carries a head plus a pointer.
//
// The defect this fixes is a billing one. Pasting a 6000-character report into
// the thread does not cost once — it is re-sent as cached input on every later
// turn of that thread. On 2026-08-16, 58% of the office's ~US$195 day was cache
// reads; fresh input was 0.1%. These pin the contract that keeps reports out of
// the permanent thread.
const test = require("node:test");
const assert = require("node:assert");
const art = require("../artifact");

const long = "x".repeat(9000);

test("a short report rides whole — nothing to save by splitting it", () => {
  const r = art.splitReport("todo listo");
  assert.equal(r.head, "todo listo");
  assert.equal(r.truncated, false);
  assert.equal(r.full, "todo listo");
});

test("a long report is cut for the thread but kept whole for the file", () => {
  const r = art.splitReport(long);
  assert.ok(r.head.length <= art.HEAD_CHARS, "the head must respect the budget");
  assert.equal(r.full, long, "the file gets everything — the record is never truncated");
  assert.equal(r.truncated, true);
});

test("the head is a real saving, not a token trim", () => {
  const r = art.splitReport(long);
  // The old behaviour pasted up to 6000 chars into the thread, forever.
  assert.ok(r.head.length < 6000 / 3,
    `head ${r.head.length} should be far under the old 6000-char inline blob`);
});

test("the cut prefers a line boundary so the head ends on a thought", () => {
  // Boundary at 1000, inside the last quarter of the 1200-char budget.
  const text = "a".repeat(1000) + "\n" + "b".repeat(500);
  const r = art.splitReport(text);
  assert.equal(r.truncated, true);
  assert.equal(r.head, "a".repeat(1000), "should stop at the newline, not mid-run");
  assert.ok(!r.head.includes("b"), "nothing past the boundary rides along");
});

test("no boundary in range → hard cut at the budget, still a clean prefix", () => {
  const text = "c".repeat(5000);   // not a single newline
  const r = art.splitReport(text);
  assert.equal(r.truncated, true);
  assert.equal(r.head.length, art.HEAD_CHARS);
  assert.ok(text.startsWith(r.head), "the head is always a real prefix of the text");
});

test("empty / null input never throws and never invents content", () => {
  for (const v of [null, undefined, ""]) {
    const r = art.splitReport(v);
    assert.equal(r.head, "");
    assert.equal(r.full, "");
    assert.equal(r.truncated, false);
  }
});

test("file names are filesystem-safe and carry agent + stamp", () => {
  const n = art.reportFileName("gte_ingenieria", "2026-08-16T20-30-00");
  assert.ok(/^[\w.-]+\.md$/.test(n), `unsafe name: ${n}`);
  assert.ok(n.includes("gte_ingenieria"));
  assert.ok(n.includes("2026-08-16"));
  assert.ok(!art.reportFileName("../../etc/passwd", "t").includes("/"),
    "a hostile agent id must not escape the folder");
  assert.ok(!art.reportFileName("..\\..\\win", "t").includes("\\"));
});

test("the file stands alone — it says who, what, and whether it worked", () => {
  const body = art.reportFileBody({
    name: "RRIA", fromId: "rria", ok: false,
    task: "redactar la ficha", when: "2026-08-16T20:30:00Z", text: "no pude",
  });
  assert.ok(body.includes("RRIA"));
  assert.ok(body.includes("rria"));
  assert.ok(body.includes("LA TAREA FALLÓ"));
  assert.ok(body.includes("redactar la ficha"));
  assert.ok(body.endsWith("no pude\n"), "the result itself must be the tail, intact");
});

test("with a file, the prompt carries the pointer and NOT the whole report", () => {
  const { head, full, truncated } = art.splitReport(long);
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: true, depth: 0,
    head, truncated, full, file: "C:\\office\\informes\\x.md",
  });
  assert.ok(p.includes("x.md"), "the pointer must be there");
  assert.ok(!p.includes(full), "the full report must NOT ride in the thread");
  assert.ok(p.length < full.length, "the prompt must be smaller than the report");
  assert.ok(/Read/.test(p), "must tell the Director how to open it");
});

test("a complete short report says so — no phantom 'go read the file' nudge", () => {
  const { head, full, truncated } = art.splitReport("listo, 3 archivos");
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: true, depth: 0,
    head, truncated, full, file: "/tmp/x.md",
  });
  assert.ok(p.includes("listo, 3 archivos"));
  assert.ok(!/SOLO si/.test(p), "nothing was cut, so don't suggest opening the file");
});

test("fails open: no file → the old inline behaviour, report never lost", () => {
  const { head, full, truncated } = art.splitReport("resultado importante");
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: true, depth: 0,
    head, truncated, full, file: null,
  });
  assert.ok(p.includes("resultado importante"), "a disk failure must not swallow the report");
});

test("the delegation contract is preserved verbatim at depth < 2", () => {
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: true, depth: 0,
    head: "h", truncated: false, full: "h", file: "/tmp/x.md",
  });
  assert.ok(p.includes("DELEGATE: rria ::"),
    "the Director must still know how to answer back — this is the round trip");
});

test("at depth 2 the Director is told to stop delegating", () => {
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: true, depth: 2,
    head: "h", truncated: false, full: "h", file: "/tmp/x.md",
  });
  assert.ok(!p.includes("DELEGATE: rria ::"));
  assert.ok(/Do not delegate further/.test(p));
});

test("a failed task is flagged in the prompt, not just in the file", () => {
  const p = art.buildReportPrompt({
    name: "RRIA", fromId: "rria", ok: false, depth: 0,
    head: "h", truncated: false, full: "h", file: "/tmp/x.md",
  });
  assert.ok(p.includes("THE TASK FAILED"));
});
