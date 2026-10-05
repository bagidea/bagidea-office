"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const installer = require("../../scripts/install-research-harness");
const native = require("../skills");
const copy = value => JSON.parse(JSON.stringify(value));
const CONFIG = { extendSkills: ["requirements-review", "evidence-review"], files: ["workspace/OFFICE.md"], environmentRef: "workspace/ENVIRONMENT_POLICY.md" };

function fixture(root = path.resolve("test-office"), ids = ["main", "researcher", "operator"]) {
  const agents = { ceo: { name: "CEO", isUser: true, skills: [], persona: { rules: "Owner unchanged" } } };
  for (const id of ids) agents[id] = { name: id, role: "Employee", avatar: 1, aura: "", prompt: "Preserve original prompt.",
    persona: { expertise: "Expert", personality: "Calm", language: "Follow OWNER", rules: "Preserve existing limits." },
    tier: 2, voice: "", skills: [...CONFIG.extendSkills], tools: ["authorized-tool"], provider: "ollama",
    model: "unchanged-model", backend: "local", memoryPlugins: [], customField: { keep: true } };
  const skills = Object.fromEntries(CONFIG.extendSkills.map(id => [id, { name: id, description: "Existing skill", content: "Read workspace/OFFICE.md. Keep all existing rules.", edited: true, customMeta: "keep" }]));
  skills.unrelated = { name: "unrelated", content: "untouched", description: "Untouched" };
  const registry = { agents, skills, providerConfig: { confidential: "NEVER_BACK_UP_THIS" }, apiKeys: { secret: "NEVER_BACK_UP_THIS" } };
  const files = Object.fromEntries([...CONFIG.files, CONFIG.environmentRef].map(file => [file, "# Existing instructions\n\nPreserve this text.\n"]));
  files[installer.SOURCE] = "---\nname: co-pre-design-research\ndescription: Current research before relevant designs.\n---\n\nRead docs/research/RESEARCH_PROTOCOL.md and the active brief.\n";
  return { registry, files, root, ids, config: copy(CONFIG) };
}

test("plan changes only persona rules and skill assignments, never CEO/model/tools", () => {
  const input = fixture(), before = copy(input.registry);
  const plan = installer.buildPlan(input.registry, input.files, input.root, input.config);
  assert.deepEqual(input.registry, before, "pure plan must not mutate input");
  assert.equal(plan.ids.length, 3);
  assert.equal(plan.agentChanges.length, 3);
  assert.equal(plan.skills["requirements-review"].customMeta, "keep");
  assert.deepEqual(plan.afterAgents.ceo, before.agents.ceo);
  assert.ok(installer.RULE.length <= 500);
  for (const id of plan.ids) {
    const actual = plan.afterAgents[id], original = before.agents[id];
    assert.equal(actual.model, original.model);
    assert.deepEqual(actual.tools, original.tools);
    assert.equal(actual.prompt, original.prompt);
    assert.deepEqual(actual.persona.expertise, original.persona.expertise);
    assert.deepEqual({ ...actual, persona: original.persona, skills: original.skills }, original);
    assert.ok(actual.persona.rules.startsWith(original.persona.rules));
  }
  assert.equal(plan.afterAgents.ceo.skills.includes(installer.SKILL_ID), false);
});

test("a second plan is idempotent for all agent, skill and local file updates", () => {
  const input = fixture(), first = installer.buildPlan(input.registry, input.files, input.root, input.config);
  const second = installer.buildPlan({ ...input.registry, agents: first.afterAgents, skills: first.afterSkills },
    { ...input.files, ...first.fileChanges }, input.root, input.config);
  assert.deepEqual(second.agentChanges, []);
  assert.deepEqual(second.skillChanges, []);
  assert.deepEqual(second.changedFiles, []);
  assert.equal(second.afterAgents.main.persona.rules.split("[Research gate]").length, 2);
});

test("overflow refuses the complete plan without truncating profile or skill text", () => {
  for (const variant of ["rules", "prompt", "skill"]) {
    const input = fixture();
    if (variant === "rules") input.registry.agents.main.persona.rules = "r".repeat(1900);
    if (variant === "prompt") input.registry.agents.main.prompt = "p".repeat(8001);
    if (variant === "skill") input.registry.skills["requirements-review"].content = "s".repeat(3999);
    const before = copy(input.registry);
    assert.throws(() => installer.buildPlan(input.registry, input.files, input.root, input.config), /refusing truncation/);
    assert.deepEqual(input.registry, before);
  }
});

