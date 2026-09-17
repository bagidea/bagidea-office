// v1.1 — 🔔 notifications you actually notice, and 📥 one approvals queue.
//
// Before this, five separate things waited on a person in five separate
// places, and a notification was a pixel character on a wallpaper that might
// be covered. These tests pin the two modules' behaviour, and the wiring that
// makes every old path go through them.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const CHANNELS = fs.readFileSync(path.join(ROOT, "daemon", "channels.js"), "utf8");
const OVERLAY = fs.readFileSync(path.join(ROOT, "daemon", "overlay.html"), "utf8");
const CLI = fs.readFileSync(path.join(ROOT, "cli", "bagidea.js"), "utf8");

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-inbox-")), "x.json");

function mkApprovals(extra = {}) {
  const events = [], notes = [];
  const a = require("../approvals")({ file: tmp(), broadcast: (e) => events.push(e), notify: (n) => notes.push(n), ...extra });
  return { a, events, notes };
}

// ── approvals ────────────────────────────────────────────────────────────────
test("approvals: ask → pending → respond runs the kind's handler exactly once", async () => {
  const { a, events, notes } = mkApprovals();
  let ran = 0;
  a.on("plugin", (item, d) => { ran++; assert.strictEqual(d, "approve"); });
  const { id, promise } = a.ask({ kind: "plugin", title: "Publish the post?", detail: "draft #3" });
  assert.strictEqual(a.pendingCount(), 1);
  assert.strictEqual(events[0].type, "approval.requested");
  assert.strictEqual(notes[0].kind, "approval", "asking must notify through the rules");
  assert.ok(await a.respond(id, "approve", { by: "test", note: "go" }));
  assert.strictEqual(await promise, "approve");
  assert.strictEqual(ran, 1);
  assert.strictEqual(a.pendingCount(), 0);
  assert.strictEqual(await a.respond(id, "approve"), false, "a second decision must be refused");
  assert.strictEqual(a.get(id).note, "go");
});

test("approvals: an unknown option is refused, not coerced", async () => {
  const { a } = mkApprovals();
  const { id } = a.ask({ kind: "blocked", title: "x" });
  assert.strictEqual(await a.respond(id, "approve"), false);   // blocked has continue/stop
  assert.strictEqual(a.pendingCount(), 1);
});

test("approvals: records survive a restart; a re-ask for the same ref replaces the stale one", () => {
  const file = tmp();
  const a1 = require("../approvals")({ file });
  a1.ask({ kind: "tool-permission", ref: "perm-9", title: "first" });
  const a2 = require("../approvals")({ file });
  assert.strictEqual(a2.pendingCount(), 1, "pending items must survive a restart");
  a2.ask({ kind: "tool-permission", ref: "perm-9", title: "re-asked" });
  assert.strictEqual(a2.pendingCount(), 1, "the same ref must not stack a twin");
  assert.strictEqual(a2.list({ pending: true })[0].title, "re-asked");
});

test("approvals: expiry decides 'expired' on its own", async () => {
  const { a } = mkApprovals();
  const { promise } = a.ask({ kind: "tool-permission", ref: "p1", title: "t", expiresMs: 30 });
  assert.strictEqual(await promise, "expired");
});

test("approvals: phone replies — numbers, words, ids, bare yes only when unambiguous", () => {
  const { a } = mkApprovals();
  assert.strictEqual(a.parseReply("yes"), null, "nothing pending → nothing to answer");
  const one = a.ask({ kind: "proposal", title: "A" }).id;
  assert.deepStrictEqual(a.parseReply("yes"), { id: one, decision: "approve", note: "" });
  assert.deepStrictEqual(a.parseReply("ตกลง"), { id: one, decision: "approve", note: "" });
  assert.deepStrictEqual(a.parseReply("/deny 1 too risky"), { id: one, decision: "reject", note: "too risky" });
  const two = a.ask({ kind: "blocked", title: "B" }).id;
  assert.strictEqual(a.parseReply("yes"), null, "two pending → a bare yes is ambiguous");
  assert.deepStrictEqual(a.parseReply("2 continue use the staging key"), { id: two, decision: "continue", note: "use the staging key" });
  assert.deepStrictEqual(a.parseReply("no 2"), { id: two, decision: "stop", note: "" });
  assert.deepStrictEqual(a.parseReply("/approve " + one), { id: one, decision: "approve", note: "" });
  assert.strictEqual(a.parseReply("hello team, how is it going"), null, "ordinary chat must fall through to the Director");
  assert.strictEqual(a.parseReply("9 yes"), null, "an index that doesn't exist answers nothing");
});

