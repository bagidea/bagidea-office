// BagIdea Office — retrieval core (P1).
// A tiny, dependency-free BM25 index over METADATA ONLY (memory bullets,
// project/owner facts, skill name+description, archive snippets). It exists so
// agents load only what's RELEVANT to the task instead of dumping everything
// into the prompt (the "Hermes way"). No embeddings, no network — pure JS,
// works offline.
//
// BM25 matches WORDS. When the office is also running the optional semantic
// tier (daemon/semantic.js), a caller can hand search() a query VECTOR and the
// two rankings are fused — words and meaning, neither replacing the other. With
// no vector, the behaviour here is byte for byte what it always was.
//
// Cost: search scores only the documents that share a term with the query
// (union of postings lists), never the whole corpus → scales with query length.
//
// Doc id convention: "<tier>:<ref>:<n>"  e.g. mem:shino:3, user:OFFICE:1,
// proj:p_ab12:0, skill:deep-research, arch:meeting:g123, arch:chat:1700000000.

const fs = require("fs");
const path = require("path");
// Optional partner: retrieval works fully without it, and must keep doing so.
let semantic = null;
try { semantic = require("./semantic"); } catch { semantic = null; }

const VER = 1;                 // bump to force a full rebuild after tokenizer changes
const K1 = 1.2, B = 0.75;      // standard BM25 knobs
const PERSIST_DEBOUNCE_MS = 1500;

// Small EN+TH stopword set — common glue words carry no retrieval signal.
const STOP = new Set((
  "the a an and or of to in on for is are was were be been it this that with as " +
  "at by from your you i we they he she his her our their there here what which " +
  "how when where who why do does did not no yes can will would should " +
  "และ หรือ ของ ใน ที่ เป็น คือ ก็ จะ ได้ ให้ มี ไม่ นี้ นั้น กับ แล้ว ก่อน เมื่อ ว่า อยู่ มา ไป"
).split(/\s+/));

function isThaiCjk(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x0e00 && c <= 0x0e7f) || (c >= 0x3000 && c <= 0x9fff);
}
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// Lowercase, split on non-alphanumerics (Thai + CJK kept as word chars), drop
// stopwords and len<2. Thai/CJK has no word spaces and we ship no segmenter, so
// long runs are ALSO emitted as character bigrams → partial Thai/CJK matching.
// The query is tokenized the same way, so bigrams line up on both sides.
function tokenize(text) {
  const raw = String(text || "").toLowerCase()
    .split(/[^a-z0-9฀-๿　-鿿]+/).filter(Boolean);
  const terms = [];
  for (const t of raw) {
    if (t.length < 2) continue;
    if (!STOP.has(t)) terms.push(t);
    if (t.length >= 3 && [...t].some(isThaiCjk)) for (const bg of bigrams(t)) terms.push(bg);
  }
  return terms;
}