test("rejects unexpected roster, protected skills, malformed markers and lossy API normalization", () => {
  const input = fixture();
  assert.throws(() => installer.buildPlan(input.registry, input.files, input.root, { expectedCount: 4 }), /Expected 4/);
  input.registry.skills["requirements-review"].builtin = true;
  assert.throws(() => installer.buildPlan(input.registry, input.files, input.root, input.config), /Protected built-in/);
  delete input.registry.skills["requirements-review"].builtin;
  input.registry.agents.main.persona.extra = "Cannot drop this";
  assert.throws(() => installer.buildPlan(input.registry, input.files, input.root), /normalize unrelated/);
  assert.throws(() => installer.appendBlock("<!-- office-pre-design-research-v1:start -->", "new"), /Malformed/);
});

test("absolute skill references stay absolute on repeated application", () => {
  const root = path.resolve("test-office"), source = "Read workspace/OFFICE.md and `docs/research/RESEARCH_PROTOCOL.md`; run scripts/research-gate.js.";
  const once = installer.absoluteReferences(source, root);
  assert.ok(once.includes(root.replaceAll("\\", "/") + "/workspace/OFFICE.md"));
  assert.equal(installer.absoluteReferences(once, root), once);
});

test("generated CLI instructions quote roots containing spaces and remain idempotent", () => {
  const root = path.resolve("test offices", "My Office"), source = "Run `node scripts/research-gate.js check packet.json` or node scripts/research-catalog.js.";
  const once = installer.absoluteReferences(source, root), prefix = root.replaceAll("\\", "/");
  assert.ok(once.includes('node "' + prefix + '/scripts/research-gate.js" check'));
  assert.ok(once.includes('node "' + prefix + '/scripts/research-catalog.js".'));
  assert.equal(installer.absoluteReferences(once, root), once);
});

async function sandbox(t, ids) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-research-installer-"));
  t.after(() => { const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true }); });
  const data = fixture(root, ids);
  for (const [file, content] of Object.entries(data.files)) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  for (const id of data.ids) native.syncAgent(path.join(root, "workspace/agents"), id, data.registry.agents[id].skills, data.registry.skills);
  const calls = [];
  const api = async (route, body) => {
    calls.push({ route, body: copy(body ?? null) });
    if (route === "/health") return { ok: true };
    if (route === "/registry" && body === undefined) return copy(data.registry);
    if (route === "/registry/skill") { const { id, ...fields } = body; data.registry.skills[id] = { ...(data.registry.skills[id] || {}), ...fields, edited: true }; return "ok"; }
    if (route === "/registry/agent") { const { id, ...fields } = body; data.registry.agents[id] = { ...data.registry.agents[id], ...fields }; return { id }; }
    throw new Error("Forbidden route: " + route);
  };
  return { ...data, calls, api };
}

test("default plan is read-only; offline apply verifies files and saves only selected backup data", async t => {
  const input = await sandbox(t), before = copy(input.registry);
  const planned = await installer.run({ root: input.root, api: input.api, config: input.config });
  assert.equal(planned.mode, "plan");
  assert.ok(input.calls.every(call => call.body === null));
  assert.equal(fs.existsSync(path.join(input.root, "workspace/backups")), false);
  const result = await installer.run({ root: input.root, api: input.api, config: input.config, apply: true });
  assert.equal(result.status, "installed");
  assert.equal(result.verifiedEmployees, 3);
  const backupText = fs.readFileSync(path.join(result.backup, "previous.json"), "utf8"), backup = JSON.parse(backupText);
  assert.equal(backupText.includes("NEVER_BACK_UP_THIS"), false);
  for (const agent of Object.values(backup.agents)) assert.deepEqual(Object.keys(agent).sort(), ["persona", "skills"]);
  assert.deepEqual(input.registry.agents.ceo, before.agents.ceo);
  assert.equal(input.registry.agents.main.model, before.agents.main.model);
  assert.deepEqual(input.registry.agents.main.tools, before.agents.main.tools);
  assert.ok(fs.readFileSync(path.join(input.root, "workspace/agents/main/.claude/skills/co-pre-design-research/SKILL.md"), "utf8").includes("RESEARCH_PROTOCOL.md"));
  assert.ok(input.calls.filter(call => call.body !== null).every(call => ["/registry/skill", "/registry/agent"].includes(call.route)));
  const again = await installer.run({ root: input.root, api: input.api, config: input.config });
  assert.equal(again.changedEmployees, 0); assert.equal(again.changedSkills, 0); assert.equal(again.changedFiles, 0);
});

test("failed or uncertain API write records a failure and never automatically retries", async t => {
  const input = await sandbox(t); let writes = 0;
  const api = async (route, body) => { if (route === "/registry/skill") { writes++; throw new Error("Simulated uncertain response"); } return input.api(route, body); };
  await assert.rejects(installer.run({ root: input.root, api, apply: true }), /Simulated uncertain/);
  const report = JSON.parse(fs.readFileSync(path.join(input.root, "workspace/research/research-install-report.json"), "utf8"));
  assert.equal(report.status, "incomplete");
  assert.equal(report.steps[0].status, "failed-or-uncertain");
  assert.equal(writes, 1);
});

