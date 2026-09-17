// BagIdea Office — notifications you actually notice.
//
// Before this, a notification was a pixel character walking across a wallpaper
// that may be covered by a browser, a line in a chat you may not have open, and
// one unfiltered string relayed to Telegram. The CEO's own words: "sometimes I
// barely know there's a notification." When the office starts running work
// while you're away (v1.3+), that silence becomes a liability.
//
// One call — notify.send({ kind, title, body, link }) — and the RULES decide
// where it goes:
//
//   centre   the 🔔 list in the overlay (always; persisted; unread count)
//   toast    a pop-up — in-app now, the OS's own from v1.2
//   channel  Telegram / Discord / LINE / … through channels.relay
//   sound    one short cue, respecting the office sound toggle
//
// …and WHEN: always, outside quiet hours, or only when you're away from the
// keyboard (the overlay reports input activity; a toast is pointless while you
// are typing in the chat and essential when you're in another app).
//
// Zero dependencies.

const fs = require("fs");

const KINDS = ["approval", "done", "blocked", "budget", "workflow", "reminder", "mention", "proposal", "system"];
const WHERE = ["centre", "toast", "channel", "sound"];
const WHEN = ["always", "quiet", "away"];   // quiet = respect quiet hours · away = only when away

// Defaults that match how the office behaved before, plus the two things people
// asked for: an approval reaches you everywhere, and a reminder makes a sound.
const DEFAULT_RULES = {
  approval: { centre: true, toast: true,  channel: true,  sound: true,  when: "always" },
  blocked:  { centre: true, toast: true,  channel: true,  sound: true,  when: "always" },
  reminder: { centre: true, toast: true,  channel: true,  sound: true,  when: "quiet" },
  budget:   { centre: true, toast: true,  channel: true,  sound: false, when: "always" },
  done:     { centre: true, toast: false, channel: true,  sound: false, when: "quiet" },
  workflow: { centre: true, toast: true,  channel: true,  sound: false, when: "quiet" },
  proposal: { centre: true, toast: false, channel: true,  sound: false, when: "quiet" },
  mention:  { centre: true, toast: true,  channel: false, sound: true,  when: "quiet" },
  system:   { centre: true, toast: false, channel: false, sound: false, when: "quiet" },
};

const MAX_ITEMS = 500;
const AWAY_AFTER_MS = 5 * 60 * 1000;   // no input for five minutes = away

