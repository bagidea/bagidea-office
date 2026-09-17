// BagIdea Office — calendar (v1.4, design F).
//
// The office calendar used to be a flat list of { title, at, remindMin }. It now
// holds real events:
//
//   { id, title, at, end, allDay, remindMin, recurrence, link, agent, notes,
//     uid, notifiedAt, created }
//
// recurrence  { freq: daily|weekly|monthly|yearly, interval, byDay: ["MO","WE"],
//               count, until }   — the RRULE subset a real calendar exports
// link        { task, project }  — what the event is about
// agent       who booked it / who should be reminded (optional)
//
// occurrences(from, to) expands recurrence; tick() reminds per OCCURRENCE (a
// weekly meeting reminds every week, not once). ICS import/export lets the
// office calendar live next to a real one.
//
// Zero dependencies. The on-disk file is the same calendar.json as before —
// old rows load unchanged.

const fs = require("fs");
const path = require("path");

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQS = ["daily", "weekly", "monthly", "yearly"];

module.exports = function initCalendar(ctx) {
  const FILE = ctx.file;
  const broadcast = ctx.broadcast || (() => {});
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const remind = ctx.remind || (() => {});        // (event, occurrence) => void

  let cal = [];
  try { cal = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!Array.isArray(cal)) cal = []; } catch { cal = []; }
  let seq = 0;
  function save() {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cal, null, 2)); }
    catch (e) { log("[calendar] save: " + e.message); }
  }
  function newId() { const t = now(); let id; do { id = "c" + t + (seq ? "-" + seq : ""); seq++; } while (cal.some((c) => c.id === id)); return id; }
  function get(id) { return cal.find((c) => c.id === id) || null; }

  function toMs(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v > 0 ? v : 0;
    const t = Date.parse(String(v)); return Number.isFinite(t) ? t : 0;
  }
  function cleanRecurrence(r) {
    if (!r) return null;
    if (typeof r === "string") r = parseRRule(r);
    if (!r || !FREQS.includes(String(r.freq || "").toLowerCase())) return null;
    const o = { freq: String(r.freq).toLowerCase(), interval: Math.max(1, Math.min(366, Number(r.interval) || 1)) };
    if (Array.isArray(r.byDay)) { const d = r.byDay.map((x) => String(x).toUpperCase().slice(0, 2)).filter((x) => DAYS.includes(x)); if (d.length) o.byDay = d; }
    if (r.count) o.count = Math.max(1, Math.min(1000, Number(r.count) || 0));
    if (r.until) o.until = toMs(r.until) || 0;
    return o;
  }
  function pub(c) { return { ...c }; }

  function add(spec) {
    const title = String(spec.title || "").trim().slice(0, 120);
    const at = toMs(spec.at);
    if (!title || !at) throw new Error("need title + at");
    const c = {
      id: newId(), title, at,
      end: toMs(spec.end) || 0,
      allDay: !!spec.allDay,
      remindMin: Math.max(0, Number(spec.remindMin ?? 10) || 0),
      recurrence: cleanRecurrence(spec.recurrence),
      link: spec.link && typeof spec.link === "object" ? { task: String(spec.link.task || ""), project: String(spec.link.project || "") } : null,
      agent: String(spec.agent || "").slice(0, 40),
      notes: String(spec.notes || "").slice(0, 2000),
      uid: String(spec.uid || "").slice(0, 200) || "",
      notified: false, notifiedAt: 0, created: now(),
    };
    if (c.allDay) { const d = new Date(c.at); d.setHours(0, 0, 0, 0); c.at = d.getTime(); if (!c.end) c.end = c.at + 86400000; }
    if (c.end && c.end < c.at) c.end = c.at;
    cal.push(c); save();
    broadcast({ type: "calendar.changed", id: c.id }, false);
    return pub(c);
  }
  function edit(id, p) {
    const c = get(id); if (!c) throw new Error("not found");
    if (p.title !== undefined) { const s = String(p.title).trim().slice(0, 120); if (s) c.title = s; }
    if (p.at !== undefined) { const at = toMs(p.at); if (at) { c.at = at; c.notified = false; c.notifiedAt = 0; } }
    if (p.end !== undefined) c.end = toMs(p.end) || 0;
    if (p.allDay !== undefined) c.allDay = !!p.allDay;
    if (p.remindMin !== undefined) c.remindMin = Math.max(0, Number(p.remindMin) || 0);
    if (p.recurrence !== undefined) c.recurrence = cleanRecurrence(p.recurrence);
    if (p.link !== undefined) c.link = p.link && typeof p.link === "object" ? { task: String(p.link.task || ""), project: String(p.link.project || "") } : null;
    if (p.agent !== undefined) c.agent = String(p.agent || "").slice(0, 40);
    if (p.notes !== undefined) c.notes = String(p.notes || "").slice(0, 2000);
    if (c.allDay) { const d = new Date(c.at); d.setHours(0, 0, 0, 0); c.at = d.getTime(); if (!c.end) c.end = c.at + 86400000; }
    if (c.end && c.end < c.at) c.end = c.at;
    save();
    broadcast({ type: "calendar.changed", id: c.id }, false);
    return pub(c);
  }
  function remove(id) { const n = cal.length; cal = cal.filter((c) => c.id !== id); if (cal.length !== n) { save(); broadcast({ type: "calendar.changed", id }, false); } return cal.length !== n; }
  function list() { return cal.slice().sort((a, b) => a.at - b.at).map(pub); }

  // ---- recurrence -------------------------------------------------------------
  function* iterate(c, limit = 1000) {
    const r = c.recurrence;
    if (!r) { yield c.at; return; }
    let n = 0;
    const base = new Date(c.at);
    if (r.freq === "weekly" && r.byDay && r.byDay.length) {
      // Week by week from the event's own week; each listed weekday in it.
      const start = new Date(c.at); start.setDate(start.getDate() - start.getDay());
      for (let w = 0; n < limit; w += r.interval) {
        for (const d of DAYS.map((x, i) => (r.byDay.includes(x) ? i : -1)).filter((i) => i >= 0)) {
          const t = new Date(start); t.setDate(start.getDate() + w * 7 + d);
          t.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0);
          if (t.getTime() < c.at) continue;
          if (r.until && t.getTime() > r.until) return;
          if (r.count && n >= r.count) return;
          n++; yield t.getTime();
        }
      }
      return;
    }
    for (let i = 0; n < limit; i += r.interval) {
      const t = new Date(base);
      if (r.freq === "daily") t.setDate(base.getDate() + i);
      else if (r.freq === "weekly") t.setDate(base.getDate() + i * 7);
      else if (r.freq === "monthly") t.setMonth(base.getMonth() + i);
      else t.setFullYear(base.getFullYear() + i);
      if (r.until && t.getTime() > r.until) return;
      if (r.count && n >= r.count) return;
      n++; yield t.getTime();
    }
  }
  function occurrences(from, to, opts = {}) {
    const f = toMs(from) || now(), t = toMs(to) || f + 30 * 86400000;
    const limit = opts.limit || 500;
    const out = [];
    for (const c of cal) {
      const len = c.end ? c.end - c.at : 0;
      for (const at of iterate(c, 2000)) {
        if (at > t) break;
        if (at + len < f) continue;
        out.push({ eventId: c.id, title: c.title, at, end: len ? at + len : 0, allDay: !!c.allDay, remindMin: c.remindMin, recurring: !!c.recurrence, link: c.link, agent: c.agent });
        if (out.length >= limit) break;
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }
  function nextOccurrence(c, after) {
    for (const at of iterate(c, 2000)) if (at >= after) return at;
    return 0;
  }

  // Remind per occurrence: once, when the reminder window opens; never for an
  // occurrence more than 5 minutes gone.
  function tick(at) {
    const t0 = at || now(); let sent = 0;
    for (const c of cal) {
      const occ = nextOccurrence(c, t0 - 300000);
      if (!occ) continue;
      const remindAt = occ - (c.remindMin || 0) * 60000;
      if (t0 >= remindAt && t0 < occ + 300000 && c.notifiedAt !== occ) {
        c.notifiedAt = occ; c.notified = true; save(); sent++;
        try { remind(pub(c), { at: occ, minutes: Math.max(0, Math.round((occ - t0) / 60000)) }); } catch (e) { log("[calendar] remind: " + e.message); }
      }
    }
    return sent;
  }

  // ---- ICS --------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  function icsDate(ms, allDay) {
    const d = new Date(ms);
    if (allDay) return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }
  function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function rrule(r) {
    if (!r) return "";
    let s = "FREQ=" + r.freq.toUpperCase();
    if (r.interval > 1) s += ";INTERVAL=" + r.interval;
    if (r.byDay) s += ";BYDAY=" + r.byDay.join(",");
    if (r.count) s += ";COUNT=" + r.count;
    if (r.until) s += ";UNTIL=" + icsDate(r.until, false);
    return s;
  }
  function toICS() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BagIdea Office//calendar//EN", "CALSCALE:GREGORIAN"];
    for (const c of cal) {
      lines.push("BEGIN:VEVENT", "UID:" + (c.uid || c.id + "@bagidea-office"), "DTSTAMP:" + icsDate(c.created || now()),
        (c.allDay ? "DTSTART;VALUE=DATE:" : "DTSTART:") + icsDate(c.at, c.allDay));
      if (c.end) lines.push((c.allDay ? "DTEND;VALUE=DATE:" : "DTEND:") + icsDate(c.end, c.allDay));
      lines.push("SUMMARY:" + icsText(c.title));
      if (c.notes) lines.push("DESCRIPTION:" + icsText(c.notes));
      if (c.recurrence) lines.push("RRULE:" + rrule(c.recurrence));
      if (c.remindMin) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText(c.title), "TRIGGER:-PT" + c.remindMin + "M", "END:VALARM");
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map((l) => fold(l)).join("\r\n") + "\r\n";
  }
  function fold(l) { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); }

  function parseRRule(s) {
    const o = {};
    for (const part of String(s).split(";")) {
      const [k, v] = part.split("="); if (!k || v == null) continue;
      const K = k.trim().toUpperCase();
      if (K === "FREQ") o.freq = v.toLowerCase();
      else if (K === "INTERVAL") o.interval = Number(v);
      else if (K === "BYDAY") o.byDay = v.split(",").map((x) => x.replace(/^[-+]?\d+/, ""));
      else if (K === "COUNT") o.count = Number(v);
      else if (K === "UNTIL") o.until = parseIcsDate(v).ms;
    }
    return o.freq ? o : null;
  }
  function parseIcsDate(v) {
    const s = String(v).trim();
    let m;
    if ((m = /^(\d{4})(\d\d)(\d\d)$/.exec(s))) return { ms: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
    if ((m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)?(Z)?$/.exec(s))) {
      const ms = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
      return { ms, allDay: false };
    }
    return { ms: 0, allDay: false };
  }
  function unescapeText(s) { return String(s).replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }
  function importICS(text) {
    const raw = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    let ev = null, alarm = false; const events = [];
    for (const line of raw) {
      if (line === "BEGIN:VEVENT") { ev = { remindMin: 0 }; continue; }
      if (line === "END:VEVENT") { if (ev) events.push(ev); ev = null; continue; }
      if (!ev) continue;
      if (line === "BEGIN:VALARM") { alarm = true; continue; }
      if (line === "END:VALARM") { alarm = false; continue; }
      const i = line.indexOf(":"); if (i < 0) continue;
      const head = line.slice(0, i), val = line.slice(i + 1);
      const name = head.split(";")[0].toUpperCase();
      if (alarm) { const m = /^-?PT(?:(\d+)H)?(?:(\d+)M)?/.exec(val); if (name === "TRIGGER" && m) ev.remindMin = (+(m[1] || 0)) * 60 + (+(m[2] || 0)); continue; }
      if (name === "UID") ev.uid = val;
      else if (name === "SUMMARY") ev.title = unescapeText(val);
      else if (name === "DESCRIPTION") ev.notes = unescapeText(val);
      else if (name === "DTSTART") { const d = parseIcsDate(val); ev.at = d.ms; ev.allDay = d.allDay || /VALUE=DATE\b/i.test(head); }
      else if (name === "DTEND") ev.end = parseIcsDate(val).ms;
      else if (name === "RRULE") ev.recurrence = parseRRule(val);
    }
    let added = 0, updated = 0;
    for (const e of events) {
      if (!e.title || !e.at) continue;
      const existing = e.uid && cal.find((c) => c.uid === e.uid);
      if (existing) { edit(existing.id, e); updated++; }
      else { add(e); added++; }
    }
    return { added, updated, total: events.length };
  }

  return { add, edit, remove, list, get: (id) => { const c = get(id); return c ? pub(c) : null; }, occurrences, nextOccurrence: (id, after) => { const c = get(id); return c ? nextOccurrence(c, after || now()) : 0; },
           tick, toICS, importICS, parseRRule, DAYS, FREQS };
};
