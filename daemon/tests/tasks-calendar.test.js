// v1.4 (design F): work items and the calendar module.
//   tasks    — a card's life, dependencies that hold and release, recurrence,
//              due-date reminders through the rules, the board, agent notes
//   calendar — recurrence expansion (daily/weekly-by-day/monthly), per-occurrence
//              reminders, ICS export/import round trip, old rows loading unchanged
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-tasks-"));
const DAY = 86400000;

function mkTasks(o = {}) {
  const dir = tmp();
  const notes = [], events = [];
  let clock = o.now || Date.UTC(2026, 8, 12, 9, 0, 0);
  const tasks = require("../tasks")({ file: path.join(dir, "tasks.json"), notify: (n) => notes.push(n), broadcast: (e) => events.push(e),
    now: () => clock, agentName: (id) => ({ main: "Director", priya: "Priya" }[id] || id) });
  return { tasks, notes, events, dir, tick: (ms) => { clock += ms; }, at: () => clock };
}

test("tasks: a card is created, moved and finished; the board groups by status", () => {
  const { tasks, events } = mkTasks();
  const a = tasks.create({ title: "Write the launch post", owner: "main", due: "2026-09-13", priority: 2, project: "site" });
  assert.strictEqual(a.status, "todo");
  assert.ok(a.due > 0, "a bare date becomes a due time");
  assert.strictEqual(tasks.move(a.id, "doing").status, "doing");
  assert.strictEqual(tasks.board().doing[0].id, a.id);
  const d = tasks.move(a.id, "done");
  assert.ok(d.done > 0);
  assert.deepStrictEqual(events.filter((e) => e.type.startsWith("work.")).map((e) => e.type), ["work.created", "work.updated", "work.done"]);
  assert.throws(() => tasks.create({ title: "" }), /title/);
  assert.throws(() => tasks.move(a.id, "later"), /status must be/);
});

test("tasks: a dependency holds a card in waiting and releases it when the blocker closes — the owner is told", () => {
  const { tasks, notes } = mkTasks();
  const a = tasks.create({ title: "Draft", owner: "priya" });
  const b = tasks.create({ title: "Publish", owner: "you", dependsOn: [a.id] });
  assert.strictEqual(b.status, "waiting");
  assert.strictEqual(b.blocked, true);
  tasks.move(a.id, "done");
  const b2 = tasks.get(b.id);
  assert.strictEqual(b2.status, "todo");
  assert.strictEqual(b2.blocked, false);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].kind, "reminder");
  assert.match(notes[0].title, /Unblocked: Publish/);
  // a card the person parked stays parked
  const c = tasks.create({ title: "Someday", status: "waiting" });
  tasks.update(c.id, { priority: 4 });
  assert.strictEqual(tasks.get(c.id).status, "waiting", "manual waiting is not auto-released");
});

test("tasks: a repeating card comes back when done, due the next period; until ends it", () => {
  const { tasks } = mkTasks();
  const a = tasks.create({ title: "Weekly report", owner: "main", due: "2026-09-14", recurrence: "every week" });
  assert.deepStrictEqual(a.recurrence, { every: "week", interval: 1, until: 0 });
  tasks.move(a.id, "done");
  const open = tasks.list({ open: true });
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].title, "Weekly report");
  assert.strictEqual(open[0].due - a.due, 7 * DAY);
  const b = tasks.create({ title: "Two more", due: "2026-09-14", recurrence: { every: "day", interval: 2, until: "2026-09-15" } });
  tasks.move(b.id, "done");
  assert.strictEqual(tasks.list({ open: true }).length, 1, "past `until` no new card");
});

test("tasks: due-date reminders go out once for 'soon' and once for 'overdue'", () => {
  const { tasks, notes, tick } = mkTasks();
  const a = tasks.create({ title: "Ship it", owner: "priya", due: Date.UTC(2026, 8, 12, 9, 30, 0) });   // 30 min ahead
  assert.strictEqual(tasks.tick(), 1);
  assert.match(notes[0].title, /Due soon: Ship it/);
  assert.strictEqual(notes[0].agent, "priya");
  assert.strictEqual(tasks.tick(), 0, "not twice");
  tick(2 * 3600000);
  assert.strictEqual(tasks.tick(), 1);
  assert.match(notes[1].title, /Overdue: Ship it/);
  assert.strictEqual(tasks.tick(), 0);
  assert.strictEqual(tasks.get(a.id).overdue, true);
  tasks.move(a.id, "done");
  tick(DAY);
  assert.strictEqual(tasks.tick(), 0, "a done card never nags");
});

test("tasks: persisted, ordered by priority then due, summarised, and told to agents in English", () => {
  const { tasks, dir } = mkTasks();
  tasks.create({ title: "Low", owner: "main", priority: 4 });
  tasks.create({ title: "Urgent", owner: "main", priority: 1, due: "2026-09-13" });
  tasks.create({ title: "Also P1 but later", owner: "main", priority: 1, due: "2026-09-20" });
  tasks.create({ title: "Someone else's", owner: "priya" });
  const again = require("../tasks")({ file: path.join(dir, "tasks.json") });
  assert.deepStrictEqual(again.list({ owner: "main" }).map((t) => t.title), ["Urgent", "Also P1 but later", "Low"]);
  const s = tasks.summary();
  assert.strictEqual(s.open, 4);
  const note = tasks.agentNote("main");
  assert.match(note, /<office-tasks>/);
  assert.match(note, /Urgent/);
  assert.ok(!/[฀-๿]/.test(note), "the agent note is English");
  assert.match(note, /POST http:\/\/127\.0\.0\.1:8787\/tasks\/move/);
  assert.strictEqual(tasks.bySource("job", "x"), null);
  const j = tasks.create({ title: "fired", kind: "job", source: { kind: "job", ref: "j1" } });
  assert.strictEqual(tasks.bySource("job", "j1").id, j.id);
});

