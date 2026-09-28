// Delegation onDone (server.js DELEGATE handler) settles its board card through
// tasks.settleDelegation: an ok session must NOT overwrite a "waiting" the agent
// set on purpose (reports still owed), while a card still in the dispatch
// "doing" goes to done and a failed session parks it as waiting.
//
// Pure module test: tasks.js on a temp file, no daemon boot.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const initTasks = require("../tasks");

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delegation-settle-"));
  return initTasks({ file: path.join(dir, "tasks.json") });
}
const delegation = (tasks) => tasks.create({ title: "delegated", kind: "delegation", owner: "jeje", status: "doing" });

test("ok onDone keeps a waiting the agent set during the session", () => {
  const tasks = fresh();
  const card = delegation(tasks);
  tasks.move(card.id, "waiting");                    // agent: reports still owed
  tasks.settleDelegation(card.id, true);
  assert.strictEqual(tasks.get(card.id).status, "waiting");
});

test("ok onDone keeps a todo the agent set during the session", () => {
  const tasks = fresh();
  const card = delegation(tasks);
  tasks.move(card.id, "todo");
  tasks.settleDelegation(card.id, true);
  assert.strictEqual(tasks.get(card.id).status, "todo");
});

test("ok onDone moves a plain doing card to done", () => {
  const tasks = fresh();
  const card = delegation(tasks);
  tasks.settleDelegation(card.id, true);
  const after = tasks.get(card.id);
  assert.strictEqual(after.status, "done");
  assert.ok(after.done > 0);
});

test("failed onDone still parks the card as waiting", () => {
  const tasks = fresh();
  const card = delegation(tasks);
  tasks.settleDelegation(card.id, false);
  assert.strictEqual(tasks.get(card.id).status, "waiting");
});

test("unknown card id is a no-op, not a throw", () => {
  const tasks = fresh();
  assert.strictEqual(tasks.settleDelegation("nope", true), null);
});

test("server.js DELEGATE onDone uses settleDelegation, not an unconditional move", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(/tasks\.settleDelegation\(card\.id, ok\)/.test(src));
  assert.ok(!/tasks\.move\(card\.id, ok \? "done" : "waiting"\)/.test(src));
});
