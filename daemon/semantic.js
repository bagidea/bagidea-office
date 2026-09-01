// BagIdea Office — the semantic half of retrieval.
//
// retrieval.js is BM25: it matches WORDS, and it does that offline with no
// dependencies, which is why it stays exactly as it is. What it cannot do is
// match meaning. Ask "ทำไมวอลเปเปอร์หาย" and a note that says "WorkerW teardown
// kills the embedded world" shares not one token with the question, so it does
// not come back — however good the note was.
//
// This module adds the other half: an embedding per document, cosine similarity
// against the query, and the two rankings fused. It is OPT-IN and it fails soft.
// Every path here returns null rather than throwing, because an office that
// stops working when an embedding endpoint is down is worse than one that
// quietly goes back to matching words.
//
// Fusion is Reciprocal Rank Fusion, not a weighted sum of scores. BM25 scores
// and cosine similarities are not on the same scale and never will be — one is
// unbounded and corpus-relative, the other is [-1,1]. RRF only reads the two
// ORDERINGS, so there is no normalisation constant to tune and get wrong.

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const RRF_K = 60;                 // the constant from the original RRF paper
const BATCH = 24;                 // documents per embedding request
const MAX_CHARS = 2000;           // per document; the tail of a long note is noise
const CACHE_VER = 2;
// Two very different waits. A query embedding sits in front of the owner and
// must give up fast — a slow one is worse than no semantics at all. The first
// full index is thousands of documents through whatever endpoint is configured,
// and on a general chat model rather than a dedicated embedding one a batch
// really does take minutes. Measured: 2005 documents through llama3.1 timed out
// batch after batch at 20s and indexed nothing.
const QUERY_TIMEOUT = 20000;
const BATCH_TIMEOUT = 180000;

let cfg = { enabled: false, baseUrl: "", model: "", key: "" };
let vectors = new Map();          // id -> { hash, vec: number[] }
let cachePath = null;
let dirty = false;
let inflight = null;              // one embedding pass at a time

const hash = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

// Vectors go to disk as packed float32, not as JSON numbers. A 4096-dimension
// embedding written as JSON is about 36KB; the same numbers packed are 16KB,
// and base64 of that is 22KB — but the real saving is parse time, because the
// whole cache is read at boot. Measured on this office: 552 vectors of a 4096-
// dimension model came to 20MB of JSON.
const packVec = (v) => Buffer.from(Float32Array.from(v).buffer).toString("base64");
const unpackVec = (b64) => {
  const buf = Buffer.from(b64, "base64");
  // Buffer.from(base64) can hand back a view into a shared pool, so slice to
  // an owned ArrayBuffer before reading it as floats.
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

function configure(spec, cacheFile) {
  const next = {
    enabled: !!(spec && spec.enabled),
    baseUrl: String((spec && spec.baseUrl) || "").replace(/\/+$/, ""),
    model: String((spec && spec.model) || ""),
    key: String((spec && spec.key) || ""),
  };
  // A different endpoint or model means different vectors. Keeping the old ones
  // would silently compare embeddings from two models, which produces confident
  // nonsense rather than an error.
  if (next.baseUrl !== cfg.baseUrl || next.model !== cfg.model) vectors = new Map();
  cfg = next;
  if (cacheFile) cachePath = cacheFile;
  return ready();
}

function ready() {
  return !!(cfg.enabled && cfg.baseUrl && cfg.model);
}

// POST to an OpenAI-shaped /embeddings. Ollama, LM Studio, OpenAI and anything
// else speaking that shape all work; there is nothing provider-specific here.
function post(input, timeout) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(cfg.baseUrl + "/embeddings"); } catch { return resolve(null); }
    const body = JSON.stringify({ model: cfg.model, input });
    const mod = url.protocol === "http:" ? http : https;
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
    if (cfg.key) headers.authorization = "Bearer " + cfg.key;
    const req = mod.request(url, { method: "POST", headers, timeout: timeout || QUERY_TIMEOUT }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.error("[semantic] " + res.statusCode + " " + d.slice(0, 200));
          return resolve(null);
        }
        try {
          const j = JSON.parse(d);
          const out = (j.data || []).map((x) => x.embedding).filter(Array.isArray);
          resolve(out.length ? out : null);
        } catch { resolve(null); }
      });
    });
    req.on("error", (e) => { console.error("[semantic] " + (e.message || e.code || "request failed")); resolve(null); });
    req.on("timeout", () => {
      console.error("[semantic] timed out after " + ((timeout || QUERY_TIMEOUT) / 1000) + "s (" +
        (Array.isArray(input) ? input.length : 1) + " input(s)) — a dedicated embedding model is far faster than a chat one");
      req.destroy(); resolve(null);
    });
    req.end(body);
  });
}