// ── notify ───────────────────────────────────────────────────────────────────
function mkNotify(reg, nowFn) {
  const events = [], relayed = [];
  const n = require("../notify")({ file: tmp(), reg, saveReg: () => {}, broadcast: (e) => events.push(e),
    relay: (t, item) => relayed.push({ t, item }), now: nowFn || (() => Date.now()) });
  return { n, events, relayed };
}

test("notify: rules route an approval everywhere and a system note to the centre only", () => {
  const { n, events, relayed } = mkNotify({});
  const r1 = n.send({ kind: "approval", title: "Allow rm?" });
  assert.deepStrictEqual([r1.routed.centre, r1.routed.toast, r1.routed.channel, r1.routed.sound], [true, true, true, true]);
  assert.strictEqual(relayed.length, 1);
  const r2 = n.send({ kind: "system", title: "fyi" });
  assert.deepStrictEqual([r2.routed.toast, r2.routed.channel, r2.routed.sound], [false, false, false]);
  assert.strictEqual(n.unreadCount(), 2);
  assert.strictEqual(events.filter((e) => e.type === "notify.item").length, 2);
});

test("notify: quiet hours silence toast/channel/sound but never the centre — and wrap midnight", () => {
  let t = new Date(); t.setHours(23, 30, 0, 0);
  const { n, relayed } = mkNotify({ notify: { quiet: { enabled: true, start: "22:00", end: "08:00" } } }, () => t.getTime());
  const r = n.send({ kind: "reminder", title: "standup" });    // reminder is when:"quiet"
  assert.strictEqual(r.routed.centre, true);
  assert.deepStrictEqual([r.routed.toast, r.routed.channel, r.routed.sound], [false, false, false]);
  assert.strictEqual(relayed.length, 0);
  t.setHours(3, 0, 0, 0);
  assert.strictEqual(n.inQuietHours(t.getTime()), true, "03:00 is inside a 22:00→08:00 window");
  t.setHours(12, 0, 0, 0);
  assert.strictEqual(n.inQuietHours(t.getTime()), false);
  const r2 = n.send({ kind: "approval", title: "always" });   // approval is when:"always"
  assert.strictEqual(r2.routed.toast, true, "an approval ignores quiet hours");
});

test("notify: 'away' rules fire only after five minutes without input", () => {
  let now = 1_000_000_000_000;
  const { n } = mkNotify({ notify: { rules: { done: { when: "away", toast: true } } } }, () => now);
  n.presence(true);
  assert.strictEqual(n.send({ kind: "done", title: "d" }).routed.toast, false, "at the keyboard → no toast");
  now += 6 * 60 * 1000;
  assert.strictEqual(n.send({ kind: "done", title: "d" }).routed.toast, true, "away → toast");
});

test("notify: the pre-1.1 channel mute (reg.channelNotify=false) is still honoured", () => {
  const { n, relayed } = mkNotify({ channelNotify: false });
  n.send({ kind: "approval", title: "x" });
  assert.strictEqual(relayed.length, 0);
});

test("notify: mark-read, unread count, and a bounded list", () => {
  const { n } = mkNotify({});
  const a = n.send({ kind: "system", title: "1" }), b = n.send({ kind: "system", title: "2" });
  assert.strictEqual(n.unreadCount(), 2);
  n.markRead([a.id]);
  assert.strictEqual(n.unreadCount(), 1);
  assert.strictEqual(n.list({ unread: true })[0].id, b.id);
  n.markRead("all");
  assert.strictEqual(n.unreadCount(), 0);
  assert.strictEqual(n.list({ limit: 1 }).length, 1);
});

