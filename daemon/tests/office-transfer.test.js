"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const createTransfer = require("../office-transfer");
const zip = require("../office-zip");

function agent(name, extra = {}) { return { name, role: "Engineer", avatar: 2, prompt: "Work carefully", skills: [], tools: ["Read"], ...extra }; }
function fixture(t, patch = {}, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-transfer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace"), daemonDir = path.join(root, "daemon");
  fs.mkdirSync(workspace); fs.mkdirSync(daemonDir);
  const reg = { agents: { main: agent("Director", { protected: true }), ceo: agent("CEO", { protected: true, isUser: true }) }, roles: ["Director"], skills: {}, mcpServers: {}, sound: true, lang: "en", ...patch };
  fs.writeFileSync(path.join(daemonDir, "registry.json"), JSON.stringify(reg, null, 2));
  const transfer = createTransfer({ workspace, daemonDir, reg, ...opts });
  const write = (rel, text) => { const file = path.join(workspace, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  return { root, workspace, daemonDir, reg, transfer, write };
}
function source(t) {
  const f = fixture(t, { sound: false, roles: ["Engineer"], skills: { research: { name: "Research", description: "Read sources", content: "Find evidence." } }, skillTests: { research: [{ prompt: "what", expect: "evidence", note: "case" }] },
    mcpServers: { search: { command: "npx search-tool --token secret-command-value", args: ["--api-key", "secret-arg-value"], env: { API_TOKEN: "secret-env-value", REGION: "region-value" } } },
    triggers: [{ id: "weekly", kind: "schedule", workflowId: "research_flow", enabled: true, cfg: { everyMin: 60 }, lastRun: 100, runs: 7 }],
    apiKeys: { OPENAI_API_KEY: "secret-registry-value" }, providerConfig: { custom: { token: "provider-secret-value" } }, autoApprove: true, autoPilot: true, projectTrust: { local: "secret-trust" } });
  f.reg.agents.main.prompt = "Imported director customization";
  f.reg.agents.alice = agent("Alice", { skills: ["research"], tools: ["Read", "mcp:search"], team: "research-team", backend: "my-machine", protected: false });
  f.write("workflows/research_flow.json", JSON.stringify({ id: "research_flow", name: "Research", nodes: [{ id: "a", type: "action", text: "@alice: Find evidence", cfg: { agent: "alice" } }], edges: [] }));
  f.write("OFFICE.md", "# Office rules\nBe clear. secret-registry-value");
  f.write("settings/style.md", "# Style\nUse short sentences.");
  f.write("notes.md", "private note"); f.write("memory/alice.md", "private memory"); f.write("projects/project/MEMORY.md", "private project");
  f.write("agents/alice/.claude/skills/private/SKILL.md", "derived private skill");
  f.write(".claude/settings.json", '{"hooks":{"command":"never export"}}');
  return f;
}
function rewriteArchive(buffer, change) {
  const files = zip.decode(buffer), by = new Map(files.map((f) => [f.name, f]));
  const manifest = JSON.parse(by.get("manifest.json").data);
  const office = JSON.parse(by.get("office.json").data);
  change(office, files, manifest);
  by.get("office.json").data = Buffer.from(JSON.stringify(office));
  for (const f of files) {
    if (f.name === "manifest.json") continue;
    let desc = manifest.files.find((x) => x.path === f.name);
    if (!desc) { desc = { path: f.name, category: "settings" }; manifest.files.push(desc); }
    desc.size = f.data.length; desc.sha256 = crypto.createHash("sha256").update(f.data).digest("hex");
  }
  by.get("manifest.json").data = Buffer.from(JSON.stringify(manifest));
  return zip.encode(files);
}

test("ZIP round trip restores selected configuration and native skills, preserving destination secrets", (t) => {
  const src = source(t), dst = fixture(t, { apiKeys: { KEY: "destination-key" }, autoApprove: false, autoPilot: false, mcpServers: { search: { command: "npx local-tool --token destination-token", env: { API_TOKEN: "destination-env" } } } });
  const identity = dst.reg, archive = src.transfer.exportArchive();
  const plan = dst.transfer.previewArchive(archive);
  assert.equal(plan.categories.skills, 1); assert.equal(plan.categories.workflows, 2);
  const result = dst.transfer.importArchive(plan, { conflict: "replace" });
  assert.equal(result.ok, true); assert.equal(dst.reg, identity);
  assert.equal(dst.reg.agents.alice.name, "Alice"); assert.equal(dst.reg.agents.alice.backend, undefined);
  assert.equal(dst.reg.agents.main.prompt, "Imported director customization"); assert.equal(dst.reg.agents.main.protected, true);
  assert.equal(dst.reg.agents.ceo.isUser, true); assert.equal(dst.reg.sound, false);
  assert.equal(dst.reg.autoApprove, false); assert.equal(dst.reg.autoPilot, false); assert.equal(dst.reg.apiKeys.KEY, "destination-key");
  assert.equal(dst.reg.mcpServers.search.command, "npx local-tool --token destination-token");
  assert.equal(dst.reg.mcpServers.search.env.API_TOKEN, "destination-env"); assert.equal(dst.reg.mcpServers.search.env.REGION, "");
  assert.equal(dst.reg.triggers[0].enabled, false); assert.equal(dst.reg.triggers[0].runs, 0);
  assert.equal(dst.reg.skillTests.research.length, 1);
  assert.match(fs.readFileSync(path.join(dst.workspace, "agents/alice/.claude/skills/research/SKILL.md"), "utf8"), /Find evidence/);
  assert.match(fs.readFileSync(path.join(dst.workspace, "OFFICE.md"), "utf8"), /\[REDACTED\]/);
  assert.equal(fs.existsSync(path.join(dst.workspace, "notes.md")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst.daemonDir, "registry.json"))).agents.alice.name, "Alice");
});