module.exports = function initNotify(ctx) {
  const FILE = ctx.file;
  const reg = ctx.reg;                       // rules live in the registry: reg.notify
  const saveReg = ctx.saveReg || (() => {});
  const broadcast = ctx.broadcast || (() => {});
  const relay = ctx.relay || (() => {});     // channels.relay
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());

  let items = [];
  let lastInput = now();                     // updated by the overlay's presence pings

  function load() {
    try { items = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { items = []; }
    if (!Array.isArray(items)) items = [];
  }
  function save() {
    if (items.length > MAX_ITEMS) items = items.slice(-MAX_ITEMS);
    try { fs.writeFileSync(FILE, JSON.stringify(items)); } catch (e) { log("[notify] save " + e.message); }
  }
  load();

  function rules() {
    const r = (reg.notify && reg.notify.rules) || {};
    const out = {};
    for (const k of KINDS) out[k] = { ...DEFAULT_RULES[k], ...(r[k] || {}) };
    return out;
  }
  function quiet() {
    const q = (reg.notify && reg.notify.quiet) || {};
    return { enabled: !!q.enabled, start: q.start || "22:00", end: q.end || "08:00" };
  }
  function setRules(patch) {
    reg.notify = reg.notify || {};
    if (patch.rules) {
      reg.notify.rules = reg.notify.rules || {};
      for (const [k, v] of Object.entries(patch.rules)) {
        if (!KINDS.includes(k) || !v || typeof v !== "object") continue;
        const cur = { ...(reg.notify.rules[k] || {}) };
        for (const w of WHERE) if (typeof v[w] === "boolean") cur[w] = v[w];
        if (WHEN.includes(v.when)) cur.when = v.when;
        reg.notify.rules[k] = cur;
      }
    }
    if (patch.quiet && typeof patch.quiet === "object") {
      const q = patch.quiet;
      reg.notify.quiet = {
        enabled: !!q.enabled,
        start: /^\d\d:\d\d$/.test(q.start || "") ? q.start : "22:00",
        end: /^\d\d:\d\d$/.test(q.end || "") ? q.end : "08:00",
      };
    }
    saveReg();
    broadcast({ type: "notify.rules", rules: rules(), quiet: quiet() }, false);
  }

  // Local wall-clock minutes; quiet hours may wrap midnight (22:00 → 08:00).
  function inQuietHours(at) {
    const q = quiet();
    if (!q.enabled) return false;
    const d = new Date(at);
    const cur = d.getHours() * 60 + d.getMinutes();
    const [sh, sm] = q.start.split(":").map(Number), [eh, em] = q.end.split(":").map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
  }
  function isAway(at) { return at - lastInput > AWAY_AFTER_MS; }
  function presence(active) { if (active) lastInput = now(); }

  let seq = 0;
  function newId() {
    const t = now();
    let id;
    do { id = "n" + t + (seq ? "-" + seq : ""); seq++; } while (items.some((i) => i.id === id));
    return id;
  }

  // Decide where ONE notification goes, given the rules and the moment.
  function route(kind, at) {
    const r = rules()[kind] || rules().system;
    const quietNow = inQuietHours(at);
    const away = isAway(at);
    const gate = r.when === "always" ? true : r.when === "quiet" ? !quietNow : /* away */ away;
    return {
      centre: !!r.centre,                       // the centre always keeps the record
      toast: !!r.toast && gate,
      channel: !!r.channel && gate && reg.channelNotify !== false,   // the pre-1.1 mute still works
      sound: !!r.sound && gate && reg.sound !== false,
      quietNow, away,
    };
  }

  function send(spec) {
    const kind = KINDS.includes(spec.kind) ? spec.kind : "system";
    const at = now();
    const item = {
      id: spec.id ? "n:" + spec.id : newId(),
      kind,
      title: String(spec.title || "").slice(0, 200),
      body: String(spec.body || "").slice(0, 1000),
      link: spec.link || "",
      agent: spec.agent || "",
      options: Array.isArray(spec.options) ? spec.options : undefined,
      at, read: 0,
    };
    const r = route(kind, at);
    if (r.centre) { items.push(item); save(); }
    broadcast({ type: "notify.item", item, toast: r.toast, sound: r.sound, unread: unreadCount() }, false);
    if (r.channel) {
      const line = (spec.channelText) ||
        `${iconFor(kind)} ${item.title}${item.body ? "\n" + item.body : ""}`;
      try { relay(line, item); } catch (e) { log("[notify] relay " + (e && e.message)); }
    }
    return { ...item, routed: r };
  }

  function iconFor(kind) {
    return { approval: "📥", done: "✅", blocked: "⛔", budget: "💸", workflow: "🔀",
             reminder: "⏰", mention: "💬", proposal: "💡", system: "ℹ️" }[kind] || "🔔";
  }

  function unreadCount() { return items.filter((i) => !i.read).length; }
  function markRead(ids) {
    const t = now();
    const all = ids === "all" || ids === undefined;
    for (const i of items) if (!i.read && (all || (Array.isArray(ids) && ids.includes(i.id)))) i.read = t;
    save();
    broadcast({ type: "notify.read", unread: unreadCount() }, false);
    return unreadCount();
  }
  function list(o = {}) {
    let out = o.unread ? items.filter((i) => !i.read) : items.slice();
    out = out.slice().reverse();                     // newest first
    return out.slice(0, Math.max(1, Math.min(Number(o.limit) || 100, MAX_ITEMS)));
  }

  return {
    KINDS, WHERE, WHEN, DEFAULT_RULES,
    send, list, markRead, unreadCount, rules, quiet, setRules, route, presence,
    inQuietHours, isAway,
    clear: () => { items = []; save(); broadcast({ type: "notify.read", unread: 0 }, false); },
  };
};
