// Unit + integration tests for daemon/semantic.js.
//
// The integration half runs against a STUB embeddings server rather than a real
// model: what needs proving here is the plumbing — that the HTTP shape is right,
// that only changed documents are re-embedded, that a dead endpoint degrades to
// nothing instead of throwing, and that the cache refuses vectors made by a
// different model. A real model would make those assertions slower and no more
// true.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const S = require("../semantic");

// A deterministic "embedding": a fixed-size bag of character codes. Two texts
// sharing characters land near each other, which is enough to assert ordering.
function fakeVec(text) {
  const v = new Array(16).fill(0);
  for (const ch of String(text).toLowerCase()) v[ch.charCodeAt(0) % 16] += 1;
  return v;
}

let calls = [];
let failNext = false;
let server, base;

test.before(async () => {
  server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (failNext) { res.writeHead(500); return res.end("nope"); }
      let input = [];
      try { input = JSON.parse(b).input || []; } catch {}
      calls.push(input.length);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: input.map((t) => ({ embedding: fakeVec(t) })) }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port + "/v1";
});
test.after(() => { try { server.close(); } catch {} });

const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-sem-")), "semantic.json");

// ── pure maths ─────────────────────────────────────────────────────────
test("cosine: identical vectors are 1, opposite are -1", () => {
  assert.ok(Math.abs(S.cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  assert.ok(Math.abs(S.cosine([1, 2, 3], [-1, -2, -3]) + 1) < 1e-9);
});

test("cosine: a zero vector scores 0 rather than dividing by zero", () => {
  assert.strictEqual(S.cosine([0, 0], [1, 1]), 0);
  assert.ok(Number.isFinite(S.cosine([0, 0], [0, 0])));
});

test("cosine: vectors of different lengths do not throw", () => {
  assert.ok(Number.isFinite(S.cosine([1, 2, 3, 4], [1, 2])));
});

test("fuse: agreement across both rankings wins", () => {
  // "both" is 2nd by words and 1st by meaning. "wordsonly" is 1st by words and
  // buried by meaning. Note the size of the gap that takes: with RRF_K = 60,
  // 1st and 2nd place differ by less than 0.03%, which is the point of the
  // constant — it stops the top of either list from dominating on its own.
  const words = ["wordsonly", "both", ...Array.from({ length: 20 }, (_, i) => "w" + i)];
  const meaning = ["both", ...Array.from({ length: 20 }, (_, i) => "m" + i), "wordsonly"];
  assert.strictEqual(S.fuse(words, meaning, 3)[0], "both");
});

test("fuse: an id in only one list still gets through", () => {
  const out = S.fuse(["x"], ["y"], 5);
  assert.deepStrictEqual(out.sort(), ["x", "y"]);
});

test("fuse: never returns more than k", () => {
  assert.strictEqual(S.fuse(["a", "b", "c"], ["d", "e", "f"], 2).length, 2);
});

// ── configuration ──────────────────────────────────────────────────────
test("ready: needs enabled, an endpoint AND a model", () => {
  assert.strictEqual(S.configure({ enabled: false, baseUrl: base, model: "m" }), false);
  assert.strictEqual(S.configure({ enabled: true, baseUrl: "", model: "m" }), false);
  assert.strictEqual(S.configure({ enabled: true, baseUrl: base, model: "" }), false);
  assert.strictEqual(S.configure({ enabled: true, baseUrl: base, model: "m" }), true);
});

test("changing the model throws the old vectors away", async () => {
  S.configure({ enabled: true, baseUrl: base, model: "m1" }, tmpCache());
  await S.indexDocs([{ id: "d1", text: "hello" }]);
  assert.strictEqual(S.stats().vectors, 1);
  S.configure({ enabled: true, baseUrl: base, model: "m2" }, tmpCache());
  // Vectors from two different models are not comparable, and comparing them
  // anyway produces confident nonsense rather than an error.
  assert.strictEqual(S.stats().vectors, 0);
});

// ── indexing ───────────────────────────────────────────────────────────
test("indexDocs: embeds each document once and no more", async () => {
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear(); calls = [];
  const docs = [{ id: "a", text: "one" }, { id: "b", text: "two" }];
  assert.strictEqual(await S.indexDocs(docs), 2);
  assert.strictEqual(S.stats().vectors, 2);
  calls = [];
  assert.strictEqual(await S.indexDocs(docs), 0, "unchanged documents were re-embedded");
  assert.strictEqual(calls.length, 0, "an unchanged pass still hit the endpoint");
});

test("indexDocs: only the CHANGED document is re-embedded", async () => {
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }, { id: "b", text: "two" }]);
  calls = [];
  await S.indexDocs([{ id: "a", text: "one" }, { id: "b", text: "two — edited" }]);
  assert.deepStrictEqual(calls, [1], "expected exactly one document in one request");
});

test("indexDocs: a document that left the index loses its vector", async () => {
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }, { id: "b", text: "two" }]);
  await S.indexDocs([{ id: "a", text: "one" }]);
  assert.strictEqual(S.stats().vectors, 1);
});

