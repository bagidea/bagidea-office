// A scheduled job must arrive as an ORDER, not as a reminder. The office used to
// send the raw prompt with none of the scaffolding every other run path carries —
// so the Director answered the schedule, wrote a plan in prose, and dispatched
// nothing. These pin the contract that made that possible.
const test = require("node:test");
const assert = require("node:assert");
const jo = require("../joborder");

const DNOTE = "<system-capability>DELEGATE: <agent_id> :: ...</system-capability>";
const ANOTE = "<autopilot>STATUS: DONE</autopilot>";

test("only the Director is treated as a dispatcher", () => {
  assert.equal(jo.isDirectorJob("main"), true);
  assert.equal(jo.isDirectorJob("pixel"), false);
  assert.equal(jo.isDirectorJob("ceo"), false);
});

test("the original order survives verbatim — scaffolding is added, never rewritten", () => {
  const p = jo.jobPrompt("สรุปยอดขายเมื่อวาน", { director: true, directorNote: DNOTE });
  assert.ok(p.startsWith("สรุปยอดขายเมื่อวาน"));
});

test("a fired job always says: act in THIS turn, don't just acknowledge", () => {
  for (const director of [true, false]) {
    const p = jo.jobPrompt("do the thing", { director, directorNote: DNOTE });
    assert.ok(p.includes("<standing-order>"), "standing-order note missing");
    assert.ok(/scheduled order is a real order/i.test(p));
  }
});

test("a Director job carries the DELEGATE protocol — the bug was that it didn't", () => {
  const p = jo.jobPrompt("ตรวจงานทีมแล้วสั่งงานต่อ", { director: true, directorNote: DNOTE });
  assert.ok(p.includes(DNOTE), "the Director must be told how to dispatch");
  assert.ok(p.includes("DELEGATE:"));
  assert.ok(p.includes("<standing-order-director>"));
});

test("a teammate is never told to delegate — nothing would parse its lines", () => {
  const p = jo.jobPrompt("รีเฟรชรายงาน", { director: false, directorNote: DNOTE });
  assert.ok(!p.includes(DNOTE));
  assert.ok(!p.includes("DELEGATE:"),
    "a teammate writing DELEGATE lines would just be talking to itself");
});

test("🤖 AUTO rides a job exactly like an owner-facing turn, and only when it's on", () => {
  const on = jo.jobPrompt("x", { director: true, directorNote: DNOTE, autoNote: ANOTE });
  assert.ok(on.includes(ANOTE));
  assert.ok(on.indexOf(ANOTE) > on.indexOf(DNOTE), "AUTO note goes last, as everywhere else");
  const off = jo.jobPrompt("x", { director: true, directorNote: DNOTE, autoNote: "" });
  assert.ok(!off.includes("<autopilot>"), "AUTO off must add nothing");
});

test("no options at all is still a valid order (never throws, never drops the prompt)", () => {
  const p = jo.jobPrompt("bare");
  assert.ok(p.startsWith("bare"));
  assert.ok(p.includes("<standing-order>"));
});
