"use strict";
// 🛠 DEV MODE: per-thread tool-call details, kept so a tool row in the chat can
// show what it ran at any later time — after the pane is re-drawn from
// history, after a thread switch, a reload or an office restart — not only
// while the live task.progress frame is on screen.
//
// One append-only JSONL file per (bucket, thread key) under <dir>. Each line is
// { id, ts, kind, label, detail } where kind/label/detail come from
// devmode.toolDetail: already redacted and capped (label ≤ 60, detail ≤ 2000
// chars). Raw tool input is never written. The thread history in
// sessions.json keeps only the tool name plus the call id; /sessions/log joins
// the detail back in by id. Every operation fails open: a disk error must never
// break an agent run or a history read.
// CommonJS, zero dependencies.

const fs = require("fs");
const path = require("path");

const MAX_FILE_BYTES = 1024 * 1024;   // compact a thread's file once it passes 1 MiB
const MAX_ID = 40;

// Buckets ("@sub", "@group") and thread keys become file-system-safe names that
// cannot collide, even on case-insensitive disks (NTFS, APFS): every character
// outside [a-z0-9_-] — upper-case letters included — is hex-escaped, and the
// "x" prefix keeps Windows reserved names (CON, NUL…) and leading dots out.
function safeName(s) {
  return "x" + String(s).replace(/[^a-z0-9_-]/g, (c) => "~" + c.charCodeAt(0).toString(16) + "~");
}
function validId(id) { return typeof id === "string" && id.length > 0 && id.length <= MAX_ID && /^[A-Za-z0-9_-]+$/.test(id); }
// A line torn by a crash can have the next record glued onto it; recover that one.
function parseLine(line) {
  try { return JSON.parse(line); } catch {}
  const at = line.lastIndexOf('{"id":');
  if (at > 0) { try { return JSON.parse(line.slice(at)); } catch {} }
  return null;
}

