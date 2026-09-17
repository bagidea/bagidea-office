// BagIdea Office — the approvals inbox.
//
// One queue for everything that waits on a person. Before this, five separate
// things asked for a human in five separate places — tool permissions (the
// Security Center), a project's own hooks (trust), team pitches (proposals),
// an AUTO agent's STATUS: BLOCKED, and jobs left switched off — with no shared
// list, no shared history, and no API. A plugin author who wanted "queue this
// and wait for my sign-off" ended up building an approval queue out of disabled
// jobs (issues #48 / #50). This is the primitive they were reaching for.
//
// The queue is an INDEX plus the round-trip. Each kind's real resolver stays
// where it is (finishPerm, resolveTrust, the proposal verdict…); server.js
// registers a handler per kind and respond() dispatches to it. So an existing
// route like POST /perm/respond keeps working unchanged — it just goes through
// here on its way.
//
// Records persist. A pending item survives a daemon restart as a record (so the
// panel and the phone still show it); whatever was waiting on it in memory does
// not, and re-asks — for a tool permission that is the hook re-polling.
//
// Zero dependencies.

const fs = require("fs");

const KINDS = new Set([
  "tool-permission",   // an agent wants a tool it wasn't granted
  "project-trust",     // a registered folder ships its own .claude hooks
  "proposal",          // the team pitched a project
  "blocked",           // an AUTO agent hit STATUS: BLOCKED
  "job",               // a job was created disabled and waits to be enabled
  "workflow",          // a workflow's approval node (v1.3)
  "plugin",            // a plugin asked (ctx.approvals.ask)
]);

// What each kind's buttons say. `value` is what respond() receives; the labels
// are the ALL-CAPS-free short forms a phone keyboard can show.
const DEFAULT_OPTIONS = {
  "tool-permission": [{ value: "allow", label: "Allow" }, { value: "always", label: "Always" }, { value: "deny", label: "Deny" }],
  "project-trust":   [{ value: "allow", label: "Trust" }, { value: "deny", label: "Deny" }],
  "proposal":        [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }],
  "blocked":         [{ value: "continue", label: "Continue" }, { value: "stop", label: "Stop" }],
  "job":             [{ value: "enable", label: "Run it" }, { value: "delete", label: "Delete" }],
  "workflow":        [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }],
  "plugin":          [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }],
};

const MAX_HISTORY = 400;

