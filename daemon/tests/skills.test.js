const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("../skills");

const SKILLS = {
  "deep-research": { name: "Deep Research", description: "Methodical web research into a sourced brief.", content: "1. Restate.\n2. Search.\n3. Cross-check." },
  "office-ops": { name: "Office Operations", description: "Run the office well.", content: "Delegate with DELEGATE: lines." },
};

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-skills-")); }

test("syncAgent writes a SKILL.md per assigned skill with frontmatter", () => {
  const root = tmp();
  const r = S.syncAgent(root, "shino", ["deep-research", "office-ops"], SKILLS);
  assert.strictEqual(r.wrote, 2);
  const f = path.join(S.skillsRoot(root, "shino"), "deep-research", "SKILL.md");
  assert.ok(fs.existsSync(f));
  const body = fs.readFileSync(f, "utf8");
  assert.match(body, /^---\nname: Deep Research\ndescription: Methodical web research into a sourced brief\.\n---/);
  assert.match(body, /Restate/);
  // --add-dir target is the agent dir whose .claude/skills child holds these
  assert.strictEqual(S.agentDir(root, "shino"), path.join(root, "shino"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("syncAgent is hash-gated: unchanged second run rewrites nothing", () => {
  const root = tmp();
  S.syncAgent(root, "shino", ["deep-research"], SKILLS);
  const r2 = S.syncAgent(root, "shino", ["deep-research"], SKILLS);
  assert.strictEqual(r2.wrote, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("syncAgent rewrites when a skill's content changes", () => {
  const root = tmp();
  S.syncAgent(root, "shino", ["deep-research"], SKILLS);
  const changed = { ...SKILLS, "deep-research": { ...SKILLS["deep-research"], content: "1. New steps." } };
  const r = S.syncAgent(root, "shino", ["deep-research"], changed);
  assert.strictEqual(r.wrote, 1);
  assert.match(fs.readFileSync(path.join(S.skillsRoot(root, "shino"), "deep-research", "SKILL.md"), "utf8"), /New steps/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("syncAgent prunes a skill dir once it's unassigned", () => {
  const root = tmp();
  S.syncAgent(root, "shino", ["deep-research", "office-ops"], SKILLS);
  const r = S.syncAgent(root, "shino", ["deep-research"], SKILLS); // dropped office-ops
  assert.strictEqual(r.pruned, 1);
  assert.ok(fs.existsSync(path.join(S.skillsRoot(root, "shino"), "deep-research")));
  assert.ok(!fs.existsSync(path.join(S.skillsRoot(root, "shino"), "office-ops")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("syncAll covers every agent in the roster", () => {
  const root = tmp();
  const agents = { shino: { skills: ["deep-research"] }, sahara: { skills: ["office-ops"] }, ceo: { skills: [] } };
  const r = S.syncAll(root, agents, SKILLS);
  assert.strictEqual(r.wrote, 2);
  assert.ok(fs.existsSync(path.join(S.skillsRoot(root, "shino"), "deep-research", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(S.skillsRoot(root, "sahara"), "office-ops", "SKILL.md")));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── canRefine: who may rewrite a skill's instructions ────────────────────
// The office revises its own skills after a task teaches it one was wrong.
// This is the rule that decides which skills are in scope, and getting it
// wrong means the model quietly rewrites either the office's own contract or
// something a human wrote.
const { canRefine } = require("../skills");

test("canRefine: a skill the office wrote itself may be revised", () => {
  assert.strictEqual(canRefine({ auto: true, content: "x" }), true);
});

test("canRefine: a BUILTIN skill may never be revised", () => {
  // Builtins are the same in every office. A model rewriting one would fork
  // the product's behaviour on one person's machine.
  assert.strictEqual(canRefine({ builtin: true, content: "x" }), false);
  assert.strictEqual(canRefine({ builtin: true, auto: true, content: "x" }), false);
});

test("canRefine: once a human has edited it, it is theirs", () => {
  assert.strictEqual(canRefine({ auto: true, edited: true, content: "x" }), false);
});

test("canRefine: a hand-written skill is not auto, so it is out of scope", () => {
  assert.strictEqual(canRefine({ content: "x" }), false);
});

test("canRefine: nothing at all is not refinable", () => {
  assert.strictEqual(canRefine(null), false);
  assert.strictEqual(canRefine(undefined), false);
});
