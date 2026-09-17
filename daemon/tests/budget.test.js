// v1.2 — 💸 budgets in money, OS-level toasts, a tray badge.
//
// Before this the only limit on spend was a per-request context budget; a
// thread ran to 9.5M tokens (issue #46) with nothing but a meter to notice.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const OVERLAY = fs.readFileSync(path.join(ROOT, "daemon", "overlay.html"), "utf8");
const SHELL = fs.readFileSync(path.join(ROOT, "shell", "src", "main.rs"), "utf8");
const CARGO = fs.readFileSync(path.join(ROOT, "shell", "Cargo.toml"), "utf8");
const CLI = fs.readFileSync(path.join(ROOT, "cli", "bagidea.js"), "utf8");

const DAY = "2026-09-12";
const T = new Date(DAY + "T12:00:00").getTime();

function mk(regBudget, statsObj, at) {
  const notes = [];
  const reg = { budget: regBudget };
  const stats = statsObj || {};
  const b = require("../budget")({ reg, saveReg: () => {}, stats: () => stats, notify: (n) => notes.push(n), now: () => (at || T) });
  return { b, notes, reg, stats };
}

test("budget: the ledger adds Claude's real bill and the estimated brains/tools, and says so", () => {
  const { b } = mk({}, { [DAY]: { cost: 1.25, brains: { glm: { cost: 0.5 } }, aux: { gemini: 0.25 } } });
  const t = b.dayTotals(DAY);
  assert.deepStrictEqual([t.real, t.est, t.total, t.estimated], [1.25, 0.75, 2, true]);
  const t2 = mk({}, { [DAY]: { cost: 3 } }).b.dayTotals(DAY);
  assert.strictEqual(t2.estimated, false, "a Claude-only day is a real bill, not an estimate");
});

test("budget: no caps → every turn is fine, no notifications", () => {
  const { b, notes } = mk({}, { [DAY]: { cost: 999 } });
  assert.strictEqual(b.check("marcus", null).ok, true);
  assert.strictEqual(notes.length, 0);
});

test("budget: 80% warns exactly once per day per scope; 100% stops and says why", () => {
  const { b, notes, stats } = mk({ office: { daily: 10 } }, { [DAY]: { cost: 8.5 } });
  assert.strictEqual(b.check("marcus", null).ok, true, "85% is a warning, not a stop");
  assert.strictEqual(b.check("marcus", null).ok, true);
  assert.strictEqual(notes.filter((n) => n.kind === "budget").length, 1, "the warning must not repeat every turn");
  assert.match(notes[0].title, /85%/);
  stats[DAY].cost = 10.4;
  const g = b.check("marcus", null);
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.level, "stop");
  assert.strictEqual(g.scope, "office");
  assert.strictEqual(notes.filter((n) => /Budget reached/.test(n.title)).length, 1);
  b.check("marcus", null);
  assert.strictEqual(notes.filter((n) => /Budget reached/.test(n.title)).length, 1, "the stop notice must not repeat either");
});

test("budget: per-agent and per-project caps are judged on their own attribution", () => {
  const { b } = mk({ agents: { marcus: { daily: 1 } }, projects: { shop: { total: 5 } } },
    { "2026-09-10": { projCost: { shop: 3 } }, [DAY]: { agentCost: { marcus: 1.2 }, projCost: { shop: 2.5 } } });
  assert.strictEqual(b.check("marcus", null).level, "stop", "marcus is over his own daily cap");
  assert.strictEqual(b.check("priya", null).ok, true, "priya has no cap of her own");
  const p = b.check("priya", "shop");
  assert.strictEqual(p.level, "stop", "the project cap is lifetime: 3 + 2.5 > 5");
  assert.strictEqual(b.check("priya", "other").ok, true);
});

test("budget: attribute() records a turn against agent and project, ghost ids collapse to their parent", () => {
  const { b, stats } = mk({}, {});
  b.attribute("marcus#2", "shop", 0.4, T);
  b.attribute("marcus", "shop", 0.1, T);
  assert.strictEqual(stats[DAY].agentCost.marcus, 0.5);
  assert.strictEqual(stats[DAY].projCost.shop, 0.5);
  b.attribute("marcus", null, 0, T);
  assert.strictEqual(stats[DAY].agentCost.marcus, 0.5, "zero-cost turns don't touch the ledger");
});