// ── the wiring: every old path goes through the queue ────────────────────────
test("wiring: all five things that waited on a person now ask the queue", () => {
  for (const kind of ["tool-permission", "project-trust", "proposal", "blocked", "job"]) {
    assert.match(SERVER, new RegExp('approvals\\.ask\\(\\{ kind: "' + kind + '"'), `${kind} no longer asks through the inbox`);
    assert.match(SERVER, new RegExp('approvals\\.on\\("' + kind + '"'), `${kind} has no handler — a phone reply would do nothing`);
  }
  assert.doesNotMatch(SERVER, /notifyChannels\("⛔/, "BLOCKED is still only relayed as text, not askable");
  assert.match(SERVER, /function decideProposal\(/, "the proposal verdict is not shared between the panel and the phone");
});

test("wiring: notifyChannels routes through the rules, and the routes exist", () => {
  assert.match(SERVER, /function notifyChannels\(text, kind\)[\s\S]{0,400}notify\.send\(/);
  for (const r of ["/approvals", "/approvals/respond", "/notify", "/notify/read", "/notify/rules", "/notify/presence", "/notify/send", "/inbox"]) {
    assert.ok(SERVER.includes('req.url === "' + r + '"') || SERVER.includes('req.url.split("?")[0] === "' + r + '"'), `route ${r} missing`);
  }
  assert.match(SERVER, /url === "\/approvals\/respond"[\s\S]{0,300}x-bagidea-ui/, "respond must be human-UI-only, like proposals");
});

test("wiring: a reply on a channel answers the inbox before the Director sees it", () => {
  const i = SERVER.indexOf("approvals.parseReply(String(text))");
  const j = SERVER.indexOf("const cmd = channelCommand(String(text).trim());");
  assert.ok(i > -1 && j > -1 && i < j, "the inbox reply check must run before slash commands and the Director");
  assert.match(SERVER, /cmd === "inbox"/, "no /inbox slash command");
  assert.match(SERVER, /onCallback\(channel, data, answer\)/, "no button-callback path");
});

test("wiring: Telegram approval cards carry buttons and answer taps", () => {
  assert.match(CHANNELS, /inline_keyboard/, "no inline keyboard");
  assert.match(CHANNELS, /callback_data: "apv:"/);
  assert.match(CHANNELS, /u\.callback_query/, "callback_query updates are not handled — taps would be ignored");
  assert.match(CHANNELS, /answerCallbackQuery/);
  assert.match(CHANNELS, /function relay\(text, item\)/);
});

test("overlay: the sidebar has the two new sections, toasts, and a NOTIFY tab", () => {
  for (const s of ['id="ntfList"', 'id="apvList"', 'id="toasts"', "🔔 NOTIFICATIONS", "📥 APPROVALS", "🔔 NOTIFY", "QUIET HOURS", "NOTIFICATION RULES"])
    assert.ok(OVERLAY.includes(s), `overlay is missing ${s}`);
  assert.match(OVERLAY, /ev\.type === "approval\.requested"/);
  assert.match(OVERLAY, /ev\.type === "notify\.item"/);
  assert.match(OVERLAY, /\/notify\/presence/, "no presence ping — 'away' rules could never fire");
  // the badge must count approvals too, not only tool permissions
  assert.match(OVERLAY, /const n = permsEl\.children\.length \+ apvPending\(\)/);
});

test("catalog: Codex is in the Tools Hub, in all 14 languages", () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "tools.json"), "utf8")).tools;
  const codex = cat.find((t) => t.id === "codex");
  assert.ok(codex, "no codex entry");
  assert.strictEqual(codex.cmd, "codex mcp-server");
  assert.ok(codex.en.desc && codex.th.desc && codex.en.risk && codex.en.needs);
  for (const l of ["zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr", "ko", "id", "vi"]) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "assets", "tools-i18n", l + ".json"), "utf8"));
    for (const k of ["desc", "risk", "needs"]) assert.ok(m[codex.en[k]] && m[codex.en[k]] !== codex.en[k], `codex ${k} not translated in ${l}`);
  }
});

test("cli: inbox / approve / deny / answer / notify exist and are in --help", () => {
  for (const c of ['cmd === "inbox"', 'cmd === "approve" || cmd === "deny" || cmd === "answer"', 'cmd === "notify"', 'row("inbox"', 'row("approve <n|id> [note]"', 'row("notify [test]"'])
    assert.ok(CLI.includes(c), `cli missing ${c}`);
});