test("exports credentials and machine/runtime exclusions without leaking them in Markdown", (t) => {
  const src = source(t), files = zip.decode(src.transfer.exportArchive()), text = files.map((f) => f.data.toString()).join("\n");
  for (const secret of ["secret-command-value", "secret-arg-value", "secret-env-value", "secret-registry-value", "provider-secret-value", "secret-trust", "region-value", "my-machine", "private note", "private memory", "private project", "derived private skill", "never export"]) assert.ok(!text.includes(secret), secret);
  assert.ok(files.some((f) => f.name === "skills/research/SKILL.md"));
  assert.ok(!files.some((f) => /notes|memory|agents|settings\.json/.test(f.name)));
});

test("selective import applies only chosen categories and skip never overwrites conflicts", (t) => {
  const src = source(t), dst = fixture(t, { skills: { research: { name: "Local", content: "Keep local" } } });
  dst.write("OFFICE.md", "Keep office");
  const plan = dst.transfer.previewArchive(src.transfer.exportArchive());
  const out = dst.transfer.importArchive(plan, { categories: ["skills", "settings"], conflict: "skip" });
  assert.equal(dst.reg.skills.research.content, "Keep local"); assert.equal(dst.reg.agents.alice, undefined);
  assert.equal(fs.readFileSync(path.join(dst.workspace, "OFFICE.md"), "utf8"), "Keep office");
  assert.equal(out.skipped.skills, 1); assert.equal(fs.existsSync(path.join(dst.workspace, "settings/style.md")), true);
});

test("deselected dependency categories fail before writing team profiles", (t) => {
  const src = source(t), dst = fixture(t), before = JSON.stringify(dst.reg);
  const plan = dst.transfer.previewArchive(src.transfer.exportArchive());
  assert.throws(() => dst.transfer.importArchive(plan, { categories: ["team"], conflict: "replace" }), /Select the Skills category/);
  assert.equal(JSON.stringify(dst.reg), before); assert.equal(fs.readdirSync(dst.workspace).length, 0);
});

test("human CEO, protected custom agents, and built-in skills are always preserved", (t) => {
  const src = source(t), dst = fixture(t, { skills: { research: { name: "Builtin local", content: "baseline", builtin: true } } });
  dst.reg.agents.alice = agent("Protected local", { protected: true });
  const archive = rewriteArchive(src.transfer.exportArchive(), (o) => { o.team.agents.ceo = agent("Forged owner", { isUser: false, protected: false }); });
  const plan = dst.transfer.previewArchive(archive);
  assert.equal(plan.entries.find((e) => e.id === "ceo").protected, true);
  dst.transfer.importArchive(plan, { conflict: "replace" });
  assert.equal(dst.reg.agents.ceo.name, "CEO"); assert.equal(dst.reg.agents.alice.name, "Protected local"); assert.equal(dst.reg.skills.research.content, "baseline");
});

