// v1.5: the official plugin library and team templates.
//   library — every shipped plugin loads in the real host with the v1.4 hooks,
//             registers what it says it registers, answers its commands, and
//             its templates are valid workflows the engine accepts
//   teams   — every template is well-formed, references real builtin skills,
//             and hiring one creates the agents once (never overwriting)
//   server  — the routes and the schedule trigger's weekday
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(ROOT, "daemon", "server.js"), "utf8");
const LIB = path.join(ROOT, "daemon", "plugin-library");
const TEAMS = path.join(ROOT, "daemon", "teams");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-lib-"));
const THAI = /[฀-๿]/;

const HOSTS = [];
// A plugin's trigger may hold an interval or an fs.watch — release them all so the
// runner can exit (nothing here is unref'd on purpose: see the v1.1.0 lesson).
test.after(() => { for (const h of HOSTS) { try { h.triggers.stopAll(); } catch {} } });
function host() {
  const root = tmp();
  const notes = [], asked = [], claude = [];
  const reg = { agents: { main: { name: "Director" }, priya: { name: "Priya" }, ceo: { name: "You", isUser: true } }, triggers: [], skills: {} };
  const tasks = require("../tasks")({ file: path.join(root, "tasks.json"), notify: (n) => notes.push(n), log: () => {} });
  const calendar = require("../calendar")({ file: path.join(root, "calendar.json"), log: () => {} });
  const workflows = require("../workflows")({ dir: path.join(root, "wf"), notify: (n) => notes.push(n), runAgent: async (a, p) => { claude.push(p); return { ok: true, text: "agent did: " + p.slice(0, 40) }; }, log: () => {} });
  const triggers = require("../triggers")({ reg, workflows, log: () => {} });
  const skillTests = require("../skilltests")({ reg, saveReg: () => {}, log: () => {}, ask: async () => "use --data-binary @file" });
  const plugins = require("../plugins")({
    pluginsDir: path.join(root, "plugins"), log: () => {}, reg, saveReg: () => {}, broadcast: () => {}, daemonDir: path.join(ROOT, "daemon"), workspace: root,
    notify: (n) => notes.push(n), approvals: { ask: (item) => { asked.push(item); return Promise.resolve("approve"); } }, tasks, calendar, triggers, workflows,
    schedule: (p) => ({ id: "job1", ...p }), skillTests,
    runClaude: (agent, prompt, opts) => { claude.push(prompt); setTimeout(() => opts.onDone("Draft copy for the post #launch", true), 5); },
  });
  const h = { root, reg, notes, asked, claude, tasks, calendar, workflows, triggers, plugins };
  HOSTS.push(h);
  return h;
}
function install(h, id) {
  fs.cpSync(path.join(LIB, id), path.join(h.root, "plugins", id), { recursive: true });
  const r = h.plugins.load();
  assert.deepStrictEqual(r.failed, [], id + " must load cleanly");
  return h.plugins.list().find((p) => p.id === id);
}
const cmd = (h, id, name, args) => new Promise((resolve, reject) => {
  const req = { url: "/plugin/" + id + "/cmd", method: "POST" };
  const res = { writeHead: (code) => { res.code = code; }, end: (body) => { if (res.code && res.code !== 200) return reject(new Error(String(body))); try { resolve(JSON.parse(body)); } catch { resolve(body); } } };
  h.plugins.handleHttp(req, res, (r, cb) => cb(JSON.stringify({ cmd: name, args })), () => {});
});
const ids = fs.readdirSync(LIB).filter((d) => fs.existsSync(path.join(LIB, d, "plugin.json")));

test("library: seven plugins ship, each with a manifest, an index.js that parses, and English text only", () => {
  assert.ok(ids.length >= 8, "expected at least 8 library plugins, found " + ids.join(", "));
  for (const id of ids) {
    const man = JSON.parse(fs.readFileSync(path.join(LIB, id, "plugin.json"), "utf8"));
    assert.strictEqual(man.id, id, id + ": manifest id matches its folder");
    assert.ok(man.name && man.version && man.description && man.library, id + ": name, version, description, library block");
    assert.ok(Array.isArray(man.commands) && man.commands.length, id + ": has commands");
    for (const f of ["index.js", "panel.html"]) {
      const src = fs.readFileSync(path.join(LIB, id, f), "utf8");
      for (const line of src.split(/\r?\n/)) assert.ok(!THAI.test(line), `${id}/${f} carries Thai text: ${line.trim().slice(0, 60)}`);
    }
    assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(LIB, id, "index.js"), "utf8")), id + ": index.js parses");
  }
});