module.exports = function initApprovals(ctx) {
  const FILE = ctx.file;
  const broadcast = ctx.broadcast || (() => {});
  const notify = ctx.notify || (() => {});
  const log = ctx.log || (() => {});

  let items = [];               // newest last; pending + decided history
  const handlers = {};          // kind -> (item, decision, meta) => void|Promise
  const waiters = new Map();    // id -> resolve(decision) for ask() callers in THIS process
  const timers = new Map();     // id -> expiry timer

  function load() {
    try { items = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { items = []; }
    if (!Array.isArray(items)) items = [];
  }
  function save() {
    // Keep the file bounded: all pending, plus the most recent decided ones.
    const pending = items.filter((i) => !i.decided);
    const done = items.filter((i) => i.decided).slice(-MAX_HISTORY);
    items = [...done, ...pending].sort((a, b) => a.created - b.created);
    try { fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); } catch (e) { log("[approvals] save " + e.message); }
  }
  load();

  let seq = 0;
  function newId() {
    // Readable, sortable, and never reused within a millisecond (see #50).
    const now = Date.now();
    let id;
    do { id = "a" + now + (seq ? "-" + seq : ""); seq++; } while (items.some((i) => i.id === id));
    return id;
  }

  // The short number people type from a phone: 1 = the oldest pending item.
  function pendingList() { return items.filter((i) => !i.decided); }
  function byIndex(n) { return pendingList()[n - 1] || null; }
  function indexOf(id) { return pendingList().findIndex((i) => i.id === id) + 1; }

  function publicItem(i) {
    return { ...i, n: i.decided ? 0 : indexOf(i.id) };
  }

  // Register how a kind is resolved. server.js calls this once per kind.
  function on(kind, fn) { handlers[kind] = fn; }

  // Ask. Returns { id, item, promise } — the promise resolves with the decision
  // string (or "expired"). Callers that already have their own resolver (perm,
  // trust) can ignore the promise and rely on the handler instead.
  function ask(spec) {
    const kind = KINDS.has(spec.kind) ? spec.kind : "plugin";
    const item = {
      id: spec.id || newId(),
      kind,
      agent: spec.agent || "",
      title: String(spec.title || "").slice(0, 200),
      detail: String(spec.detail || "").slice(0, 4000),
      options: Array.isArray(spec.options) && spec.options.length
        ? spec.options.map((o) => typeof o === "string" ? { value: o, label: o } : o)
        : DEFAULT_OPTIONS[kind],
      meta: spec.meta || {},           // whatever the kind's resolver needs back
      ref: spec.ref || null,           // the kind's own id (perm id, proposal id…)
      created: Date.now(),
      expires: spec.expiresMs ? Date.now() + spec.expiresMs : 0,
      decided: 0, decision: "", by: "", note: "",
    };
    // A re-ask for the same ref (the perm hook re-polling after a restart, say)
    // replaces the stale pending record instead of stacking a twin.
    if (item.ref) items = items.filter((i) => !(i.ref === item.ref && i.kind === item.kind && !i.decided));
    items.push(item);
    save();
    const promise = new Promise((resolve) => waiters.set(item.id, resolve));
    if (item.expires) {
      // NOT unref-d: a pending approval that someone is awaiting must keep a bare
      // process alive until it is decided. With unref, node's test runner exited the
      // file mid-await ("Promise resolution is still pending but the event loop has
      // already resolved") and cancelled every test after it. The daemon's lifetime
      // is owned by its HTTP server, so this timer never delays a shutdown there.
      const t = setTimeout(() => respond(item.id, "expired", { by: "timeout" }), item.expires - Date.now());
      timers.set(item.id, t);
    }
    broadcast({ type: "approval.requested", ...publicItem(item) }, false);
    notify({
      kind: "approval", id: item.id, agent: item.agent,
      title: item.title,
      body: item.detail.slice(0, 300),
      link: "approval:" + item.id,
      options: item.options,
    });
    return { id: item.id, item, promise };
  }

  // Decide. `decision` is one of the item's option values, or "expired".
  // Returns false for an unknown or already-decided id.
  async function respond(id, decision, meta = {}) {
    const item = items.find((i) => i.id === id);
    if (!item || item.decided) return false;
    const valid = decision === "expired" || item.options.some((o) => o.value === decision);
    if (!valid) return false;
    item.decided = Date.now();
    item.decision = decision;
    item.by = String(meta.by || "owner").slice(0, 40);
    item.note = String(meta.note || "").slice(0, 600);
    save();
    const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id); }
    const w = waiters.get(id); if (w) { waiters.delete(id); try { w(decision); } catch {} }
    const h = handlers[item.kind];
    if (h) { try { await h(item, decision, item); } catch (e) { log("[approvals] " + item.kind + " handler: " + (e && e.message)); } }
    broadcast({ type: "approval.decided", id, kind: item.kind, decision, by: item.by, note: item.note, ref: item.ref }, false);
    return true;
  }

  // Parse a reply typed on a phone. Accepts:
  //   /approve 2       /deny 2 too risky      /ok 2      /no 2
  //   2 yes            2 no                   yes 2      ✓ 2
  //   /approve a1789…  (a full id)            2 continue (any option value)
  // Returns { id, decision, note } or null. Never guesses: with one pending
  // item, a bare "yes" is accepted; with more than one, a number is required.
  function parseReply(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    const pend = pendingList();
    if (!pend.length) return null;
    const YES = /^(yes|y|ok|okay|approve|allow|accept|continue|run|✓|✔|👍|ใช่|อนุมัติ|ตกลง|อนุญาต)$/i;
    const NO = /^(no|n|deny|reject|stop|cancel|✗|✘|👎|ไม่|ปฏิเสธ|ยกเลิก|หยุด)$/i;
    let m = t.match(/^\/?(approve|allow|ok|yes|deny|reject|no|stop|continue|enable|run|delete|always)\s+(\S+)\s*(.*)$/i)
         || t.match(/^(\S+)\s+(approve|allow|ok|yes|deny|reject|no|stop|continue|enable|run|delete|always)\s*(.*)$/i)
         || null;
    let word, target, note;
    if (m) {
      if (/^\/?(approve|allow|ok|yes|deny|reject|no|stop|continue|enable|run|delete|always)$/i.test(m[1])) { word = m[1].replace(/^\//, ""); target = m[2]; note = m[3]; }
      else { target = m[1]; word = m[2]; note = m[3]; }
    } else if (YES.test(t) || NO.test(t)) {
      if (pend.length !== 1) return null;
      word = YES.test(t) ? "yes" : "no"; target = "1"; note = "";
    } else return null;
    const item = /^\d+$/.test(target) ? byIndex(Number(target)) : pend.find((i) => i.id === target) || null;
    if (!item) return null;
    // Map the word onto this item's own options: positive words → the first
    // option, negative → the last, an exact option value → itself.
    const w = word.toLowerCase();
    let decision = null;
    if (item.options.some((o) => o.value === w)) decision = w;
    else if (YES.test(w) || w === "allow" || w === "approve" || w === "ok") decision = item.options[0].value;
    else if (NO.test(w) || w === "deny" || w === "reject" || w === "stop" || w === "delete") decision = item.options[item.options.length - 1].value;
    if (!decision) return null;
    return { id: item.id, decision, note: String(note || "").trim().slice(0, 600) };
  }

  // A phone-friendly rendering of the pending list.
  function summary() {
    const pend = pendingList();
    if (!pend.length) return "✅ Nothing is waiting for you.";
    return ["📥 Waiting for you:"].concat(pend.map((i, n) =>
      `${n + 1}. [${i.kind}] ${i.title}${i.agent ? " — " + i.agent : ""}\n   ` +
      i.options.map((o) => o.label).join(" / ") + `  →  reply "${n + 1} ${i.options[0].value}"`)).join("\n");
  }

  // Housekeeping: sweep expired items whose timers died with a previous process.
  function sweep() {
    const now = Date.now();
    for (const i of pendingList()) if (i.expires && i.expires < now) respond(i.id, "expired", { by: "timeout" });
  }
  sweep();

  return {
    KINDS, ask, respond, on, parseReply, summary,
    list: (o = {}) => (o.pending ? pendingList() : items).map(publicItem),
    get: (id) => { const i = items.find((x) => x.id === id); return i ? publicItem(i) : null; },
    pendingCount: () => pendingList().length,
    // A lookup the phone round-trip needs: which pending item carries this ref?
    byRef: (kind, ref) => items.find((i) => i.kind === kind && i.ref === ref && !i.decided) || null,
  };
};