test("invalid schema, prototype keys and unknown file types are rejected", (t) => {
  const src = source(t), dst = fixture(t), original = src.transfer.exportArchive();
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.version = 9; })), /version/);
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.team.agents.alice.avatar = "12"; })), /avatar/);
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { Object.defineProperty(o.team.agents.alice, "__proto__", { value: {}, enumerable: true }); })), /unsafe configuration key/);
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o, files) => { files.push({ name: "workspace/.claude/settings.json", data: Buffer.from("{}") }); })), /unsupported file/);
});

test("bad workflow edges, skill references and tool references fail validation", (t) => {
  const src = source(t), dst = fixture(t), original = src.transfer.exportArchive();
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.workflows.definitions.research_flow.edges.push({ from: "a", to: "missing" }); })), /missing node/);
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.team.agents.alice.skills = ["missing"]; })), /needs skill/);
  assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.team.agents.alice.tools = ["mcp:missing"]; })), /needs tool/);
});

test("staff cap aborts the complete import without filesystem changes", (t) => {
  const src = source(t), dst = fixture(t, {}, { maxStaff: 1 });
  assert.throws(() => dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive()), { conflict: "replace" }), /staff limit/);
  assert.equal(dst.reg.agents.alice, undefined); assert.deepEqual(fs.readdirSync(dst.workspace), []);
});

test("existing active triggers are disabled when their workflow is replaced", (t) => {
  const src = source(t), dst = fixture(t, { triggers: [{ id: "local-event", kind: "event", workflowId: "research_flow", enabled: true, cfg: { type: "task.completed" } }] });
  dst.reg.agents.alice = agent("Alice");
  dst.write("workflows/research_flow.json", JSON.stringify({ id: "research_flow", nodes: [], edges: [] }));
  const result = dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive(["workflows"])), { conflict: "replace" });
  assert.equal(dst.reg.triggers.find((t) => t.id === "local-event").enabled, false); assert.match(result.warnings.join(" "), /Disabled existing trigger/);
});

test("changed destinations and files newly appearing after preview require fresh preview", (t) => {
  const src = source(t), dst = fixture(t), archive = src.transfer.exportArchive(["settings"]);
  const plan = dst.transfer.previewArchive(archive); dst.write("settings/style.md", "Created since preview");
  assert.throws(() => dst.transfer.importArchive(plan, { conflict: "replace" }), /changed after preview/);
  assert.equal(dst.reg.sound, true); assert.equal(fs.readFileSync(path.join(dst.workspace, "settings/style.md"), "utf8"), "Created since preview");
});

test("runtime trigger counters do not invalidate an otherwise unchanged preview", (t) => {
  const src = source(t), dst = fixture(t, { triggers: [{ id: "weekly", name: "", kind: "schedule", workflowId: "research_flow", enabled: false, cfg: { everyMin: 60 }, runs: 1 }] });
  dst.reg.agents.alice = agent("Alice"); dst.write("workflows/research_flow.json", JSON.stringify({ id: "research_flow", nodes: [], edges: [] }));
  const plan = dst.transfer.previewArchive(src.transfer.exportArchive(["workflows"])); dst.reg.triggers[0].runs = 2;
  assert.equal(dst.transfer.importArchive(plan, { conflict: "replace" }).ok, true);
});

test("destination symlink ancestors reject before extraction including derived skill locations", (t) => {
  const src = source(t), dst = fixture(t), outside = path.join(dst.root, "outside"); fs.mkdirSync(outside);
  try { fs.symlinkSync(outside, path.join(dst.workspace, "agents"), process.platform === "win32" ? "junction" : "dir"); }
  catch (e) { if (["EPERM", "EACCES"].includes(e.code)) return t.skip("symlinks unavailable"); throw e; }
  const before = JSON.stringify(dst.reg), plan = dst.transfer.previewArchive(src.transfer.exportArchive());
  assert.throws(() => dst.transfer.importArchive(plan, { conflict: "replace" }), /symlink or junction/);
  assert.equal(JSON.stringify(dst.reg), before); assert.deepEqual(fs.readdirSync(outside), []);
});

test("Markdown junctions are omitted from exports", (t) => {
  const f = fixture(t), outside = path.join(f.root, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "secrets.md"), "never-export-me");
  try { fs.symlinkSync(outside, path.join(f.workspace, "settings"), process.platform === "win32" ? "junction" : "dir"); }
  catch (e) { if (["EPERM", "EACCES"].includes(e.code)) return t.skip("symlinks unavailable"); throw e; }
  assert.ok(!zip.decode(f.transfer.exportArchive(["settings"])).some((f) => f.data.includes("never-export-me")));
});