test("library: every plugin loads in the real host, and registers the hooks its manifest claims", () => {
  const h = host();
  for (const id of ids) install(h, id);
  const list = h.plugins.list();
  assert.strictEqual(list.length, ids.length);
  const kinds = h.triggers.kinds().map((k) => k.kind), nodes = h.workflows.nodeTypes().map((n) => n.kind);
  assert.ok(kinds.includes("rss"), "content-pipeline contributes the rss trigger kind");
  for (const n of ["fetch-article", "gather-report", "campaign-post", "decision-log"]) assert.ok(nodes.includes(n), "node type " + n);
  assert.ok(h.plugins.memoryPlugins().includes("decision-log"));
  for (const p of list) {
    const man = JSON.parse(fs.readFileSync(path.join(LIB, p.id, "plugin.json"), "utf8"));
    for (const hook of man.library.hooks || []) {
      if (hook === "onEvent") assert.ok(p.hooks.onEvent, p.id + " claims onEvent");
      if (hook === "memory.provider") assert.ok(p.hooks.memory, p.id + " claims a memory provider");
      if (hook === "triggers.register") assert.ok(p.hooks.triggers.length, p.id + " claims a trigger kind");
      if (hook === "workflow.node") assert.ok(p.hooks.nodes.length, p.id + " claims a node");
      if (hook === "skillTests") assert.ok(p.commands.some((c) => c.name === "run"), p.id + " claims the skill-test hook");
    }
  }
});

test("library: decision-log records, supersedes, and feeds the memory hook newest-first", async () => {
  const h = host(); install(h, "decision-log");
  const a = await cmd(h, "decision-log", "add", "ship on Fridays :: the weekend absorbs the fallout");
  assert.ok(a.decision.id);
  const b = await cmd(h, "decision-log", "supersede", `${a.decision.id} :: ship on Thursdays :: Fridays were worse`);
  assert.strictEqual(b.decision.supersedes, a.decision.id);
  const list = await cmd(h, "decision-log", "list", "");
  assert.strictEqual(list.decisions.length, 1, "only the active one");
  h.reg.agents.main.memoryPlugins = ["decision-log"];
  const mem = await h.plugins.memoryLines("main", {});
  assert.match(mem, /we decided ship on Thursdays because Fridays were worse/);
  assert.ok(!/Fridays absorb/.test(mem), "a superseded decision is not injected");
  assert.strictEqual(await h.plugins.memoryLines("priya", {}), "", "opt-in per agent");
});

test("library: weekly-report installs a workflow with a weekday schedule and a node that gathers real numbers", async () => {
  const h = host(); install(h, "weekly-report");
  h.tasks.create({ title: "Done thing", owner: "priya" }); h.tasks.move(h.tasks.list()[0].id, "done");
  const r = await cmd(h, "weekly-report", "setup", "fri 08:30");
  assert.strictEqual(r.when, "fri 08:30");
  assert.ok(h.workflows.exists("weekly-report"));
  const t = h.triggers.list().find((x) => x.workflowId === "weekly-report");
  assert.deepStrictEqual([t.kind, t.cfg.at, t.cfg.weekday], ["schedule", "08:30", 5]);
  const g = await cmd(h, "weekly-report", "gather", "7");
  assert.match(g.text, /Cards finished: 1/);
  assert.match(g.text, /Done thing/);
  // the weekday gate: a Friday slot does not fire on a Thursday
  const thu = new Date(2026, 8, 17, 9, 0).getTime(), fri = thu + 86400000;
  assert.strictEqual(h.triggers.tick(thu), 0);
  assert.strictEqual(h.triggers.tick(fri), 1);
});