test("default installation supports different office roots and rosters without private harness prerequisites", async t => {
  for (const ids of [["main"], ["main", "writer", "tester", "coordinator"]]) {
    const input = await sandbox(t, ids), before = copy(input.registry);
    for (const file of [...CONFIG.files, CONFIG.environmentRef]) fs.unlinkSync(path.join(input.root, file));
    const result = await installer.run({ root: input.root, api: input.api, apply: true });
    assert.equal(result.verifiedEmployees, ids.length);
    for (const id of ids) {
      assert.deepEqual(input.registry.agents[id].skills, [...before.agents[id].skills, installer.SKILL_ID]);
      const text = fs.readFileSync(path.join(input.root, "workspace/agents", id, ".claude/skills", installer.SKILL_ID, "SKILL.md"), "utf8");
      assert.ok(text.includes(input.root.replaceAll("\\", "/") + "/docs/research/RESEARCH_PROTOCOL.md"));
      assert.ok(!text.includes("office-harness"));
    }
    for (const id of CONFIG.extendSkills) assert.deepEqual(input.registry.skills[id], before.skills[id]);
    assert.equal(fs.existsSync(path.join(input.root, "workspace/office-harness")), false);
    assert.equal(fs.existsSync(path.join(input.root, "workspace/OFFICE.md")), false);
    const again = await installer.run({ root: input.root, api: input.api });
    assert.equal(again.changedEmployees + again.changedSkills + again.changedFiles, 0);
  }
});

test("explicit selection changes only the chosen employees, skills and Markdown files", async t => {
  const input = await sandbox(t), before = copy(input.registry);
  const config = { ...input.config, agentIds: ["researcher"], expectedCount: 1, extendSkills: ["evidence-review"] };
  await installer.run({ root: input.root, api: input.api, apply: true, config });
  assert.deepEqual(input.registry.agents.main, before.agents.main);
  assert.deepEqual(input.registry.agents.operator, before.agents.operator);
  assert.deepEqual(input.registry.skills["requirements-review"], before.skills["requirements-review"]);
  assert.ok(input.registry.skills["evidence-review"].content.includes("ENVIRONMENT_POLICY.md"));
  assert.ok(fs.readFileSync(path.join(input.root, "workspace/OFFICE.md"), "utf8").includes("Research before design"));
  assert.equal(fs.readFileSync(path.join(input.root, CONFIG.environmentRef), "utf8"), input.files[CONFIG.environmentRef]);
  assert.equal(fs.existsSync(path.join(input.root, "workspace/agents/main/.claude/skills", installer.SKILL_ID)), false);
});

test("config refuses unknown targets and unsafe or missing explicit file references", () => {
  const input = fixture();
  for (const config of [
    { agentIds: ["ceo"] }, { agentIds: ["absent"] }, { agentIds: [] }, { agentIds: ["main", "main"] },
    { extendSkills: ["missing"] }, { extendSkills: ["__proto__"] }, { files: ["workspace/../daemon/server.md"] },
    { files: ["C:/outside.md"] }, { files: ["workspace/missing.md"] }, { environmentRef: "workspace/missing.md" },
    { expectedCount: 0 }, { typo: true }
  ]) assert.throws(() => installer.buildPlan(input.registry, input.files, input.root, config), JSON.stringify(config));
});

test("CLI selects root/config and accepts only loopback daemon origins", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-installer-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "install.json"); fs.writeFileSync(file, JSON.stringify({ agentIds: ["writer"] }));
  const options = installer.cliOptions(["--plan", "--root", dir, "--url", "http://127.0.0.1:18787", "--config", file]);
  assert.equal(options.root, dir); assert.equal(options.apply, false);
  assert.deepEqual(options.config, { agentIds: ["writer"] }); assert.equal(typeof options.api, "function");
  for (const url of ["https://example.com", "http://192.168.1.2", "http://user:secret@localhost", "http://localhost/private", "http://localhost/?q=1"]) assert.throws(() => installer.requestAt(url), /loopback/);
  for (const args of [["--apply", "--plan"], ["--root"], ["--apply", "--apply"], ["--unknown"]]) assert.throws(() => installer.cliOptions(args));
});

test("custom loopback port carries the UI marker and never follows redirects", async t => {
  const http = require("node:http"), calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, marker: req.headers["x-bagidea-ui"] });
    if (req.url === "/redirect") { res.writeHead(302, { location: "/private" }); return res.end(); }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const api = installer.requestAt("http://127.0.0.1:" + server.address().port);
  assert.deepEqual(await api("/health"), { ok: true });
  await assert.rejects(api("/redirect"));
  assert.deepEqual(calls, [{ url: "/health", marker: "1" }, { url: "/redirect", marker: "1" }]);
});