// The query's vector. Returns null when semantics are off or the endpoint is
// unreachable — the caller then gets plain BM25, which is the whole point of
// keeping these two halves separate.
async function embedQuery(text) {
  if (!ready() || !text) return null;
  const out = await post([String(text).slice(0, MAX_CHARS)], QUERY_TIMEOUT);
  return out && out[0] ? out[0] : null;
}

// Bring the document vectors up to date with the index. Only documents whose
// TEXT changed are re-embedded, so a restart costs nothing and an edited note
// costs one row.
//
// `list` is the WHOLE corpus, not a delta. That is how a deleted document
// loses its vector: anything absent from the list is treated as gone.
async function indexDocs(list) {
  if (!ready() || inflight) return 0;
  const todo = [];
  const seen = new Set();
  for (const d of list) {
    if (!d || !d.id || !d.text) continue;
    seen.add(d.id);
    const h = hash(d.text);
    const cur = vectors.get(d.id);
    if (!cur || cur.hash !== h) todo.push({ id: d.id, h, text: String(d.text).slice(0, MAX_CHARS) });
  }
  // Documents that left the index take their vectors with them.
  for (const id of [...vectors.keys()]) if (!seen.has(id)) { vectors.delete(id); dirty = true; }
  if (!todo.length) { if (dirty) persist(); return 0; }

  inflight = (async () => {
    let done = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const out = await post(chunk.map((c) => c.text), BATCH_TIMEOUT);
      // A failed batch is left for the next pass rather than retried in a loop:
      // whatever is wrong (endpoint down, model pulled) will not fix itself in
      // the next 50ms, and the office still works without it.
      if (!out || out.length !== chunk.length) break;
      chunk.forEach((c, n) => vectors.set(c.id, { hash: c.h, vec: Float32Array.from(out[n]) }));
      done += chunk.length;
      dirty = true;
      // A first pass can be thousands of documents. Say so as it goes, and
      // save as it goes, so a restart resumes instead of starting over.
      if (done % (BATCH * 8) === 0) {
        console.log("[semantic] " + done + "/" + todo.length + " embedded");
        persist();
      }
    }
    if (dirty) persist();
    return done;
  })();
  try { return await inflight; } finally { inflight = null; }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Ids most similar to the query vector, best first. `allowed` (a Set) keeps the
// caller's tier/ref filtering authoritative — this never widens a search.
function rank(qvec, allowed, k) {
  if (!qvec || !vectors.size) return [];
  const out = [];
  for (const [id, v] of vectors) {
    if (allowed && !allowed.has(id)) continue;
    out.push({ id, sim: cosine(qvec, v.vec) });
  }
  out.sort((a, b) => b.sim - a.sim);
  return out.slice(0, k || 20);
}

// Reciprocal Rank Fusion of two orderings of ids. Position is all that is read,
// so the two halves never need a shared scale.
function fuse(listA, listB, k) {
  const score = new Map();
  const add = (ids) => ids.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1)));
  add(listA);
  add(listB);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

function persist() {
  if (!cachePath) return;
  try {
    // Vectors are big and worthless without the model that made them, so the
    // file records which model it is: a changed model reads back as empty
    // rather than as embeddings that quietly do not compare.
    const rows = [];
    for (const [id, v] of vectors) rows.push([id, v.hash, packVec(v.vec)]);
    fs.writeFileSync(cachePath,
      JSON.stringify({ ver: CACHE_VER, model: cfg.model, baseUrl: cfg.baseUrl, rows }));
    dirty = false;
  } catch (e) { console.error("[semantic] persist:", e.message); }
}

function load() {
  if (!cachePath) return 0;
  try {
    const j = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (j.ver !== CACHE_VER || j.model !== cfg.model || j.baseUrl !== cfg.baseUrl) return 0;
    vectors = new Map((j.rows || []).map(([id, h, b64]) => [id, { hash: h, vec: unpackVec(b64) }]));
    return vectors.size;
  } catch { return 0; }
}

function stats() {
  return { enabled: cfg.enabled, ready: ready(), model: cfg.model,
    baseUrl: cfg.baseUrl, vectors: vectors.size };
}

function clear() { vectors = new Map(); dirty = true; }

module.exports = { configure, ready, embedQuery, indexDocs, rank, fuse, cosine,
  persist, load, stats, clear, RRF_K };