test("library: client-folders wires a file trigger + workflow per client and cards each file", async () => {
  const h = host(); install(h, "client-folders");
  const folder = path.join(h.root, "acme"); fs.mkdirSync(folder);
  const r = await cmd(h, "client-folders", "add", `Acme :: ${folder} :: priya :: extract the invoice total`);
  assert.strictEqual(r.client.slug, "acme");
  const t = h.triggers.get(r.client.triggerId);
  assert.strictEqual(t.kind, "file"); assert.strictEqual(t.cfg.dir, path.resolve(folder));
  const wf = h.workflows.load("client-acme");
  assert.match(wf.nodes[1].text, /^@priya: /);
  assert.match(wf.nodes[1].text, /extract the invoice total/);
  await assert.rejects(cmd(h, "client-folders", "add", "Nope :: " + path.join(h.root, "missing")), /no such folder/);
  const p = h.plugins.list().find((x) => x.id === "client-folders");
  // a run of that workflow → a card owned by the client's agent
  h.plugins.onEvent({ type: "workflow.run", run: { id: "r9", workflowId: "client-acme", state: "running", trigger: { data: { name: "brief.pdf" } } } });
  const card = h.tasks.bySource("client-file", "r9");
  assert.ok(card && card.owner === "priya" && card.status === "doing");
  h.plugins.onEvent({ type: "workflow.run", run: { id: "r9", workflowId: "client-acme", state: "done" } });
  assert.strictEqual(h.tasks.get(card.id).status, "done");
  await cmd(h, "client-folders", "remove", "Acme");
  assert.strictEqual(h.triggers.get(r.client.triggerId), null);
});

test("library: github-triage installs a webhook-triggered workflow with an approval in front of the post", async () => {
  const h = host(); install(h, "github-triage");
  const r = await cmd(h, "github-triage", "setup", "bagidea/bagidea-office :: s3cret");
  assert.match(r.url, /\/hook\/[0-9a-f]{24}$/);
  assert.strictEqual(r.hasSecret, true);
  const wf = h.workflows.load(r.workflowId);
  const types = wf.nodes.map((n) => n.type);
  assert.deepStrictEqual(types, ["trigger", "decision", "action", "approval", "action", "notify"]);
  assert.ok(wf.edges.find((e) => e.from === "d" && e.label === "yes"));
  const t = h.triggers.list().find((x) => x.workflowId === r.workflowId);
  assert.strictEqual(t.cfg.secret, "•••", "the secret never comes back out");
  await assert.rejects(cmd(h, "github-triage", "setup", "not a repo"), /setup <owner\/repo>/);
});