test("budget: caps are validated, and 0 removes a cap", () => {
  const { b, reg } = mk({}, {});
  b.setCaps({ office: { daily: "7.5" }, agents: { marcus: { daily: 2 }, bad: { daily: -1 } }, digest: { enabled: true, time: "07:30" } });
  assert.deepStrictEqual(b.caps().office, { daily: 7.5 });
  assert.deepStrictEqual(b.caps().agents, { marcus: 2 });
  assert.deepStrictEqual(b.caps().digest, { enabled: true, time: "07:30" });
  b.setCaps({ office: { daily: 0 } });
  assert.strictEqual(b.caps().office.daily, 0);
  assert.ok(!("bad" in (reg.budget.agents || {})));
  b.setCaps({ digest: { enabled: true, time: "nonsense" } });
  assert.strictEqual(b.caps().digest.time, "08:00", "a bad time falls back rather than breaking the tick");
});

test("budget: the digest fires once a morning at the chosen time, and reads like a report", () => {
  const stats = { "2026-09-11": { cost: 4.2, runs: 31, done: 29, failed: 2, agentCost: { marcus: 3, priya: 1.2 } } };
  const early = new Date(DAY + "T07:59:00").getTime(), late = new Date(DAY + "T08:00:00").getTime();
  const { b, notes } = mk({ digest: { enabled: true, time: "08:00" } }, stats, early);
  assert.strictEqual(b.digestDue(early), false);
  assert.strictEqual(b.digestDue(late), true);
  const text = b.sendDigest(late, { pending: 2 });
  assert.match(text, /Yesterday \(2026-09-11\): \$4\.20 · 31 turns · 29 done · 2 failed/);
  assert.match(text, /Top spend: marcus \$3\.00 · priya \$1\.20/);
  assert.match(text, /2 waiting for you/);
  assert.strictEqual(b.digestDue(late + 60000), false, "sent once, not every tick");
  assert.strictEqual(notes[0].kind, "system");
});

test("wiring: the gate runs in runClaude before anything is spawned, and cost is attributed per turn", () => {
  const i = SERVER.indexOf("const gate = budget.check(agent, projId);");
  const j = SERVER.indexOf("claude sessions are PER-DIRECTORY");
  const k = SERVER.indexOf("function runClaude(");
  assert.ok(k > -1 && i > k && j > i, "the budget gate must sit inside runClaude, before the session is touched");
  assert.ok((SERVER.match(/budget\.attribute\(agent, projId, /g) || []).length >= 2, "real turn costs are not attributed");
  assert.match(SERVER, /function brainBump\(provider, inTok, outTok, agent, projId\)/, "estimated brain costs are not attributed");
  assert.match(SERVER, /budget\.digestDue\(now\)/, "the digest is never checked on the tick");
  for (const r of ['"/budget"', '"/budget/digest"']) assert.ok(SERVER.includes("req.url === " + r), "route " + r + " missing");
  assert.match(SERVER, /url === "\/budget"\) \{[\s\S]{0,200}readBody[\s\S]{0,120}x-bagidea-ui/, "setting caps must be human-UI-only");
  assert.match(SERVER, /budget: budget\.summary\(\),/, "STATS does not carry the budget");
});

test("overlay: a 💸 BUDGET tab, the STATS line, and the two shell hooks", () => {
  for (const s of ["💸 BUDGET", "DAILY BUDGET", "PER-AGENT CAPS", "PER-PROJECT CAPS", "MORNING DIGEST", 'id="bgOffice"', "/budget/digest"])
    assert.ok(OVERLAY.includes(s), "overlay is missing " + s);
  assert.match(OVERLAY, /__shellPost\("notify:"/, "toasts never reach the shell");
  assert.match(OVERLAY, /__shellPost\("badge:" \+ n\)/, "the badge count never reaches the tray");
  assert.match(OVERLAY, /const bg = s\.budget \|\| null;/, "STATS ignores the budget");
});

test("shell: toasts and the badge exist, and they cost no new crate", () => {
  for (const s of ["Toast(String, String)", "ToastClose(tao::window::WindowId)", "Badge(u32)",
                   's if s.starts_with("notify:")', 's if s.starts_with("badge:")',
                   "UserEvent::Toast(title, body) =>", "UserEvent::Badge(n) =>", "fn tray_badge_icon(", "const TOAST_HTML",
                   "tray.set_icon(tray_badge_icon(n))", "with_always_on_top(true)"])
    assert.ok(SHELL.includes(s), "shell is missing " + s);
  assert.doesNotMatch(SHELL, /let _tray = TrayIconBuilder/, "the tray handle is still discarded — set_icon has nothing to call on");
  const deps = CARGO.slice(CARGO.indexOf("[dependencies]"), CARGO.indexOf("[target."));
  assert.doesNotMatch(deps, /notify-rust|winrt-notification|mac-notification/, "an OS-notification crate crept in; the toast window needs none");
});

test("cli: bagidea budget", () => {
  for (const s of ['cmd === "budget"', 'row("budget"', 'sub === "set"', 'sub === "digest"']) assert.ok(CLI.includes(s), "cli missing " + s);
});