// Split a markdown blob into indexable units: bullet lines if present,
// otherwise non-trivial plain lines. Strips list/heading markers.
function unitsFromMarkdown(text) {
  const lines = String(text || "").split("\n")
    .map((l) => l.replace(/^\s*([-*+]|#{1,6})\s+/, "").trim())
    .filter((l) => l.length >= 3);
  return lines;
}

// ---- index state (in-memory; raw docs persisted, postings rebuilt on load) --
let docs = new Map();          // id -> {id, tier, ref, text, len, tf:Map<term,n>}
let postings = new Map();      // term -> Set<id>
let df = new Map();            // term -> document frequency
let totalLen = 0;              // Σ doc.len  (for avgdl)
let persistPath = null;
let persistTimer = null;

function clear() {
  docs = new Map(); postings = new Map(); df = new Map(); totalLen = 0;
}

function _unindex(doc) {
  for (const term of doc.tf.keys()) {
    const set = postings.get(term);
    if (set) { set.delete(doc.id); if (!set.size) postings.delete(term); }
    df.set(term, (df.get(term) || 1) - 1);
    if (df.get(term) <= 0) df.delete(term);
  }
  totalLen -= doc.len;
}

function removeDoc(id) {
  const doc = docs.get(id);
  if (!doc) return;
  _unindex(doc);
  docs.delete(id);
}

// Remove every doc whose id starts with `prefix` (e.g. "mem:shino:" or "skill:x").
function removeDocs(prefix) {
  for (const id of [...docs.keys()]) if (id.startsWith(prefix)) removeDoc(id);
}

function addDoc(tier, ref, id, text) {
  if (docs.has(id)) removeDoc(id);          // replace in place
  const terms = tokenize(text);
  if (!terms.length) return;
  const tf = new Map();
  for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
  const doc = { id, tier, ref: ref == null ? "" : String(ref), text: String(text), len: terms.length, tf };
  docs.set(id, doc);
  for (const term of tf.keys()) {
    let set = postings.get(term);
    if (!set) { set = new Set(); postings.set(term, set); }
    set.add(id);
    df.set(term, (df.get(term) || 0) + 1);
  }
  totalLen += doc.len;
}

// Index one markdown file as many bullet docs under "<tier>:<ref>:<n>".
function reindexFile(tier, ref, filePath) {
  removeDocs(`${tier}:${ref}:`);
  let text = "";
  try { text = fs.readFileSync(filePath, "utf8"); } catch { return; }
  unitsFromMarkdown(text).forEach((unit, i) => addDoc(tier, ref, `${tier}:${ref}:${i}`, unit));
}

function reindexSkill(id, skill) {
  if (!skill) { removeDoc(`skill:${id}`); return; }
  addDoc("skill", id, `skill:${id}`, `${skill.name || id}. ${skill.description || ""}`);
}

// BM25 search. opts: {tiers:[...], refs:{tier:ref|true}, k, boost:{tier:mult}}.
function search(query, opts = {}) {
  const terms = tokenize(query);
  if (!terms.length || !docs.size) return [];
  const tiers = opts.tiers && opts.tiers.length ? new Set(opts.tiers) : null;
  const refs = opts.refs || null;
  const boost = opts.boost || null;
  const k = opts.k || 6;
  const N = docs.size;
  const avgdl = totalLen / N || 1;

  // Candidates = union of postings for the query's (unique) terms.
  const cand = new Set();
  const qterms = [...new Set(terms)];
  for (const t of qterms) { const set = postings.get(t); if (set) for (const id of set) cand.add(id); }

  const scored = [];
  for (const id of cand) {
    const doc = docs.get(id);
    if (tiers && !tiers.has(doc.tier)) continue;
    // refs constrains a tier only when it names a specific ref; absent or
    // `true` means "any ref in this tier". Callers control which tiers are in
    // play via `tiers` (e.g. include "proj" only when a project is bound).
    if (refs) {
      const want = refs[doc.tier];
      if (want !== undefined && want !== true && String(want) !== doc.ref) continue;
    }
    let score = 0;
    for (const t of qterms) {
      const f = doc.tf.get(t); if (!f) continue;
      const dfreq = df.get(t) || 1;
      const idf = Math.log(1 + (N - dfreq + 0.5) / (dfreq + 0.5));
      score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avgdl));
    }
    if (boost && boost[doc.tier]) score *= boost[doc.tier];
    if (score > 0) scored.push({ id, tier: doc.tier, ref: doc.ref, text: doc.text, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // opts.qvec: the caller already embedded the query — only they can, because
  // it costs a network round trip and this module is synchronous. Rank by
  // meaning too, then fuse the two orders.
  //
  // Fusion cannot WIDEN a search: the semantic side is restricted to ids that
  // pass the same tier and ref filters, so nothing becomes reachable that was
  // not already. It is deliberately not restricted to the word-match set,
  // because those are exactly the documents semantics exist to find.
  if (opts.qvec && semantic && semantic.ready()) {
    const allowed = new Set();
    for (const [id, doc] of docs) {
      if (tiers && !tiers.has(doc.tier)) continue;
      if (refs) {
        const want = refs[doc.tier];
        if (want !== undefined && want !== true && String(want) !== doc.ref) continue;
      }
      allowed.add(id);
    }
    const byMeaning = semantic.rank(opts.qvec, allowed, Math.max(k * 3, 20)).map((r) => r.id);
    if (byMeaning.length) {
      const bm = new Map(scored.map((x) => [x.id, x]));
      const fused = semantic.fuse(scored.map((x) => x.id), byMeaning, k);
      const out = [];
      for (const id of fused) {
        if (bm.has(id)) { out.push(bm.get(id)); continue; }
        const d = docs.get(id);
        // Found by meaning alone: it shares no query term, so its BM25 score
        // really is 0. Saying so beats inventing a number.
        if (d) out.push({ id, tier: d.tier, ref: d.ref, text: d.text, score: 0, viaMeaning: true });
      }
      return out;
    }
  }
  return scored.slice(0, k);
}

// Every indexed document, for whoever needs to walk the whole corpus — today
// that is the semantic tier keeping its vectors in step with this index.
function allDocs() {
  const out = [];
  for (const [id, d] of docs) out.push({ id, tier: d.tier, ref: d.ref, text: d.text });
  return out;
}

function stats() {
  return { ver: VER, docs: docs.size, terms: postings.size, avgdl: docs.size ? totalLen / docs.size : 0 };
}

// ---- persistence (raw docs only; postings rebuilt cheaply on load) ----------
function persist() {
  if (!persistPath) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const out = { ver: VER, built: 0, docs: [...docs.values()].map((d) => ({ id: d.id, tier: d.tier, ref: d.ref, text: d.text })) };
      fs.mkdirSync(path.dirname(persistPath), { recursive: true });
      const tmp = persistPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, persistPath);
    } catch { /* index is rebuildable; persistence is best-effort */ }
  }, PERSIST_DEBOUNCE_MS);
}