test("library: content-pipeline parses RSS and Atom, follows a feed with the rss kind, and its fetch node strips HTML", async () => {
  const h = host(); install(h, "content-pipeline");
  const mod = require(path.join(h.root, "plugins", "content-pipeline", "index.js"));
  // reach the parser through a second, bare instance (the host's instance is wired already)
  const bare = mod({ ...h.plugins.__ctx || {}, dataDir: tmp(), daemonDir: path.join(ROOT, "daemon"), triggers: { register() {} }, workflow: { node() {}, save() {}, exists: () => true, start() {}, runs: () => [] }, log() {} });
  const rss = bare._parseFeed(`<rss><channel><item><title>Hello &amp; welcome</title><link>https://x.y/a</link><guid>g1</guid><description><![CDATA[<p>Body <b>here</b></p>]]></description></item></channel></rss>`);
  assert.deepStrictEqual([rss[0].id, rss[0].title, rss[0].link, rss[0].summary], ["g1", "Hello & welcome", "https://x.y/a", "Body here"]);
  const atom = bare._parseFeed(`<feed><entry><id>e1</id><title>Atom one</title><link href="https://x.y/b"/><summary>S</summary></entry></feed>`);
  assert.deepStrictEqual([atom[0].id, atom[0].link], ["e1", "https://x.y/b"]);
  // the feed comes from a local server so the first poll (which primes the seen
  // list) never touches the network
  const http = require("http");
  const feedSrv = http.createServer((q, s) => { s.setHeader("content-type", "application/rss+xml"); s.end("<rss><channel><item><title>First</title><link>https://x.y/1</link><guid>g1</guid></item></channel></rss>"); });
  await new Promise((r) => feedSrv.listen(0, "127.0.0.1", r));
  const feedUrl = "http://127.0.0.1:" + feedSrv.address().port + "/feed.xml";
  const f = await cmd(h, "content-pipeline", "follow", feedUrl + " :: 15 :: witty");
  const t = h.triggers.get(f.feed.triggerId);
  assert.deepStrictEqual([t.kind, t.cfg.url, t.cfg.everyMin], ["rss", feedUrl, 15]);
  // the first poll runs asynchronously — wait for it to land on disk (a slow CI runner needs more than a tick)
  const seenFile = path.join(h.root, "plugins", "content-pipeline", "data", "seen.json");
  await new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fs.existsSync(seenFile)) { clearInterval(i); res(); } else if (Date.now() - t0 > 5000) { clearInterval(i); rej(new Error("the first feed poll never wrote seen.json")); } }, 25); });
  h.triggers.stopAll(); feedSrv.close();
  const seen = JSON.parse(fs.readFileSync(seenFile, "utf8"));
  assert.deepStrictEqual(seen[t.id], { ids: ["g1"], primed: true }, "the first poll primes the seen list and fires nothing");
  assert.ok(h.workflows.exists("content-pipeline"));
  assert.match(h.workflows.load("content-pipeline").nodes.find((n) => n.id === "d").text, /witty/);
  // the fetch node against a local server
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end("<html><head><title>T &amp; T</title><style>x{}</style></head><body><nav>menu</nav><article><h1>Head</h1><p>Real text.</p></article></body></html>"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const impl = h.workflows.nodeTypes().find((n) => n.kind === "fetch-article");
  assert.ok(impl);
  const run = h.workflows.start({ id: "w", name: "W", nodes: [{ id: "t", type: "trigger" }, { id: "f", type: "fetch-article", text: "http://127.0.0.1:" + srv.address().port + "/a" }], edges: [{ from: "t", to: "f" }] });
  await new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const r = h.workflows.getRun(run.id); if (r.state !== "running") { clearInterval(i); res(); } else if (Date.now() - t0 > 4000) { clearInterval(i); rej(new Error("timeout")); } }, 15); });
  srv.close();
  const out = h.workflows.getRunFull(run.id).nodes.f.output;
  assert.strictEqual(out.title, "T & T");
  assert.match(out.text, /Head Real text\./);
  assert.ok(!/menu/.test(out.text), "nav is stripped");
});

test("library: campaign-board plans a card on the board, drafts through an agent turn, asks approval, and marks published on drag-to-done", async () => {
  const h = host(); install(h, "campaign-board");
  const a = await cmd(h, "campaign-board", "add", "2026-10-01 :: bluesky :: Launch day :: the point: v2 is out");
  assert.strictEqual(a.post.state, "planned");
  const card = h.tasks.get(a.post.taskId);
  assert.ok(card && /bluesky: Launch day/.test(card.title) && card.due > 0);
  const d = await cmd(h, "campaign-board", "draft", a.post.id);
  assert.strictEqual(d.post.state, "drafted");
  assert.match(d.post.copy, /Draft copy/);
  assert.match(h.claude[0], /bluesky post/);
  const ap = await cmd(h, "campaign-board", "approve", a.post.id);
  assert.strictEqual(ap.post.state, "approved");
  assert.strictEqual(h.asked.length, 1);
  assert.match(h.asked[0].title, /Publish on bluesky/);
  await assert.rejects(cmd(h, "campaign-board", "add", "tomorrow :: x :: y"), /add <YYYY-MM-DD>/);
  h.tasks.move(a.post.taskId, "done");
  h.plugins.onEvent({ type: "work.done", item: h.tasks.get(a.post.taskId) });
  const l = await cmd(h, "campaign-board", "list", "all");
  assert.strictEqual(l.posts[0].state, "published");
});