test("commit failure rolls back files, registry bytes, registry object and new directories", (t) => {
  const src = source(t), fakeFs = Object.create(fs); let applied = 0;
  fakeFs.renameSync = (...args) => { if (++applied === 3) throw new Error("injected rename failure"); return fs.renameSync(...args); };
  const dst = fixture(t, {}, { fs: fakeFs }); dst.write("OFFICE.md", "Original office");
  const beforeReg = JSON.stringify(dst.reg), beforeDisk = fs.readFileSync(path.join(dst.daemonDir, "registry.json"));
  assert.throws(() => dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive()), { conflict: "replace" }), /injected rename failure/);
  assert.equal(JSON.stringify(dst.reg), beforeReg); assert.deepEqual(fs.readFileSync(path.join(dst.daemonDir, "registry.json")), beforeDisk);
  assert.equal(fs.readFileSync(path.join(dst.workspace, "OFFICE.md"), "utf8"), "Original office");
  assert.deepEqual(fs.readdirSync(dst.workspace), ["OFFICE.md"]); assert.deepEqual(fs.readdirSync(dst.daemonDir), ["registry.json"]);
});

test("replacing skill assignments removes old generated instruction files transactionally", (t) => {
  const src = source(t), dst = fixture(t, { skills: { old: { name: "Old", content: "Old skill" } } });
  dst.reg.agents.alice = agent("Alice", { skills: ["old"] });
  dst.write("agents/alice/.claude/skills/.synced.json", '{"old":"oldhash"}'); dst.write("agents/alice/.claude/skills/old/SKILL.md", "Old skill");
  dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive()), { conflict: "replace" });
  assert.equal(fs.existsSync(path.join(dst.workspace, "agents/alice/.claude/skills/old/SKILL.md")), false);
  assert.ok(fs.existsSync(path.join(dst.workspace, "agents/alice/.claude/skills/research/SKILL.md")));
});

test("case-colliding destination IDs cannot share native skill directories", (t) => {
  const src = source(t), dst = fixture(t); dst.reg.agents.Alice = agent("Existing Alice");
  assert.throws(() => dst.transfer.previewArchive(src.transfer.exportArchive()), /collides with an existing ID/);
  assert.equal(dst.reg.agents.alice, undefined);
});

test("successful commit remains successful if temporary staging cleanup fails", (t) => {
  const src = source(t), fakeFs = Object.create(fs);
  fakeFs.rmSync = () => { throw new Error("cleanup failed"); };
  const dst = fixture(t, {}, { fs: fakeFs });
  const result = dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive()), { conflict: "replace" });
  assert.equal(result.ok, true); assert.equal(dst.reg.agents.alice.name, "Alice");
  assert.match(result.warnings.join(" "), /temporary staging files/);
});

test("custom plugin triggers preserve sanitized configuration and remain disabled", (t) => {
  const src = source(t), dst = fixture(t);
  src.reg.triggers.push({ id: "feed", name: "RSS feed", kind: "rss", workflowId: "research_flow", enabled: true, cfg: { url: "https://example.com/feed?key=hidden-source-key", everyMin: 15, token: "never-copy-token", dir: "C:\\local\\path" } });
  const plan = dst.transfer.previewArchive(src.transfer.exportArchive());
  assert.match(plan.warnings.join(" "), /matching plugin/);
  dst.transfer.importArchive(plan, { conflict: "replace" });
  const imported = dst.reg.triggers.find((x) => x.id === "feed");
  assert.equal(imported.kind, "rss"); assert.equal(imported.enabled, false); assert.equal(imported.cfg.everyMin, 15);
  assert.equal(imported.cfg.token, undefined); assert.equal(imported.cfg.dir, undefined); assert.ok(!imported.cfg.url.includes("hidden-source-key"));
});

test("MCP env names survive sanitization and bare token assignments are redacted", (t) => {
  const src = fixture(t, { mcpServers: { demo: { command: "TOKEN=hidden-token npx demo --api-key hidden-api", env: { API_KEY: "hidden-env", TOKEN: "another-hidden-env" } } } });
  const archive = src.transfer.exportArchive(["mcp"]), config = JSON.parse(zip.decode(archive).find((f) => f.name === "office.json").data);
  assert.deepEqual(config.mcp.servers.demo.env, { API_KEY: "", TOKEN: "" });
  assert.ok(!config.mcp.servers.demo.command.includes("hidden-token")); assert.ok(!config.mcp.servers.demo.command.includes("hidden-api"));
});