function loadPersisted() {
  try {
    const j = JSON.parse(fs.readFileSync(persistPath, "utf8"));
    if (!j || j.ver !== VER || !Array.isArray(j.docs)) return false;
    clear();
    for (const d of j.docs) addDoc(d.tier, d.ref, d.id, d.text);
    return true;
  } catch { return false; }
}

// Build the index from the office's files. Always rebuilds from source (ground
// truth); the persisted copy just speeds the next boot if sources are unchanged.
function init(paths = {}) {
  persistPath = paths.indexFile || null;
  clear();
  // Agent memory: workspace/memory/<agent>.md  → tier "mem", ref = agent id.
  try {
    for (const f of fs.readdirSync(paths.memDir || "")) {
      if (!f.endsWith(".md")) continue;
      reindexFile("mem", f.replace(/\.md$/, ""), path.join(paths.memDir, f));
    }
  } catch { /* no memory dir yet */ }
  // Owner/user knowledge: OFFICE.md → tier "user", ref "OFFICE".
  if (paths.officeMd) reindexFile("user", "OFFICE", paths.officeMd);
  // Project memory: workspace/projects/<id>/MEMORY.md → tier "proj", ref = id.
  try {
    for (const id of fs.readdirSync(paths.projectsDir || "")) {
      const mf = path.join(paths.projectsDir, id, "MEMORY.md");
      if (fs.existsSync(mf)) reindexFile("proj", id, mf);
    }
  } catch { /* no projects dir yet */ }
  // Meeting minutes: workspace/meetings/*.md → tier "arch", ref "meeting".
  try {
    for (const f of fs.readdirSync(paths.meetingsDir || "")) {
      if (!f.endsWith(".md")) continue;
      let t = ""; try { t = fs.readFileSync(path.join(paths.meetingsDir, f), "utf8"); } catch {}
      addDoc("arch", "meeting", `arch:meeting:${f.replace(/\.md$/, "")}`, t.slice(0, 1200));
    }
  } catch { /* none */ }
  // Skills (name + description only; bodies ship natively in P3).
  for (const [id, sk] of Object.entries(paths.skills || {})) reindexSkill(id, sk);
  persist();
  return stats();
}

module.exports = {
  tokenize, unitsFromMarkdown,            // exported for tests
  init, addDoc, removeDoc, removeDocs, reindexFile, reindexSkill,
  search, stats, persist, loadPersisted, clear, allDocs,
};
