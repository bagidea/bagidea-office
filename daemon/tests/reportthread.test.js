// A delegated result must come home to the thread the ORDER was given on.
//
// The owner gave an order on a fresh thread, the Director delegated it, the
// teammate finished — and the report-back was filed in a different thread. From
// the owner's seat the task simply never came back. The cause was a captured
// `session: undefined`, which downstream means "continue the agent's LATEST
// thread", resolved minutes later when "latest" was something else entirely.
//
// These pin the contract that makes that impossible: the thread is read LATE.
const test = require("node:test");
const assert = require("node:assert");
const { resolveThread, isLate } = require("../reportthread");

test("a keyRef is read at resolve time, not at capture time — this is the bug", () => {
  const keyRef = { key: "" };                 // fresh thread: no key yet
  const readLater = () => resolveThread(keyRef);
  assert.equal(readLater(), undefined, "before onEntry there is genuinely no thread");
  keyRef.key = "s_order";                     // runClaude's onEntry fires
  assert.equal(readLater(), "s_order",
    "the report must follow the thread the turn actually landed on");
});

test("the owner opening another thread cannot steal the report-back", () => {
  // The exact shape of the incident: order on thread A, owner opens thread B
  // while the teammate works, report lands when B is the latest.
  const keyRef = { key: "s_A" };
  const latestNow = "s_B";                    // what `undefined` would have resolved to
  assert.equal(resolveThread(keyRef), "s_A");
  assert.notEqual(resolveThread(keyRef), latestNow);
});

test("a pinned string key still works — paths that know their thread keep it", () => {
  assert.equal(resolveThread("s_known"), "s_known");
});

test("empty / missing refs fall back to undefined, preserving the documented default", () => {
  // undefined = "continue the agent's latest thread". That default is correct for
  // paths with no thread of their own; it was only wrong when it leaked from a ref.
  assert.equal(resolveThread(undefined), undefined);
  assert.equal(resolveThread(null), undefined);
  assert.equal(resolveThread(""), undefined);
  assert.equal(resolveThread({ key: "" }), undefined);
  assert.equal(resolveThread({}), undefined);
});

test("a thunk is supported and is also read late", () => {
  let cur = "s_1";
  const ref = () => cur;
  assert.equal(resolveThread(ref), "s_1");
  cur = "s_2";
  assert.equal(resolveThread(ref), "s_2");
});

test("resolving never throws — a report-back must not die on the way home", () => {
  assert.equal(resolveThread(() => { throw new Error("boom"); }), undefined);
  assert.equal(resolveThread(123), undefined);
  assert.equal(resolveThread({ key: 42 }), undefined);
  const hostile = { get key() { throw new Error("boom"); } };
  assert.equal(resolveThread(hostile), undefined);
});

test("isLate flags the refs that must not be captured by value", () => {
  assert.equal(isLate({ key: "" }), true, "a keyRef can still change");
  assert.equal(isLate(() => "x"), true);
  assert.equal(isLate("s_known"), false, "an explicit key is already pinned");
  assert.equal(isLate(undefined), false);
  assert.equal(isLate(null), false);
});
