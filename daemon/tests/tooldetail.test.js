"use strict";
// 🛠 Dev Mode tool-detail store (daemon/tooldetail.js): per-thread JSONL of
// redacted tool summaries, joined into history rows by call id.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const createToolDetails = require("../tooldetail");
const devmode = require("../devmode");

const SECRET = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4";

function store(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tooldetail-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, td: createToolDetails({ dir, ...opts }) };
}
function thread(key, ids) {
  return { key, log: [{ who: "you", text: "go" }, ...ids.map((id) => ({ who: "tool", text: "Bash", id }))] };
}

test("tooldetail: ids are unique and safe; names cannot collide or escape the store", () => {
  const td = createToolDetails({ dir: "unused" });
  const ids = new Set(Array.from({ length: 1000 }, () => td.newId()));
  assert.strictEqual(ids.size, 1000);
  for (const id of ids) assert.ok(createToolDetails.validId(id), id);
  const { safeName } = createToolDetails;
  assert.notStrictEqual(safeName("@sub"), safeName("_sub"));
  assert.notStrictEqual(safeName("a~40~"), safeName("a@"));
  for (const bad of ["..", "../x", "con", "a/b", "a\\b", "C:"]) assert.match(safeName(bad), /^x[A-Za-z0-9_~-]*$/, bad);
  const file = createToolDetails({ dir: path.resolve("store") }).fileOf("../../etc", "../k");
  assert.ok(file.startsWith(path.resolve("store") + path.sep) && !file.includes(".."), file);
  for (const bad of ["", "a b", "x".repeat(41), "../1", null, 5]) assert.strictEqual(createToolDetails.validId(bad), false, String(bad));
});

test("tooldetail: record + join restores each row's detail by id and leaves other rows untouched", (t) => {
  const { td } = store(t);
  const e = thread("s1", ["c-1", "c-2", "c-3"]);
  e.log.push({ who: "tool", text: "Legacy" });   // a row saved before ids existed
  assert.strictEqual(td.record("lora", e, "c-1", devmode.toolDetail("Bash", { command: "ls -la\nsecond" })), true);
  assert.strictEqual(td.record("lora", e, "c-2", devmode.toolDetail("Read", {})), true);
  const rows = td.join("lora", e);
  assert.deepStrictEqual(rows[0], e.log[0]);
  assert.deepStrictEqual(rows[1], { who: "tool", text: "Bash", id: "c-1", kind: "command", label: "ls -la", detail: "ls -la\nsecond", captured: true });
  assert.strictEqual(rows[2].captured, true); assert.strictEqual(rows[2].detail, "", "captured with empty input");
  assert.deepStrictEqual(rows[3], e.log[3], "no record → row unchanged");
  assert.deepStrictEqual(rows[4], e.log[4], "legacy row unchanged");
  assert.notStrictEqual(rows, e.log, "join returns new rows");
  assert.ok(!("detail" in e.log[1]), "sessions.json rows are never mutated");
  assert.deepStrictEqual(td.join("main", e).filter((r) => r.captured), [], "details are per bucket");
  assert.strictEqual(td.get("lora", "s1", "c-1").label, "ls -la");
  assert.strictEqual(td.get("lora", "s1", "nope"), null);
  assert.strictEqual(td.get("lora", "s1", "../x"), null);
  assert.deepStrictEqual(td.join("lora", undefined), []);
});

test("tooldetail: only the redacted, capped summary reaches disk", (t) => {
  const { td, dir } = store(t);
  const e = thread("s1", ["c-1", "c-2"]);
  td.record("main", e, "c-1", devmode.toolDetail("Bash", { command: "curl -H 'Authorization: Bearer " + SECRET + "' https://x" }));
  td.record("main", e, "c-2", devmode.toolDetail("mcp__web__fetch", { url: "https://x", api_key: SECRET, body: "y".repeat(9000) }));
  const text = fs.readFileSync(td.fileOf("main", "s1"), "utf8");
  assert.ok(!text.includes(SECRET), "no raw secret on disk");
  assert.ok(text.includes("••••••"));
  for (const line of text.trim().split("\n")) {
    const r = JSON.parse(line);
    assert.deepStrictEqual(Object.keys(r).sort(), ["detail", "id", "kind", "label", "ts"]);
    assert.ok(r.detail.length <= devmode.MAX_DETAIL && r.label.length <= devmode.MAX_LABEL);
  }
  assert.ok(fs.readdirSync(dir).every((d) => d.startsWith("x")));
});

test("tooldetail: disk errors fail open and bad input is refused", (t) => {
  const broken = createToolDetails({ dir: "Z:/nowhere", io: { ...fs, mkdirSync() { throw new Error("EACCES"); }, appendFileSync() { throw new Error("EACCES"); }, readFileSync() { throw new Error("EIO"); } } });
  const e = thread("s1", ["c-1"]);
  assert.strictEqual(broken.record("main", e, "c-1", { detail: "x" }), false);
  assert.deepStrictEqual(broken.join("main", e), e.log);
  assert.strictEqual(broken.get("main", "s1", "c-1"), null);
  assert.deepStrictEqual(broken.sweep({ main: [e] }), { removed: 0, compacted: 0 });
  const { td } = store(t);
  assert.strictEqual(td.record("main", e, "bad id!", { detail: "x" }), false);
  assert.strictEqual(td.record("main", {}, "c-1", { detail: "x" }), false);
  assert.strictEqual(td.record("main", null, "c-1", { detail: "x" }), false);
});