test("MCP URL credentials in the destination are retained without sending them to a new endpoint", (t) => {
  const src = fixture(t, { mcpServers: { demo: { url: "https://different.example/mcp" } } });
  const dst = fixture(t, { mcpServers: { demo: { url: "https://user:local-secret@local.example/mcp" } } });
  dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive(["mcp"])), { conflict: "replace" });
  assert.equal(dst.reg.mcpServers.demo.url, "https://user:local-secret@local.example/mcp");
});

test("aggregate source Markdown size is bounded before reading all file bodies", (t) => {
  const fakeFs = Object.create(fs); let reads = 0;
  fakeFs.statSync = (file) => { const st = fs.statSync(file); if (String(file).endsWith(".md")) st.size = 7 * 1024 * 1024; return st; };
  fakeFs.readFileSync = (...args) => { if (String(args[0]).endsWith(".md")) reads++; return fs.readFileSync(...args); };
  const f = fixture(t, {}, { fs: fakeFs });
  for (let i = 0; i < 8; i++) f.write("settings/" + i + ".md", "small fixture");
  assert.throws(() => f.transfer.summary(), /Markdown files exceed/);
  assert.equal(reads, 4);
});

test("null and scalar values cannot masquerade as configuration lists or objects", (t) => {
  const src = source(t), dst = fixture(t), original = src.transfer.exportArchive();
  for (const malformed of [null, false, 0, ""]) {
    assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.team.agents.alice.skills = malformed; })), /agent skills/);
    assert.throws(() => dst.transfer.previewArchive(rewriteArchive(original, (o) => { o.team.agents.alice.persona = malformed; })), /persona/);
  }
});

test("Codex and shared agent Markdown instructions are restored to their working folders", (t) => {
  const src = fixture(t), dst = fixture(t);
  src.write(".codex/settings/personal.md", "# Personal preferences"); src.write(".agents/rules/review.md", "# Review instructions");
  dst.transfer.importArchive(dst.transfer.previewArchive(src.transfer.exportArchive(["settings"])), { conflict: "replace" });
  assert.equal(fs.readFileSync(path.join(dst.workspace, ".codex/settings/personal.md"), "utf8"), "# Personal preferences");
  assert.equal(fs.readFileSync(path.join(dst.workspace, ".agents/rules/review.md"), "utf8"), "# Review instructions");
});

test("summary lists every exportable item with its dependencies, matching the category counts", (t) => {
  const src = source(t), s = src.transfer.summary(), ids = (c) => s.items[c].map((i) => i.id);
  for (const c of createTransfer.CATEGORIES) assert.equal(s.items[c].length, s.categories[c], c);
  assert.deepEqual(ids("team").sort(), ["alice", "main", "roles:all"]);
  assert.deepEqual(s.items.team.find((i) => i.id === "alice").needs, ["skills:research", "mcp:search"]);
  assert.deepEqual(s.items.workflows.find((i) => i.id === "research_flow").needs, ["team:alice"]);
  const trigger = s.items.workflows.find((i) => i.id === "trigger:weekly");
  assert.equal(trigger.parent, "research_flow"); assert.deepEqual(trigger.needs, ["workflows:research_flow"]);
  assert.deepEqual(ids("settings").sort(), ["markdown:OFFICE.md", "markdown:settings/style.md", "preferences"]);
  assert.ok(!JSON.stringify(s.items).includes("secret"));
});

test("per-item export keeps only the chosen items and imports cleanly", (t) => {
  const src = source(t), dst = fixture(t);
  const archive = src.transfer.exportArchive(["team", "skills", "mcp", "settings"], { team: ["alice"], settings: ["markdown:settings/style.md"] });
  const files = zip.decode(archive), office = JSON.parse(files.find((f) => f.name === "office.json").data);
  assert.deepEqual(Object.keys(office.team.agents), ["alice"]); assert.deepEqual(office.team.roles, []);
  assert.deepEqual(Object.keys(office.skills.definitions), ["research"]);
  assert.deepEqual(office.settings.preferences, {});
  assert.deepEqual(files.filter((f) => f.name.startsWith("workspace/")).map((f) => f.name), ["workspace/settings/style.md"]);
  const plan = dst.transfer.previewArchive(archive);
  assert.equal(plan.categories.team, 1); assert.equal(plan.categories.settings, 1);
  const out = dst.transfer.importArchive(plan, { conflict: "skip" });
  assert.equal(out.imported.team, 1); assert.equal(dst.reg.agents.alice.name, "Alice");
  assert.deepEqual(dst.reg.roles, ["Director"]);
  assert.equal(fs.existsSync(path.join(dst.workspace, "OFFICE.md")), false);
  assert.equal(fs.readFileSync(path.join(dst.workspace, "settings/style.md"), "utf8"), "# Style\nUse short sentences.");
});