module.exports = function createToolDetails({ dir, io = fs, now = Date.now, maxFileBytes = MAX_FILE_BYTES } = {}) {
  if (!dir) throw new Error("tooldetail: dir is required");
  let seq = 0;
  const made = new Set();        // folders known to exist
  const dirty = new Set();       // files whose last append may have left a torn tail
  const compactedAt = new Map(); // file → size right after its last compaction
  const gone = new Set();        // threads deleted while a run may still hold them
  const fileOf = (bucket, key) => path.join(dir, safeName(bucket), safeName(key) + ".jsonl");
  const threadId = (bucket, key) => String(bucket) + "\0" + String(key);

  // Unique per call: time-prefixed, so ids from different daemon runs never meet.
  function newId() { return now().toString(36) + "-" + (++seq).toString(36); }

  function read(bucket, key) {
    const out = new Map();
    let text;
    try { text = io.readFileSync(fileOf(bucket, key), "utf8"); } catch { return out; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const r = parseLine(line);
      if (r && validId(r.id)) out.set(r.id, r);
    }
    return out;
  }

  // Rewrite a thread's file keeping only calls still present in its history
  // (entry.log is capped at 200 rows, so older calls have scrolled out).
  // Returns true when the file changed.
  function compact(bucket, entry) {
    const file = fileOf(bucket, entry.key);
    try {
      const keep = new Set((entry.log || []).filter((m) => m && m.who === "tool" && m.id).map((m) => m.id));
      const all = read(bucket, entry.key);
      const kept = [...all.values()].filter((r) => keep.has(r.id));
      const body = kept.map((r) => JSON.stringify(r) + "\n").join("");
      if (kept.length === all.size && io.statSync(file).size === Buffer.byteLength(body)) {
        compactedAt.set(file, Buffer.byteLength(body));
        return false;   // already clean: nothing dropped, no torn or duplicate lines
      }
      if (!kept.length) { io.unlinkSync(file); compactedAt.delete(file); dirty.delete(file); return true; }
      const tmp = file + ".tmp";
      io.writeFileSync(tmp, body);
      io.renameSync(tmp, file);
      compactedAt.set(file, Buffer.byteLength(body));
      dirty.delete(file);
      return true;
    } catch {
      // e.g. EPERM while another program holds the file open: wait until it has
      // doubled again instead of re-reading and rewriting it on every call.
      try { compactedAt.set(file, io.statSync(file).size); } catch {}
      try { io.unlinkSync(file + ".tmp"); } catch {}
      return false;
    }
  }

  // d = devmode.toolDetail(name, input): { kind, label, detail }, already redacted.
  function record(bucket, entry, id, d) {
    if (!entry || !entry.key || !validId(id) || gone.has(threadId(bucket, entry.key))) return false;
    const file = fileOf(bucket, entry.key), folder = path.dirname(file);
    const r = { id, ts: now(), kind: String((d && d.kind) || ""), label: String((d && d.label) || ""), detail: String((d && d.detail) || "") };
    const append = () => {
      if (!made.has(folder)) { io.mkdirSync(folder, { recursive: true }); made.add(folder); }
      // after a failed append, start on a fresh line so a torn tail cannot swallow this record
      io.appendFileSync(file, (dirty.has(file) ? "\n" : "") + JSON.stringify(r) + "\n");
      dirty.delete(file);
    };
    try {
      try { append(); }
      catch (e) {
        if (!e || e.code !== "ENOENT") { dirty.add(file); throw e; }
        made.delete(folder);   // the store folder was removed while the office ran: recreate it once
        append();
      }
      // Compact past the cap, then again only once the file has doubled, so a thread
      // whose kept details alone exceed the cap is not rewritten on every call.
      const size = io.statSync(file).size;
      if (size > Math.max(maxFileBytes, 2 * (compactedAt.get(file) || 0))) compact(bucket, entry);
      return true;
    } catch { return false; }
  }

  function get(bucket, key, id) {
    if (!validId(id)) return null;
    return read(bucket, key).get(id) || null;
  }

  // History rows with their details merged in. `captured` tells the overlay a
  // detail record exists even when the tool ran with an empty input.
  function join(bucket, entry) {
    const log = (entry && entry.log) || [];
    if (!log.some((m) => m && m.who === "tool" && m.id)) return log;
    const details = read(bucket, entry.key);
    return log.map((m) => {
      if (!m || m.who !== "tool" || !m.id) return m;
      const d = details.get(m.id);
      return d ? { ...m, kind: d.kind, label: d.label, detail: d.detail, captured: true } : m;
    });
  }

  // A deleted thread stays deleted: a run still holding its entry cannot bring
  // the file back.
  function remove(bucket, key) {
    gone.add(threadId(bucket, key));
    const file = fileOf(bucket, key);
    compactedAt.delete(file); dirty.delete(file);
    try { io.unlinkSync(file); return true; } catch { return false; }
  }

  // Boot housekeeping: drop files of threads that no longer exist (pruned or
  // deleted) and compact the rest. Only the daemon that owns the office may
  // call this, with a sessions map it actually loaded.
  // Drop files that belong to no thread in `sess`. Two things keep this safe
  // next to ANOTHER daemon booted from the same folder (a test office on a
  // second port shares this store and sessions.json): a file younger than
  // minAgeMs (default 24 h) is never touched, because that other daemon may
  // have created its thread after this process read sessions.json — and the
  // sweep never compacts, because compaction runs on the write path when a
  // file doubles, and a rewrite here could race the other daemon's append.
  function sweep(sess, opts = {}) {
    const minAge = opts.minAgeMs === undefined ? 24 * 3600 * 1000 : Number(opts.minAgeMs) || 0;
    const valid = new Map();
    for (const [bucket, list] of Object.entries(sess || {})) {
      for (const e of Array.isArray(list) ? list : []) if (e && e.key) valid.set(fileOf(bucket, e.key), [bucket, e]);
    }
    let removed = 0, compacted = 0, folders;
    try { folders = io.readdirSync(dir, { withFileTypes: true }); } catch { return { removed, compacted }; }
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      let files;
      try { files = io.readdirSync(path.join(dir, folder.name)); } catch { continue; }
      for (const name of files) {
        const file = path.join(dir, folder.name, name);
        if (valid.has(file)) continue;
        // (minAge 0 = no gate at all: an mtime can sit a fraction of a ms
        // AHEAD of Date.now() on NTFS, so `age < 0` must not count as young.)
        try { if (minAge > 0 && now() - io.statSync(file).mtimeMs < minAge) continue; io.unlinkSync(file); removed++; } catch {}
      }
    }
    return { removed, compacted };
  }

  return { newId, record, read, get, join, compact, remove, sweep, fileOf };
};

module.exports.safeName = safeName;
module.exports.validId = validId;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