test("tooldetail: a torn last line is skipped; compaction keeps only calls still in the thread", (t) => {
  const { td } = store(t);
  const e = thread("s1", ["c-1", "c-2", "c-3"]);
  for (const id of ["c-1", "c-2", "c-3"]) td.record("main", e, id, { kind: "command", label: id, detail: "run " + id });
  const file = td.fileOf("main", "s1");
  fs.appendFileSync(file, '{"id":"c-4","detail":"torn');   // crash mid-append
  assert.deepStrictEqual([...td.read("main", "s1").keys()], ["c-1", "c-2", "c-3"]);
  e.log = e.log.filter((m) => m.id !== "c-1");                // c-1 scrolled out of the 200-row history
  assert.strictEqual(td.compact("main", e), true);
  assert.deepStrictEqual([...td.read("main", "s1").keys()], ["c-2", "c-3"]);
  assert.strictEqual(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 2, "torn line removed too");
  assert.strictEqual(td.compact("main", e), false, "a clean file is not rewritten");
  e.log = [];
  assert.strictEqual(td.compact("main", e), true);
  assert.strictEqual(fs.existsSync(file), false, "an empty thread leaves no file");
});

test("tooldetail: a thread file is compacted automatically when it grows past the cap", (t) => {
  const { td } = store(t, { maxFileBytes: 4000 });
  const e = thread("s1", []);
  for (let i = 0; i < 40; i++) {
    const id = "c-" + i;
    e.log.push({ who: "tool", text: "Bash", id });
    while (e.log.length > 5) e.log.shift();                   // the history keeps the last 5 rows
    td.record("main", e, id, { kind: "command", label: "l", detail: "d".repeat(200) });
  }
  assert.ok(fs.statSync(td.fileOf("main", "s1")).size <= 4000 + 400, "file stays near the cap");
  const kept = [...td.read("main", "s1").keys()];
  assert.ok(kept.includes("c-39") && !kept.includes("c-0"), kept.join(","));
});

test("tooldetail: sweep drops files of deleted/pruned threads and leftovers; remove deletes one thread", (t) => {
  const { td, dir } = store(t);
  const keep = thread("s1", ["c-1"]), gone = thread("s2", ["c-1"]), ghost = thread("u1", ["c-1"]);
  td.record("main", keep, "c-1", { detail: "a" });
  td.record("main", gone, "c-1", { detail: "b" });
  td.record("@sub", ghost, "c-1", { detail: "c" });
  fs.writeFileSync(td.fileOf("main", "s1") + ".tmp", "partial");
  fs.writeFileSync(path.join(dir, "stray.txt"), "not a folder");
  const r = td.sweep({ main: [keep], "@sub": [ghost] });
  assert.deepStrictEqual(r, { removed: 2, compacted: 0 });
  assert.ok(fs.existsSync(td.fileOf("main", "s1")) && fs.existsSync(td.fileOf("@sub", "u1")));
  assert.ok(!fs.existsSync(td.fileOf("main", "s2")));
  assert.strictEqual(td.remove("@sub", "u1"), true);
  assert.strictEqual(td.remove("@sub", "u1"), false);
  assert.deepStrictEqual(createToolDetails({ dir: path.join(dir, "missing") }).sweep({ main: [keep] }), { removed: 0, compacted: 0 });
});

test("tooldetail: names are distinct on case-insensitive disks", (t) => {
  const { safeName } = createToolDetails;
  assert.notStrictEqual(safeName("Dev").toLowerCase(), safeName("dev").toLowerCase());
  const { td } = store(t);
  const a = thread("s1", ["c-1"]), b = thread("s1", ["c-1"]);
  td.record("Lora", a, "c-1", { detail: "upper" });
  td.record("lora", b, "c-1", { detail: "lower" });
  assert.strictEqual(td.get("Lora", "s1", "c-1").detail, "upper");
  assert.strictEqual(td.get("lora", "s1", "c-1").detail, "lower");
  assert.deepStrictEqual(td.sweep({ Lora: [a], lora: [b] }), { removed: 0, compacted: 0 }, "neither bucket is mistaken for an orphan");
  assert.strictEqual(td.get("lora", "s1", "c-1").detail, "lower");
});

test("tooldetail: recording continues after the store folder is removed while the office runs", (t) => {
  const { td, dir } = store(t);
  const e = thread("s1", ["c-1", "c-2"]);
  td.record("main", e, "c-1", { detail: "one" });
  fs.rmSync(dir, { recursive: true, force: true });            // e.g. git clean -fdX
  assert.strictEqual(td.record("main", e, "c-2", { detail: "two" }), true);
  assert.strictEqual(td.get("main", "s1", "c-2").detail, "two");
});