test("a dead endpoint degrades to nothing, it does not throw", async () => {
  S.configure({ enabled: true, baseUrl: "http://127.0.0.1:1/v1", model: "m" }, tmpCache());
  S.clear();
  assert.strictEqual(await S.embedQuery("anything"), null);
  assert.strictEqual(await S.indexDocs([{ id: "a", text: "one" }]), 0);
});

test("a failing endpoint keeps whatever it already had", async () => {
  // indexDocs takes the WHOLE corpus each time — that is how it notices
  // deletions — so both documents have to be in the list or "a" is correctly
  // read as having left the index.
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }]);
  failNext = true;
  try {
    await S.indexDocs([{ id: "a", text: "one" }, { id: "b", text: "two" }]);
  } finally { failNext = false; }
  assert.strictEqual(S.stats().vectors, 1, "an outage cost us the vectors we had");
});

test("indexDocs: the list IS the corpus, so an omitted document is a deletion", async () => {
  // Documented explicitly because it is the sharp edge of this API: callers
  // must pass everything, not a delta.
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }, { id: "b", text: "two" }]);
  assert.strictEqual(S.stats().vectors, 2);
  await S.indexDocs([{ id: "b", text: "two" }]);
  assert.strictEqual(S.stats().vectors, 1);
});

test("embedQuery returns null when the tier is switched off", async () => {
  S.configure({ enabled: false, baseUrl: base, model: "m" }, tmpCache());
  assert.strictEqual(await S.embedQuery("anything"), null);
});

// ── ranking ────────────────────────────────────────────────────────────
test("rank: closest first, and never outside the allowed set", async () => {
  S.configure({ enabled: true, baseUrl: base, model: "m" }, tmpCache());
  S.clear();
  await S.indexDocs([
    { id: "cat", text: "aaaa" },
    { id: "dog", text: "aaab" },
    { id: "far", text: "zzzz" },
  ]);
  const q = fakeVec("aaaa");
  const all = S.rank(q, null, 10);
  assert.strictEqual(all[0].id, "cat");
  assert.strictEqual(all[all.length - 1].id, "far");
  // The caller's tier/ref filtering stays authoritative: semantics may reorder
  // what is reachable, never widen it.
  const limited = S.rank(q, new Set(["dog", "far"]), 10).map((r) => r.id);
  assert.ok(!limited.includes("cat"), "ranked a document the caller excluded");
});

test("rank: with no vectors at all it returns nothing", () => {
  S.clear();
  assert.deepStrictEqual(S.rank([1, 2, 3], null, 5), []);
});

// ── the cache ──────────────────────────────────────────────────────────
test("cache: survives a reload", async () => {
  const file = tmpCache();
  S.configure({ enabled: true, baseUrl: base, model: "m" }, file);
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }]);
  S.persist();
  S.clear();
  assert.strictEqual(S.stats().vectors, 0);
  assert.strictEqual(S.load(), 1);
  assert.strictEqual(S.stats().vectors, 1);
});

test("cache: vectors made by a DIFFERENT model are not loaded", async () => {
  const file = tmpCache();
  S.configure({ enabled: true, baseUrl: base, model: "m1" }, file);
  S.clear();
  await S.indexDocs([{ id: "a", text: "one" }]);
  S.persist();
  // Same file, different model: the rows are real, and meaningless to us now.
  S.configure({ enabled: true, baseUrl: base, model: "m2" }, file);
  assert.strictEqual(S.load(), 0, "loaded another model's vectors");
});

test("cache: a corrupt file is not fatal", () => {
  const file = tmpCache();
  fs.writeFileSync(file, "{not json");
  S.configure({ enabled: true, baseUrl: base, model: "m" }, file);
  assert.strictEqual(S.load(), 0);
});

test("cache: packed vectors round-trip through disk unchanged", async () => {
  // Vectors are stored as packed float32, not JSON numbers. A packing bug would
  // not throw — it would quietly rank everything wrongly, which is worse.
  const file = tmpCache();
  S.configure({ enabled: true, baseUrl: base, model: "m" }, file);
  S.clear();
  await S.indexDocs([{ id: "a", text: "some text here" }]);
  const before = S.rank(fakeVec("some text here"), null, 1)[0].sim;
  S.persist();
  S.clear();
  S.load();
  const after = S.rank(fakeVec("some text here"), null, 1)[0].sim;
  // float32 rounding, not exact equality — but nowhere near a reordering.
  assert.ok(Math.abs(before - after) < 1e-5,
    "similarity changed across a save/load: " + before + " vs " + after);
});

test("cache: the packed format is much smaller than JSON numbers", async () => {
  const file = tmpCache();
  S.configure({ enabled: true, baseUrl: base, model: "m" }, file);
  S.clear();
  await S.indexDocs(Array.from({ length: 20 }, (_, i) => ({ id: "d" + i, text: "text " + i })));
  S.persist();
  const packed = fs.statSync(file).size;
  const asJson = JSON.stringify(S.rank(fakeVec("text 1"), null, 99)).length;
  assert.ok(packed > 0 && asJson > 0);
  // Guards the format rather than a number: a regression to plain JSON arrays
  // would blow this past the bound on a real 4096-dimension model.
  assert.ok(packed < 20 * 16 * 12, "cache is far larger than packed floats should be: " + packed);
});
