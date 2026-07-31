// 🤖 AUTO mode: the office decides whether to open another turn purely from the
// text a run ended with, so this contract is the whole feature. Getting it wrong
// either strands the owner (stall stays) or loops an already-finished job.
const test = require("node:test");
const assert = require("node:assert");
const { readStatus, stripStatus, looksLikeAsking, verdict } = require("../autopilot");

test("readStatus picks the kind and the note off the status line", () => {
  assert.deepStrictEqual(readStatus("done stuff\nSTATUS: DONE — verified"),
    { kind: "DONE", note: "verified" });
  assert.deepStrictEqual(readStatus("STATUS: CONTINUE — เขียนเทสต์ต่อ"),
    { kind: "CONTINUE", note: "เขียนเทสต์ต่อ" });
  assert.strictEqual(readStatus("STATUS: blocked - need the deploy key").kind, "BLOCKED");
  assert.strictEqual(readStatus("no status here"), null);
});

test("stripStatus removes the line from what the owner sees, and nothing else", () => {
  assert.strictEqual(stripStatus("รายงาน\n\nSTATUS: DONE — เสร็จแล้ว"), "รายงาน");
  assert.strictEqual(stripStatus("a\nSTATUS: CONTINUE — next\nb"), "a\n\nb");
  // A sentence that merely mentions the word must survive untouched.
  assert.strictEqual(stripStatus("the STATUS: of the build is green"),
    "the STATUS: of the build is green");
});

test("a turn that ends by asking the owner is treated as CONTINUE", () => {
  assert.ok(looksLikeAsking("ทำ A เสร็จแล้ว จะให้ผมทำ B ต่อไหมครับ"));
  assert.ok(looksLikeAsking("Two options here. Which one do you prefer?"));
  assert.strictEqual(verdict("งานเสร็จแล้วครับ จะให้ทำต่อไหมครับ"), "CONTINUE");
});

test("a finished report is NOT restarted just because it contains a question", () => {
  const report = "แก้บั๊กแล้ว 3 จุด\nคำถามที่ค้างไว้เมื่อวาน? ตอบไปแล้วในหัวข้อ 2\nรันเทสต์ผ่านครบ";
  assert.strictEqual(looksLikeAsking(report), false);
  assert.strictEqual(verdict(report), "DONE");
});

test("an explicit status always beats the guess", () => {
  // Ends with a question, but the agent declared it is blocked → stop, don't loop.
  assert.strictEqual(verdict("ต้องใช้ key ตัวไหนครับ?\nSTATUS: BLOCKED — ไม่มี deploy key"), "BLOCKED");
  // Ends like a finished report, but says there is more → keep going.
  assert.strictEqual(verdict("ทำส่วนแรกเสร็จ\nSTATUS: CONTINUE — ต่อส่วนที่สอง"), "CONTINUE");
});

test("silence is DONE — a run with no marker never loops the office", () => {
  assert.strictEqual(verdict(""), "DONE");
  assert.strictEqual(verdict("เรียบร้อยครับ ปิดงานแล้ว"), "DONE");
});
