"use strict";

// Optional research instructions installer. Default is a read-only plan.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const nativeSkills = require("../daemon/skills");

const SKILL_ID = "co-pre-design-research";
const EXISTING_SKILLS = []; // Extending existing skills is explicit in config.extendSkills.
const MARKER = "office-pre-design-research-v1";
const RULE = "[Research gate] Before relevant AI/technology designs invoke co-pre-design-research. The accountable Lead owns current primary-source research, local/open-source comparisons and a fresh, hashed design-gate packet. Staff research and report through their Lead. Follow the current environment policy; research does not authorize production.";
const SOURCE = "docs/research/co-pre-design-research/SKILL.md";
const ROOT_FILES = []; // No private harness layout or Markdown files are required.
const clone = value => JSON.parse(JSON.stringify(value));
const slash = value => value.replaceAll("\\", "/");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const recordHash = value => hash(JSON.stringify(value));
const existsRead = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

function employeeIds(registry, expectedCount, selected) {
  const all = Object.keys(registry.agents || {}).filter(id => id !== "ceo" && !registry.agents[id].isUser).sort();
  const ids = selected || all;
  if (!ids.length) throw new Error("No employees selected");
  if (expectedCount !== undefined && ids.length !== expectedCount) throw new Error(`Expected ${expectedCount} existing employees; found ${ids.length}`);
  for (const id of ids) if (!/^[\w-]+$/.test(id) || !all.includes(id)) throw new Error("Unknown, human or unsafe employee id: " + id);
  return ids;
}

