// BagIdea Office — work items (v1.4, design F).
//
// One model behind everything the office "has to do": a card the owner writes,
// a delegation the Director hands out, a scheduled job that fires, a meeting's
// action item, a workflow run. Each is a work item:
//
//   { id, title, detail, kind, owner, project, due, priority, status,
//     source: { kind, ref }, dependsOn: [], recurrence, tags, created, updated, done }
//
// status  todo | doing | waiting | done      (waiting = blocked by a dependency,
//                                            or parked by a person)
// kind    task | delegation | job | action | workflow
// owner   an agent id, or "you" (the owner)
// due     ms since epoch (0 = none); recurrence re-creates the card when done
// priority 1 (urgent) … 4 (someday); default 3
//
// Due dates go through the notification rules (kind "reminder"): once when a
// card is due within the hour, once when it is overdue. A card whose blockers
// all close moves waiting → todo by itself and its owner is told.
//
// Zero dependencies. Persisted as one JSON file (workspace/tasks.json).

const fs = require("fs");
const path = require("path");

const STATUSES = ["todo", "doing", "waiting", "done"];
const KINDS = ["task", "delegation", "job", "action", "workflow"];
const EVERY = { day: 86400000, week: 7 * 86400000 };

module.exports = function initTasks(ctx) {
  const FILE = ctx.file;
  const broadcast = ctx.broadcast || (() => {});
  const notify = ctx.notify || (() => {});
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const agentName = ctx.agentName || ((id) => id);
  const REMIND_MS = ctx.remindMs || 60 * 60000;     // "due soon" = within the hour

  let items = [];
  try { items = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!Array.isArray(items)) items = []; }
  catch { items = []; }
  let seq = 0;
  function save() {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); }
    catch (e) { log("[tasks] save: " + e.message); }
  }
  function newId() { const t = now(); let id; do { id = "w" + t.toString(36) + (seq ? seq.toString(36) : ""); seq++; } while (items.some((x) => x.id === id)); return id; }
  function get(id) { return items.find((t) => t.id === id) || null; }

  function toMs(v) {
    if (v == null || v === "" || v === 0) return 0;
    if (typeof v === "number") return v > 0 ? v : 0;
    const s = String(v).trim();
    if (/^\d{4}-\d\d-\d\d$/.test(s)) { const d = new Date(s + "T17:00:00"); return d.getTime() || 0; }   // a bare date = end of the working day
    const t = Date.parse(s); return Number.isFinite(t) ? t : 0;
  }
  function cleanRecurrence(r) {
    if (!r) return null;
    if (typeof r === "string") { const m = /^(?:every\s+)?(\d+)?\s*(day|week|month)s?$/i.exec(r.trim()); if (!m) return null; r = { every: m[2].toLowerCase(), interval: Number(m[1] || 1) }; }
    const every = ["day", "week", "month"].includes(r.every) ? r.every : null;
    if (!every) return null;
    return { every, interval: Math.max(1, Math.min(365, Number(r.interval) || 1)), until: toMs(r.until) || 0 };
  }
  function nextDue(due, rec) {
    const d = new Date(due || now());
    if (rec.every === "month") d.setMonth(d.getMonth() + rec.interval);
    else d.setTime(d.getTime() + EVERY[rec.every] * rec.interval);
    return d.getTime();
  }
  function blocked(t) {
    return (t.dependsOn || []).some((dep) => { const d = get(dep); return d && d.status !== "done"; });
  }

  function create(spec, by) {
    const title = String(spec.title || "").trim().slice(0, 200);
    if (!title) throw new Error("a work item needs a title");
    const t = {
      id: newId(), title,
      detail: String(spec.detail || "").slice(0, 4000),
      kind: KINDS.includes(spec.kind) ? spec.kind : "task",
      owner: String(spec.owner || "you").slice(0, 40),
      project: String(spec.project || "").slice(0, 80),
      due: toMs(spec.due),
      priority: Math.min(4, Math.max(1, Number(spec.priority) || 3)),
      status: "todo",
      source: spec.source && spec.source.kind ? { kind: String(spec.source.kind).slice(0, 30), ref: String(spec.source.ref || "").slice(0, 120) } : null,
      dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.map(String).filter((id) => id && get(id)).slice(0, 20) : [],
      recurrence: cleanRecurrence(spec.recurrence),
      tags: Array.isArray(spec.tags) ? spec.tags.map((x) => String(x).slice(0, 30)).slice(0, 10) : [],
      created: now(), updated: now(), done: 0, by: String(by || "").slice(0, 40),
      reminded: {},
    };
    if (STATUSES.includes(spec.status) && spec.status !== "done") t.status = spec.status;
    if (blocked(t)) { t.status = "waiting"; t.autoWaiting = true; }
    items.push(t); save();
    emit("work.created", t);
    return pub(t);
  }

  function update(id, patch, by) {
    const t = get(id); if (!t) throw new Error("no such work item: " + id);
    const p = patch || {};
    if (p.title !== undefined) { const s = String(p.title).trim().slice(0, 200); if (s) t.title = s; }
    if (p.detail !== undefined) t.detail = String(p.detail || "").slice(0, 4000);
    if (p.owner !== undefined) t.owner = String(p.owner || "you").slice(0, 40);
    if (p.project !== undefined) t.project = String(p.project || "").slice(0, 80);
    if (p.due !== undefined) { t.due = toMs(p.due); t.reminded = {}; }
    if (p.priority !== undefined) t.priority = Math.min(4, Math.max(1, Number(p.priority) || 3));
    if (p.tags !== undefined) t.tags = Array.isArray(p.tags) ? p.tags.map((x) => String(x).slice(0, 30)).slice(0, 10) : [];
    if (p.recurrence !== undefined) t.recurrence = cleanRecurrence(p.recurrence);
    if (p.dependsOn !== undefined) t.dependsOn = Array.isArray(p.dependsOn) ? p.dependsOn.map(String).filter((d) => d !== id && get(d)).slice(0, 20) : [];
    if (p.status !== undefined) return move(id, p.status, by);
    if (t.status === "waiting" && t.autoWaiting && !blocked(t)) { t.status = "todo"; t.autoWaiting = false; }
    else if (t.status !== "done" && t.status !== "waiting" && blocked(t)) { t.status = "waiting"; t.autoWaiting = true; }
    t.updated = now(); save();
    emit("work.updated", t);
    return pub(t);
  }

  function move(id, status, by) {
    const t = get(id); if (!t) throw new Error("no such work item: " + id);
    if (!STATUSES.includes(status)) throw new Error("status must be one of " + STATUSES.join("/"));
    if (status === t.status) return pub(t);
    const was = t.status;
    t.status = status; t.updated = now(); t.autoWaiting = false;
    if (status === "done") {
      t.done = now();
      // A repeating card comes back as a fresh one, due the next period.
      if (t.recurrence && (!t.recurrence.until || nextDue(t.due, t.recurrence) <= t.recurrence.until)) {
        const next = { ...t, id: newId(), status: "todo", done: 0, created: now(), updated: now(), reminded: {},
          due: nextDue(t.due, t.recurrence), dependsOn: [] };
        items.push(next);
        emit("work.created", next);
      }
      // Its dependents may be free now.
      for (const d of items) {
        if (d.status === "waiting" && d.autoWaiting && (d.dependsOn || []).includes(id) && !blocked(d)) {
          d.status = "todo"; d.autoWaiting = false; d.updated = now();
          emit("work.updated", d);
          notify({ kind: "reminder", title: "🔓 Unblocked: " + d.title,
            body: `"${t.title}" is done — ${ownerLabel(d)} can start`, agent: d.owner !== "you" ? d.owner : undefined, link: "task:" + d.id });
        }
      }
    } else if (was === "done") t.done = 0;
    save();
    emit(status === "done" ? "work.done" : "work.updated", t, { from: was, by });
    return pub(t);
  }

  function remove(id) {
    const t = get(id); if (!t) return false;
    items = items.filter((x) => x.id !== id);
    for (const d of items) if ((d.dependsOn || []).includes(id)) d.dependsOn = d.dependsOn.filter((x) => x !== id);
    save();
    emit("work.removed", t);
    return true;
  }

  function ownerLabel(t) { return t.owner === "you" ? "you" : agentName(t.owner); }
  function pub(t) {
    const { reminded, autoWaiting, ...rest } = t;
    return { ...rest, blocked: t.status !== "done" && blocked(t), overdue: !!(t.due && t.status !== "done" && t.due < now()) };
  }
  function emit(type, t, extra) {
    broadcast({ type, item: pub(t), ...(extra || {}) }, false);
    broadcast({ type: "tasks.changed", id: t.id }, false);
  }

  const order = (a, b) => (a.priority - b.priority) || ((a.due || Infinity) - (b.due || Infinity)) || (a.created - b.created);
  function list(f = {}) {
    let out = items.slice();
    if (f.status) out = out.filter((t) => t.status === f.status);
    if (f.owner) out = out.filter((t) => t.owner === f.owner);
    if (f.project) out = out.filter((t) => t.project === f.project);
    if (f.kind) out = out.filter((t) => t.kind === f.kind);
    if (f.open) out = out.filter((t) => t.status !== "done");
    if (f.source) out = out.filter((t) => t.source && t.source.kind === f.source);
    out.sort(order);
    if (f.limit) out = out.slice(0, Number(f.limit));
    return out.map(pub);
  }
  function board() {
    const b = { todo: [], doing: [], waiting: [], done: [] };
    for (const t of items.slice().sort(order)) b[t.status].push(pub(t));
    b.done = b.done.sort((a, c) => c.done - a.done).slice(0, 60);   // the board shows recent finishes only
    return b;
  }
  function bySource(kind, ref) { const t = items.find((x) => x.source && x.source.kind === kind && x.source.ref === ref); return t ? pub(t) : null; }
  function summary() {
    const open = items.filter((t) => t.status !== "done");
    return { open: open.length, doing: open.filter((t) => t.status === "doing").length, waiting: open.filter((t) => t.status === "waiting").length,
             overdue: open.filter((t) => t.due && t.due < now()).length, dueToday: open.filter((t) => t.due && new Date(t.due).toDateString() === new Date(now()).toDateString()).length,
             doneToday: items.filter((t) => t.done && new Date(t.done).toDateString() === new Date(now()).toDateString()).length };
  }

  // Due-date reminders through the rules: "due soon" once, "overdue" once.
  function tick(at) {
    const t0 = at || now(); let sent = 0, changed = false;
    for (const t of items) {
      if (!t.due || t.status === "done") continue;
      t.reminded = t.reminded || {};
      if (!t.reminded.soon && t.due - t0 <= REMIND_MS && t.due > t0) {
        t.reminded.soon = t0; changed = true; sent++;
        notify({ kind: "reminder", title: "⏰ Due soon: " + t.title, body: `${ownerLabel(t)} · due ${new Date(t.due).toLocaleString()}`, agent: t.owner !== "you" ? t.owner : undefined, link: "task:" + t.id });
      } else if (!t.reminded.overdue && t.due < t0) {
        t.reminded.overdue = t0; changed = true; sent++;
        notify({ kind: "reminder", title: "🔴 Overdue: " + t.title, body: `${ownerLabel(t)} · was due ${new Date(t.due).toLocaleString()}`, agent: t.owner !== "you" ? t.owner : undefined, link: "task:" + t.id });
      }
    }
    if (changed) save();
    return sent;
  }

  // What every agent is told, so it uses the API instead of prose.
  function agentNote(agentId) {
    const mine = items.filter((t) => t.owner === agentId && t.status !== "done").sort(order).slice(0, 8);
    const lines = mine.map((t) => `  - [${t.id}] ${t.status}${t.due ? " · due " + new Date(t.due).toISOString().slice(0, 10) : ""} · P${t.priority} — ${t.title}`);
    return `
<office-tasks>
The office keeps a task board (📋 TASKS). Use it instead of describing work in prose — the owner sees the board, and cards move as you work.
${mine.length ? `Your open cards:\n${lines.join("\n")}\n` : "You have no open cards.\n"}API (via Bash; JSON body):
  create:  curl -s -X POST http://127.0.0.1:8787/tasks -H "content-type: application/json" -d '{"title":"…","owner":"${agentId}","due":"2026-01-31","priority":2,"project":"<name>","dependsOn":["<id>"]}'
  move:    curl -s -X POST http://127.0.0.1:8787/tasks/move -H "content-type: application/json" -d '{"id":"<id>","status":"doing|done|waiting|todo"}'
  edit:    curl -s -X POST http://127.0.0.1:8787/tasks/update -H "content-type: application/json" -d '{"id":"<id>","detail":"…","due":"…"}'
  list:    curl -s "http://127.0.0.1:8787/tasks?owner=${agentId}&open=1"
Calendar: curl -s -X POST http://127.0.0.1:8787/calendar -H "content-type: application/json" -d '{"title":"…","at":"2026-01-31T10:00","remindMin":30,"recurrence":{"freq":"weekly","byDay":["MO"]},"agent":"${agentId}"}' books an event (the owner is reminded through their rules).
When you start a card, move it to doing; when you finish, move it to done. Non-ASCII text: write the JSON to a file and send it with --data-binary @file.
</office-tasks>`;
  }

  return { create, update, move, remove, get: (id) => { const t = get(id); return t ? pub(t) : null; }, list, board, bySource, summary, tick, agentNote,
           STATUSES, KINDS, _toMs: toMs };
};