test("library: inbox-agent schedules a check and its workflow keeps every send behind an approval", async () => {
  const h = host(); install(h, "inbox-agent");
  const r = await cmd(h, "inbox-agent", "setup", "45 :: priya :: never promise refunds");
  assert.deepStrictEqual([r.everyMin, r.agent], [45, "priya"]);
  const wf = h.workflows.load("inbox-agent");
  const ap = wf.nodes.find((n) => n.type === "approval"), send = wf.nodes.find((n) => n.id === "s");
  assert.ok(ap && wf.edges.some((e) => e.from === ap.id && e.to === send.id), "the send step follows the approval");
  assert.match(send.text, /^@priya: /);
  assert.match(wf.nodes.find((n) => n.id === "c").text, /never promise refunds/);
  assert.strictEqual(h.triggers.list().find((t) => t.workflowId === "inbox-agent").cfg.everyMin, 45);
  await cmd(h, "inbox-agent", "off", "");
  assert.strictEqual(h.triggers.list().filter((t) => t.workflowId === "inbox-agent").length, 0);
});

// ---- teams ----------------------------------------------------------------------
const teamFiles = fs.readdirSync(TEAMS).filter((f) => f.endsWith(".json"));
const BUILTIN_SKILLS = Object.keys(require("../constants").SKILL_LIBRARY || {}).length
  ? Object.keys(require("../constants").SKILL_LIBRARY) : null;

test("teams: five templates, each well-formed, English, with real roles, avatars, voices and builtin skills", () => {
  assert.ok(teamFiles.length >= 5, "found " + teamFiles.join(", "));
  const roles = new Set(["Director", "Founder", "Researcher", "Engineer", "Designer", "Analyst", "Operator", "Specialist"]);
  const voices = new Set(["boyish", "clear", "genki", "sweet", "warm", "gentle", "cool", "deep", "lively", ""]);
  const lib = require("../constants").SKILL_LIBRARY;
  const skillIds = new Set(Array.isArray(lib) ? lib.map((s) => s.id) : Object.keys(lib || {}));
  const seen = new Set();
  for (const f of teamFiles) {
    const t = JSON.parse(fs.readFileSync(path.join(TEAMS, f), "utf8"));
    assert.strictEqual(t.id + ".json", f);
    assert.ok(t.name && t.tagline && t.for && t.agents.length >= 2, f + ": name, tagline, for, ≥2 agents");
    for (const a of t.agents) {
      assert.ok(!seen.has(a.id), "agent id " + a.id + " is unique across templates");
      seen.add(a.id);
      assert.ok(roles.has(a.role), `${f}/${a.id}: role ${a.role}`);
      assert.ok(a.avatar >= 1 && a.avatar <= 12, `${f}/${a.id}: avatar`);
      assert.ok(voices.has(a.voice || ""), `${f}/${a.id}: voice ${a.voice}`);
      assert.ok(a.persona && a.persona.expertise && a.persona.personality && a.persona.rules, `${f}/${a.id}: persona`);
      if (skillIds.size) for (const s of a.skills) assert.ok(skillIds.has(s), `${f}/${a.id}: unknown skill ${s}`);
      assert.ok(!THAI.test(JSON.stringify(a)), `${f}/${a.id}: English only`);
    }
  }
});

test("wiring: the daemon serves the library and team routes, hires without overwriting, and the CLI knows both", () => {
  for (const s of ['req.url === "/plugins/library"', 'req.url === "/plugins/library/install"', 'req.url === "/teams"', 'req.url === "/teams/hire"',
    "function pluginLibrary()", "function teamTemplates()", "function hireTeam(id)", "if (!aid || reg.agents[aid]) { skipped.push", "staffCount() >= MAX_STAFF", "team: t.id"])
    assert.ok(SERVER.includes(s), "server.js should contain: " + s);
  const CLI = fs.readFileSync(path.join(ROOT, "cli", "bagidea.js"), "utf8");
  for (const s of ['cmd === "teams"', 'cmd === "hire"', '"/plugins/library/install"', 'sub === "library"']) assert.ok(CLI.includes(s), "cli should contain: " + s);
  const OVERLAY = fs.readFileSync(path.join(ROOT, "daemon", "overlay.html"), "utf8");
  for (const s of ['id="plgLib"', 'id="hireTeam"', '"/teams/hire"', '"/plugins/library/install"']) assert.ok(OVERLAY.includes(s), "overlay should contain: " + s);
});