function configOptions(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Installer config must be an object");
  const allowed = new Set(["agentIds", "expectedCount", "extendSkills", "files", "environmentRef"]);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error("Unknown installer option: " + key);
  const idList = (value, label) => {
    if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !/^[\w-]+$/.test(id) || ["__proto__", "prototype", "constructor"].includes(id)) || new Set(value).size !== value.length) throw new Error("Invalid " + label);
    return [...value];
  };
  const fileRef = value => {
    if (typeof value !== "string" || !/^workspace\/.+\.md$/.test(value) || value.includes("\\") || value.includes(":") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Use a relative workspace/*.md path: " + value);
    return value;
  };
  if (config.expectedCount !== undefined && (!Number.isSafeInteger(config.expectedCount) || config.expectedCount < 1)) throw new Error("expectedCount must be a positive integer");
  const extendSkills = idList(config.extendSkills || EXISTING_SKILLS, "extendSkills");
  if (extendSkills.includes(SKILL_ID)) throw new Error("extendSkills must not repeat the research skill");
  if (config.files !== undefined && !Array.isArray(config.files)) throw new Error("files must be an array");
  const files = (config.files || ROOT_FILES).map(fileRef);
  if (new Set(files).size !== files.length) throw new Error("Duplicate Markdown path");
  return { agentIds: config.agentIds === undefined ? undefined : idList(config.agentIds, "agentIds"), expectedCount: config.expectedCount,
    extendSkills, files, environmentRef: config.environmentRef === undefined ? null : fileRef(config.environmentRef) };
}

function appendBlock(text, body) {
  const begin = `<!-- ${MARKER}:start -->`, end = `<!-- ${MARKER}:end -->`;
  const source = String(text || ""), a = source.indexOf(begin), b = source.indexOf(end);
  const block = `${begin}\n${body.trim()}\n${end}`;
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || source.indexOf(begin, a + begin.length) >= 0 || source.indexOf(end, b + end.length) >= 0))) {
    throw new Error("Malformed or duplicate research marker");
  }
  if (a >= 0) return source.slice(0, a) + block + source.slice(b + end.length);
  return source + (source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n") + block + "\n";
}

function absoluteReferences(content, root) {
  const absoluteRoot = slash(path.resolve(root));
  // Only bare project references; repeated application never doubles absolute paths.
  return content.replace(/(^|[\s`(["'])(workspace\/|docs\/research\/|scripts\/research-(?:gate|catalog)\.js)/gm,
    (_, prefix, ref) => {
      const full = absoluteRoot + "/" + ref;
      // Preserve runnable CLI examples after relocating to a path with spaces.
      const quote = ref.startsWith("scripts/") && /\s/.test(absoluteRoot) && prefix !== '"' && prefix !== "'";
      return prefix + (quote ? '"' + full + '"' : full);
    });
}

function parseSkill(text, root) {
  const match = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Research skill needs YAML frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(name|description):\s*(.+)$/);
    if (!m) throw new Error("Research skill frontmatter supports single-line name and description only");
    let value = m[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
    fields[m[1]] = value;
  }
  if (fields.name !== SKILL_ID || !fields.description) throw new Error("Research skill name/description is invalid");
  return { name: fields.name, description: fields.description, content: absoluteReferences(match[2].trim(), root), edited: true };
}

function checkLength(value, max, label) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} exceeds ${max} characters or is not text; refusing truncation`);
}

function updatePersona(persona) {
  const next = clone(persona || {});
  const rules = next.rules || "";
  if (rules.includes("[Research gate]") && !rules.includes(RULE)) throw new Error("Existing different research rule needs manual review");
  next.rules = rules.includes(RULE) ? rules : rules + (rules ? "\n" : "") + RULE;
  return next;
}

// Mirrors the API's normalization to detect even incidental lossy edits in advance.
function apiAgentProjection(current, persona, skills) {
  return { ...current,
    name: String(current.name || current.id || "").slice(0, 40), role: String(current.role || "Specialist").slice(0, 40),
    avatar: Math.min(Math.max(Number(current.avatar) || 1, 1), 12), aura: String(current.aura || "").slice(0, 16),
    prompt: String(current.prompt || "").slice(0, 8000),
    persona: Object.fromEntries(["expertise", "personality", "language", "rules"].map(key => [key, String(persona[key] || "").slice(0, key === "language" ? 80 : 2000)])),
    tier: Math.min(Math.max(Number(current.tier) || 3, 1), 3), voice: String(current.voice || "").slice(0, 20),
    skills, tools: current.tools || [], provider: current.provider || "claude", model: String(current.model || "").slice(0, 60),
    backend: String(current.backend || "").slice(0, 40), memoryPlugins: current.memoryPlugins || [] };
}

function buildPlan(registry, files, root, config = {}) {
  const options = configOptions(config);
  const ids = employeeIds(registry, options.expectedCount, options.agentIds), agents = {}, skills = {}, fileChanges = {};
  const absoluteRoot = slash(path.resolve(root));
  const environment = options.environmentRef ? ` Follow ${absoluteRoot}/${options.environmentRef}.` : " Follow the active brief and applicable environment policy.";
  const pointer = `Before relevant AI/technology design, invoke ${SKILL_ID}. The accountable Lead records current primary-source research, alternatives and a fresh, hashed research packet. Read ${absoluteRoot}/docs/research/RESEARCH_PROTOCOL.md.${environment} Validate the packet with ${absoluteRoot}/scripts/research-gate.js before design handoff; preserve existing approvals and execution limits.`;
  const policy = `### Research before design\n\n${pointer}\n\nAttach the packet path, SHA-256, research date/freshness and gate result to the task/requirements/design package. Changed evidence or scope requires revalidation. Research is not permission to install, generate, restart, print or deploy.`;
  if (RULE.length > 500) throw new Error("Installer rule exceeds its 500-character budget");
  for (const id of ids) {
    const current = registry.agents[id], persona = updatePersona(current.persona), assigned = [...new Set([...(current.skills || []), SKILL_ID])];
    checkLength(current.prompt || "", 8000, id + ".prompt");
    for (const key of ["expertise", "personality", "language", "rules"]) checkLength(persona[key] || "", key === "language" ? 80 : 2000, id + ".persona." + key);
    const expected = { ...current, persona, skills: assigned };
    if (!equal(apiAgentProjection(current, persona, assigned), expected)) throw new Error(`API would normalize unrelated or unsupported fields for ${id}; inspect before installation`);
    agents[id] = { id, persona, skills: assigned };
  }
  for (const id of [SKILL_ID, ...options.extendSkills]) {
    const current = registry.skills && registry.skills[id];
    if (current && current.builtin) throw new Error("Protected built-in skill collision: " + id);
    if (id === SKILL_ID) skills[id] = { ...(current || {}), ...parseSkill(files[SOURCE], root) };
    else {
      if (!current) throw new Error("Required live skill missing: " + id);
      skills[id] = { ...current, content: appendBlock(absoluteReferences(current.content, root), pointer), edited: true };
    }
    checkLength(skills[id].name || id, 60, id + ".name");
    checkLength(skills[id].description || "", 200, id + ".description");
    checkLength(skills[id].content, 4000, id + ".content");
    const target = `workspace/research/skills/${id}/SKILL.md`;
    fileChanges[target] = nativeSkills.frontmatter(skills[id], id);
  }
  if (options.environmentRef && typeof files[options.environmentRef] !== "string") throw new Error("Configured environment policy is missing: " + options.environmentRef);
  for (const file of options.files) {
    if (typeof files[file] !== "string") throw new Error("Required local harness file missing: " + file);
    fileChanges[file] = appendBlock(files[file], policy);
  }
  const afterAgents = clone(registry.agents), afterSkills = clone(registry.skills || {});
  for (const [id, patch] of Object.entries(agents)) afterAgents[id] = { ...afterAgents[id], persona: patch.persona, skills: patch.skills };
  Object.assign(afterSkills, skills);
  const agentChanges = ids.filter(id => !equal(registry.agents[id], afterAgents[id]));
  const skillChanges = Object.keys(skills).filter(id => !equal(registry.skills && registry.skills[id], skills[id]));
  const changedFiles = Object.keys(fileChanges).filter(file => files[file] !== fileChanges[file]);
  return { ids, agents, skills, fileChanges, afterAgents, afterSkills, agentChanges, skillChanges, changedFiles,
    summary: { mode: "plan", employees: ids.length, changedEmployees: agentChanges.length, skills: Object.keys(skills).length,
      changedSkills: skillChanges.length, changedFiles: changedFiles.length, ruleLength: RULE.length,
      lengths: ids.map(id => ({ id, prompt: (registry.agents[id].prompt || "").length, rules: agents[id].persona.rules.length })),
      skillLengths: Object.entries(skills).map(([id, skill]) => ({ id, content: skill.content.length, description: skill.description.length })) } };
}

function readFiles(root, registry, config) {
  const options = configOptions(config);
  employeeIds(registry, options.expectedCount, options.agentIds);
  const names = [SOURCE, ...options.files, ...(options.environmentRef ? [options.environmentRef] : []),
    ...[SKILL_ID, ...options.extendSkills].map(id => `workspace/research/skills/${id}/SKILL.md`)];
  return Object.fromEntries(names.map(name => [name, existsRead(path.join(root, name))]));
}

function nativePlan(root, plan) {
  const files = {}, agentsRoot = path.join(root, "workspace/agents"), selected = new Set(Object.keys(plan.skills));
  for (const id of plan.ids) {
    const base = nativeSkills.skillsRoot(agentsRoot, id), wanted = {}, syncedFile = path.join(base, ".synced.json");
    let synced = {};
    const prior = existsRead(syncedFile);
    if (prior !== null) { try { synced = JSON.parse(prior); } catch { throw new Error("Invalid native sync state: " + id); } }
    for (const skillId of nativeSkills.effectiveIds(plan.afterAgents[id].skills)) {
      const record = plan.afterSkills[skillId];
      if (!record) continue;
      const safe = skillId.replace(/[^\w-]/g, "-"), body = nativeSkills.frontmatter(record, skillId);
      const digest = crypto.createHash("sha1").update(body).digest("hex").slice(0, 12);
      wanted[safe] = digest;
      const file = path.join(base, safe, "SKILL.md"), current = existsRead(file);
      if (!selected.has(skillId) && current !== body) throw new Error(`Unrelated native skill is missing/stale: ${id}/${skillId}; refusing broad sync`);
      if (synced[safe] !== digest || current === null) files[slash(path.relative(root, file))] = current;
      else if (current !== body) throw new Error(`Native skill hash state disagrees with content: ${id}/${skillId}`);
    }
    if (fs.existsSync(base)) for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && !Object.hasOwn(wanted, entry.name)) throw new Error(`Native sync would prune ${id}/${entry.name}; refusing deletion`);
    }
    files[slash(path.relative(root, syncedFile))] = prior;
  }
  return files;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".research-install.tmp";
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

function requestAt(baseUrl = "http://127.0.0.1:8787") {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Daemon URL must be a loopback HTTP origin");
  return async (route, body) => {
  const response = await fetch(url.origin + route, { method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { "content-type": "application/json", "x-bagidea-ui": "1" }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  try { return JSON.parse(text); } catch { return text; }
  };
}

function verifyRegistry(before, after, plan) {
  if (!equal(after.agents, plan.afterAgents)) throw new Error("Agent readback differs from planned fields; unrelated fields may have changed");
  for (const id of Object.keys(plan.skills)) if (!equal(after.skills[id], plan.skills[id])) throw new Error("Skill readback mismatch: " + id);
  for (const [id, skill] of Object.entries(before.skills || {})) if (!Object.hasOwn(plan.skills, id) && !equal(skill, after.skills[id])) throw new Error("Unrelated skill changed: " + id);
}

async function run({ root = path.resolve(__dirname, ".."), apply = false, api = requestAt(), config = {} } = {}) {
  configOptions(config);
  await api("/health");
  const registry = await api("/registry"); // Kept in memory; never log or save the registry.
  const files = readFiles(root, registry, config), plan = buildPlan(registry, files, root, config), nativeBackups = nativePlan(root, plan);
  const summary = { ...plan.summary, nativeFilesTouched: Object.keys(nativeBackups).length };
  if (!apply) return summary;
  const reportFile = path.join(root, "workspace/research/research-install-report.json");
  const backup = path.join(root, "workspace/backups/research-harness-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(3).toString("hex"));
  const previous = { agents: Object.fromEntries(plan.agentChanges.map(id => [id, { persona: registry.agents[id].persona, skills: registry.agents[id].skills }])),
    skills: Object.fromEntries(plan.skillChanges.map(id => [id, registry.skills[id] || null])),
    files: { ...Object.fromEntries(plan.changedFiles.map(file => [file, files[file] ?? null])), ...nativeBackups } };
  writeAtomic(path.join(backup, "previous.json"), JSON.stringify(previous, null, 2));
  const report = { status: "applying", startedAt: new Date().toISOString(), backup: slash(backup), summary, steps: [],
    printed: false, generationStarted: false, restarted: false, workflowsChanged: false, modelToolsProvidersChanged: false };
  const save = () => writeAtomic(reportFile, JSON.stringify(report, null, 2));
  const step = async (kind, id, action) => {
    const receipt = { kind, id, status: "started", at: new Date().toISOString() };
    report.steps.push(receipt); save();
    try { await action(); receipt.status = "completed"; receipt.completedAt = new Date().toISOString(); save(); }
    catch (error) { receipt.status = "failed-or-uncertain"; save(); throw error; }
  };
  save();
  try {
    const fresh = await api("/registry");
    if (!equal(fresh.agents, registry.agents) || !equal(fresh.skills, registry.skills)) throw new Error("Office changed after preflight; rerun plan");
    for (const id of plan.skillChanges) await step("skill", id, async () => {
      const skill = plan.skills[id];
      await api("/registry/skill", { id, name: skill.name || id, description: skill.description || "", content: skill.content });
      const observed = await api("/registry");
      if (!equal(observed.skills[id], skill)) throw new Error("Skill immediate readback mismatch: " + id);
    });
    for (const id of plan.agentChanges) await step("agent", id, async () => {
      const fresh = await api("/registry");
      if (!equal(fresh.agents[id], registry.agents[id])) throw new Error("Agent changed since preflight: " + id);
      await api("/registry/agent", plan.agents[id]);
      const observed = await api("/registry");
      if (!equal(observed.agents[id], plan.afterAgents[id])) throw new Error("Agent immediate readback mismatch: " + id);
    });
    for (const file of plan.changedFiles) await step("file", file, async () => {
      if (existsRead(path.join(root, file)) !== (files[file] ?? null)) throw new Error("Local file changed after preflight: " + file);
      writeAtomic(path.join(root, file), plan.fileChanges[file]);
    });
    const after = await api("/registry");
    verifyRegistry(registry, after, plan);
    for (const id of plan.ids) await step("native-sync", id, async () => {
      const result = nativeSkills.syncAgent(path.join(root, "workspace/agents"), id, after.agents[id].skills, after.skills);
      if (result.pruned) throw new Error("Unexpected native skill pruning");
      for (const skillId of nativeSkills.effectiveIds(after.agents[id].skills).filter(skillId => Object.hasOwn(plan.skills, skillId))) {
        const file = path.join(nativeSkills.skillsRoot(path.join(root, "workspace/agents"), id), skillId, "SKILL.md");
        if (existsRead(file) !== nativeSkills.frontmatter(after.skills[skillId], skillId)) throw new Error("Native skill verification failed: " + id + "/" + skillId);
      }
    });
    verifyRegistry(registry, await api("/registry"), plan);
    for (const file of Object.keys(plan.fileChanges)) if (existsRead(path.join(root, file)) !== plan.fileChanges[file]) throw new Error("Local readback mismatch: " + file);
    report.status = "installed"; report.completedAt = new Date().toISOString();
    report.verifiedEmployees = plan.ids.length;
    report.profileHashes = Object.fromEntries(plan.ids.map(id => [id, recordHash({ persona: plan.agents[id].persona, skills: plan.agents[id].skills })]));
    save(); return report;
  } catch (error) {
    report.status = "incomplete"; report.error = error.message; report.failedAt = new Date().toISOString(); save(); throw error;
  }
}

function cliOptions(argv) {
  const opts = { apply: false }, used = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!["--apply", "--plan", "--root", "--url", "--config"].includes(flag) || used.has(flag)) throw new Error("Unknown or duplicate argument: " + flag);
    used.add(flag);
    if (flag === "--apply" || flag === "--plan") { opts.apply = flag === "--apply"; continue; }
    const value = argv[++i]; if (!value || value.startsWith("--")) throw new Error("Missing value for " + flag);
    if (flag === "--root") opts.root = path.resolve(value);
    if (flag === "--url") opts.api = requestAt(value);
    if (flag === "--config") {
      if (fs.statSync(value).size > 65536) throw new Error("Installer config exceeds 64 KiB");
      opts.config = JSON.parse(fs.readFileSync(value, "utf8")); configOptions(opts.config);
    }
  }
  if (used.has("--apply") && used.has("--plan")) throw new Error("Choose --plan or --apply");
  return opts;
}

if (require.main === module) {
  Promise.resolve().then(() => run(cliOptions(process.argv.slice(2)))).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { SKILL_ID, EXISTING_SKILLS, RULE, SOURCE, ROOT_FILES, employeeIds, appendBlock, absoluteReferences, parseSkill,
  updatePersona, apiAgentProjection, buildPlan, verifyRegistry, nativePlan, configOptions, requestAt, cliOptions, run };