// ---- calendar -------------------------------------------------------------------
function mkCal(o = {}) {
  const dir = tmp();
  const file = path.join(dir, "calendar.json");
  if (o.seed) fs.writeFileSync(file, JSON.stringify(o.seed));
  const reminded = [];
  let clock = o.now || new Date(2026, 8, 12, 9, 0, 0).getTime();
  const cal = require("../calendar")({ file, remind: (ev, occ) => reminded.push({ ev, occ }), now: () => clock });
  return { cal, reminded, file, tick: (ms) => { clock += ms; }, at: () => clock };
}

test("calendar: old rows load unchanged; add/edit/remove; all-day snaps to midnight", () => {
  const { cal } = mkCal({ seed: [{ id: "c1", title: "Old row", at: new Date(2026, 8, 13, 10, 0).getTime(), remindMin: 10, notified: false }] });
  assert.strictEqual(cal.list()[0].title, "Old row");
  const e = cal.add({ title: "Offsite", at: new Date(2026, 8, 20, 15, 30).getTime(), allDay: true });
  assert.strictEqual(new Date(e.at).getHours(), 0);
  assert.strictEqual(e.end - e.at, DAY);
  cal.edit(e.id, { title: "Offsite day", remindMin: 60 });
  assert.strictEqual(cal.get(e.id).title, "Offsite day");
  assert.strictEqual(cal.remove(e.id), true);
  assert.strictEqual(cal.list().length, 1);
  assert.throws(() => cal.add({ title: "no time" }), /need title \+ at/);
});

test("calendar: recurrence expands — daily, weekly by day, monthly, with count and until", () => {
  const { cal } = mkCal();
  const mon = new Date(2026, 8, 14, 10, 0).getTime();   // a Monday
  cal.add({ title: "Sync", at: mon, recurrence: { freq: "weekly", byDay: ["MO", "WE"] } });
  const occ = cal.occurrences(mon - DAY, mon + 10 * DAY);
  assert.deepStrictEqual(occ.map((o) => new Date(o.at).getDay()), [1, 3, 1, 3]);
  assert.strictEqual(new Date(occ[1].at).getHours(), 10, "keeps the time of day");
  cal.add({ title: "Standup", at: mon, recurrence: { freq: "daily", count: 3 } });
  assert.strictEqual(cal.occurrences(mon - DAY, mon + 30 * DAY).filter((o) => o.title === "Standup").length, 3);
  cal.add({ title: "Rent", at: new Date(2026, 8, 1, 9, 0).getTime(), recurrence: { freq: "monthly", until: new Date(2026, 11, 31).getTime() } });
  const rent = cal.occurrences(new Date(2026, 8, 1).getTime(), new Date(2027, 5, 1).getTime()).filter((o) => o.title === "Rent");
  assert.deepStrictEqual(rent.map((o) => new Date(o.at).getMonth()), [8, 9, 10, 11]);
  assert.strictEqual(cal.parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5").interval, 2);
});

test("calendar: reminds per occurrence, once each, through the remind hook", () => {
  const { cal, reminded, tick } = mkCal();
  const first = new Date(2026, 8, 12, 9, 30).getTime();   // 30 min ahead of the clock
  cal.add({ title: "Daily check", at: first, remindMin: 15, recurrence: { freq: "daily" } });
  assert.strictEqual(cal.tick(), 0, "not yet in the reminder window");
  tick(16 * 60000);
  assert.strictEqual(cal.tick(), 1);
  assert.strictEqual(reminded[0].ev.title, "Daily check");
  assert.strictEqual(reminded[0].occ.at, first);
  assert.strictEqual(cal.tick(), 0, "once per occurrence");
  tick(DAY);                                               // tomorrow, same minute
  assert.strictEqual(cal.tick(), 1, "the next occurrence reminds again");
  assert.strictEqual(reminded[1].occ.at, first + DAY);
});

test("calendar: ICS export/import round trip keeps title, time, recurrence and alarm; same UID updates", () => {
  const a = mkCal();
  const at = new Date(2026, 8, 14, 10, 0).getTime();
  a.cal.add({ title: "Sync, weekly; notes", at, remindMin: 15, notes: "bring the numbers\nand coffee", recurrence: { freq: "weekly", byDay: ["MO"] } });
  a.cal.add({ title: "Offsite", at, allDay: true });
  const ics = a.cal.toICS();
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Sync\\, weekly\\; notes/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260914/);
  const b = mkCal();
  const r = b.cal.importICS(ics);
  assert.deepStrictEqual(r, { added: 2, updated: 0, total: 2 });
  const sync = b.cal.list().find((c) => c.title === "Sync, weekly; notes");
  assert.strictEqual(sync.at, at);
  assert.strictEqual(sync.remindMin, 15);
  assert.deepStrictEqual(sync.recurrence, { freq: "weekly", interval: 1, byDay: ["MO"] });
  assert.strictEqual(sync.notes, "bring the numbers\nand coffee");
  assert.strictEqual(b.cal.list().find((c) => c.title === "Offsite").allDay, true);
  const r2 = b.cal.importICS(ics.replace("SUMMARY:Offsite", "SUMMARY:Offsite (moved)"));
  assert.deepStrictEqual(r2, { added: 0, updated: 2, total: 2 });
  assert.ok(b.cal.list().some((c) => c.title === "Offsite (moved)"));
  assert.strictEqual(b.cal.list().length, 2, "no duplicates on re-import");
});