test("per-item export keeps triggers with their workflow and drops deselected ones", (t) => {
  const src = source(t), office = (a) => JSON.parse(zip.decode(a).find((f) => f.name === "office.json").data);
  assert.deepEqual(office(src.transfer.exportArchive(["workflows"], { workflows: ["research_flow"] })).workflows.triggers, []);
  const both = office(src.transfer.exportArchive(["workflows"], { workflows: ["research_flow", "trigger:weekly"] })).workflows;
  assert.deepEqual(both.triggers.map((x) => [x.id, x.enabled]), [["weekly", false]]);
  assert.throws(() => src.transfer.exportArchive(["workflows"], { workflows: ["trigger:weekly"] }), /needs workflow research_flow/);
});

test("per-item export rejects stale, empty and out-of-scope selections", (t) => {
  const src = source(t);
  assert.throws(() => src.transfer.exportArchive(["team"], { team: ["bob"] }), /no longer in team/);
  assert.throws(() => src.transfer.exportArchive(["team"], { skills: ["research"] }), /not selected: skills/);
  assert.throws(() => src.transfer.exportArchive(["team"], { team: [] }), /at least one item in team/);
  assert.throws(() => src.transfer.exportArchive(["team"], { team: "alice" }), /bounded list/);
  assert.throws(() => src.transfer.exportArchive(["team"], ["alice"]), /item selection must be an object/);
  assert.throws(() => src.transfer.exportArchive(["team"], { team: ["ceo"] }), /no longer in team/);
});

test("items whose IDs read like credential words are still listed, exported and importable", (t) => {
  const src = fixture(t, { skills: { env: { name: "Env", description: "Environment notes", content: "Keep .env files local." }, cookie: { name: "Cookie", description: "c", content: "Bake." } },
    mcpServers: { token: { command: "npx token-tool" } },
    triggers: [{ id: "nightly", kind: "schedule", workflowId: "secret", enabled: true, cfg: { everyMin: 60 } }] });
  src.reg.agents.key = agent("Key", { skills: ["cookie"] });
  src.write("workflows/secret.json", JSON.stringify({ id: "secret", name: "Secret santa", nodes: [{ id: "a", type: "action", text: "@key: Draw names" }], edges: [] }));
  const s = src.transfer.summary(), ids = (c) => s.items[c].map((i) => i.id).sort();
  assert.ok(ids("team").includes("key")); assert.deepEqual(ids("skills"), ["cookie", "env"]);
  assert.deepEqual(ids("mcp"), ["token"]); assert.deepEqual(ids("workflows"), ["secret", "trigger:nightly"]);
  const archive = src.transfer.exportArchive(["team", "skills", "mcp", "workflows"], { team: ["key"], skills: ["cookie", "env"], workflows: ["secret", "trigger:nightly"] });
  const office = JSON.parse(zip.decode(archive).find((f) => f.name === "office.json").data);
  assert.equal(office.skills.definitions.env.content, "Keep .env files local.");
  assert.deepEqual(Object.keys(office.workflows.definitions), ["secret"]);
  const dst = fixture(t), out = dst.transfer.importArchive(dst.transfer.previewArchive(archive), { conflict: "skip" });
  assert.equal(out.imported.workflows, 2); assert.equal(dst.reg.agents.key.name, "Key"); assert.equal(dst.reg.mcpServers.token.command, "npx token-tool");
});

test("a Markdown file with a long path can be picked by its summary ID", (t) => {
  const src = fixture(t), rel = "rules/" + "a".repeat(150) + "/" + "b".repeat(150) + "/" + "c".repeat(150) + "/" + "d".repeat(140) + ".md";
  try { src.write(rel, "# Deep rule"); } catch (e) { t.skip("filesystem rejects long paths: " + e.code); return; }
  const target = src.transfer.summary().items.settings.find((i) => i.id === "markdown:" + rel);
  assert.ok(target && target.id.length > 600);
  const files = zip.decode(src.transfer.exportArchive(["settings"], { settings: [target.id] }));
  assert.deepEqual(files.filter((f) => f.name.startsWith("workspace/")).map((f) => f.name), ["workspace/" + rel]);
});