test("tooldetail: a failed append cannot swallow the next record", (t) => {
  const { dir } = store(t);
  let failNext = false;
  const io = { ...fs, appendFileSync(file, data) {
    if (failNext) { failNext = false; fs.appendFileSync(file, String(data).slice(0, 15)); const e = new Error("ENOSPC"); e.code = "ENOSPC"; throw e; }
    return fs.appendFileSync(file, data);
  } };
  const td = createToolDetails({ dir, io });
  const e = thread("s1", ["c-1", "c-2", "c-3"]);
  td.record("main", e, "c-1", { detail: "ok" });
  failNext = true;   // the disk fills up half way through the next line
  assert.strictEqual(td.record("main", e, "c-2", { detail: "torn" }), false);
  assert.strictEqual(td.record("main", e, "c-3", { detail: "after" }), true);
  assert.deepStrictEqual([...td.read("main", "s1").keys()], ["c-1", "c-3"]);
  // a glued line written by some other crash is recovered too
  fs.appendFileSync(td.fileOf("main", "s1"), '{"id":"c-4","deta' + JSON.stringify({ id: "c-5", ts: 1, kind: "", label: "", detail: "glued" }) + "\n");
  assert.strictEqual(td.get("main", "s1", "c-5").detail, "glued");
});

test("tooldetail: once compaction cannot get under the cap, the file is rewritten only after it doubles", (t) => {
  let compactions = 0;
  const { dir } = store(t);
  const io = { ...fs, renameSync(a, b) { compactions++; return fs.renameSync(a, b); } };
  const td = createToolDetails({ dir, io, maxFileBytes: 2000 });
  const e = thread("s1", []);
  for (let i = 0; i < 60; i++) {
    const id = "c-" + i;
    e.log.push({ who: "tool", text: "Bash", id });
    while (e.log.length > 20) e.log.shift();                  // kept details alone (~20 × 250 B) exceed the cap
    td.record("main", e, id, { detail: "d".repeat(200) });
  }
  assert.ok(compactions > 0 && compactions <= 6, "compactions: " + compactions);
});

test("tooldetail: a deleted thread stays deleted even if a run still records into it", (t) => {
  const { td } = store(t);
  const e = thread("s1", ["c-1", "c-2"]);
  td.record("main", e, "c-1", { detail: "before delete" });
  assert.strictEqual(td.remove("main", "s1"), true);
  assert.strictEqual(td.record("main", e, "c-2", { detail: "after delete" }), false);
  assert.strictEqual(fs.existsSync(td.fileOf("main", "s1")), false);
  assert.strictEqual(td.get("main", "s1", "c-2"), null);
});

test("tooldetail: a compaction that fails (file held open elsewhere) backs off instead of retrying on every call", (t) => {
  let renames = 0;
  const { dir } = store(t);
  const io = { ...fs, renameSync() { renames++; const e = new Error("EPERM"); e.code = "EPERM"; throw e; } };
  const td = createToolDetails({ dir, io, maxFileBytes: 2000 });
  const e = thread("s1", []);
  for (let i = 0; i < 80; i++) {
    const id = "c-" + i;
    e.log.push({ who: "tool", text: "Bash", id });
    while (e.log.length > 3) e.log.shift();
    assert.strictEqual(td.record("main", e, id, { detail: "d".repeat(200) }), true, "recording keeps working");
  }
  assert.ok(renames > 0 && renames <= 5, "rename attempts: " + renames);
  assert.strictEqual(fs.existsSync(td.fileOf("main", "s1") + ".tmp"), false, "no temp file is left behind");
});

test("devmode: inputs too large to mask quickly are not summarised (fail closed)", () => {
  const secret = "sk-" + "Z9y8X7w6V5u4T3s2R1q0P9o8";
  const big = { command: "echo " + secret + " " + "a.".repeat(devmode.MAX_MASK_INPUT) };
  const d = devmode.toolDetail("Bash", big);
  assert.deepStrictEqual(d, { kind: "command", label: "", detail: d.detail });
  assert.match(d.detail, /^<input too large to summarise: \d+ KB>$/);
  const g = devmode.toolDetail("mcp__web__post", { body: secret + "x".repeat(devmode.MAX_MASK_INPUT) });
  assert.match(g.detail, /^<input too large to summarise/); assert.ok(!JSON.stringify(g).includes(secret));
  const ev = devmode.progressEvent({ type: "task.progress", tool: "mcp__web__post" }, { body: "y".repeat(devmode.MAX_MASK_INPUT + 1) }, true);
  assert.ok(!("input" in ev), "the live frame carries no input it could not mask quickly");
  assert.match(ev.detail, /^<input too large to summarise/);
  // just under the limit: summarised and masked as before
  const ok = devmode.toolDetail("Bash", { command: "curl -H 'Authorization: Bearer " + secret + "' x" });
  assert.ok(ok.detail.includes("••••••") && !ok.detail.includes(secret));
  // file tools only read the path, so a large Write is still summarised
  assert.strictEqual(devmode.toolDetail("Write", { file_path: "C:/a/b.txt", content: "z".repeat(1e6) }).detail, "C:/a/b.txt");
});
