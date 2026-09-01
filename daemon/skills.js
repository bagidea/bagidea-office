// BagIdea Office — native skill sync (P3).
// Projects each agent's assigned skills (a.skills[]) to real Claude Code Skill
// files so headless sessions disclose them PROGRESSIVELY (only the frontmatter
// description is in context until Claude invokes one) via `--add-dir`, instead
// of inlining every skill body into the prompt. a.skills[] stays the source of
// truth; the files are a derived projection.
//
// Verified mechanism: `claude -p --add-dir <dir>` discovers
// <dir>/.claude/skills/<id>/SKILL.md with no extra --allowedTools entry and no
// trust prompt. So we pass --add-dir <agentDir> and the session sees exactly
// that agent's skills.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_SKILLS } = require("./constants");

// An agent's effective skills = the baseline every agent carries + whatever's been
// assigned to it (deduped, assignment order preserved after the defaults). Unknown
// ids are tolerated downstream. This is the ONE place the baseline gets merged, so
// every sync path (boot, per-run, ghosts) stays consistent.
function effectiveIds(assignedIds) {
  return [...new Set([...(DEFAULT_SKILLS || []), ...(assignedIds || [])])];
}

// The dir handed to --add-dir; Claude Code reads its .claude/skills/ child.
function agentDir(agentsRoot, agentId) {
  return path.join(agentsRoot, String(agentId).replace(/[^\w-]/g, "_"));
}
function skillsRoot(agentsRoot, agentId) {
  return path.join(agentDir(agentsRoot, agentId), ".claude", "skills");
}

function frontmatter(sk, id) {
  const name = String(sk.name || id).replace(/[\r\n]+/g, " ").trim();
  const desc = String(sk.description || "").replace(/[\r\n]+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${String(sk.content || "").trim()}\n`;
}

// Write one agent's assigned skills as SKILL.md files; prune dirs for skills no
// longer assigned. Hash-gated via .synced.json so unchanged files aren't
// rewritten. Returns {wrote, pruned}.
function syncAgent(agentsRoot, agentId, assignedIds, skills) {
  const root = skillsRoot(agentsRoot, agentId);
  fs.mkdirSync(root, { recursive: true });
  const syncedFile = path.join(root, ".synced.json");
  let synced = {};
  try { synced = JSON.parse(fs.readFileSync(syncedFile, "utf8")); } catch {}
  const want = {};
  let wrote = 0, pruned = 0;
  for (const id of effectiveIds(assignedIds)) {
    const sk = skills[id];
    if (!sk) continue;
    const safe = String(id).replace(/[^\w-]/g, "-");
    const body = frontmatter(sk, id);
    const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 12);
    want[safe] = hash;
    const dir = path.join(root, safe);
    if (synced[safe] !== hash || !fs.existsSync(path.join(dir, "SKILL.md"))) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, ".SKILL.md.tmp");
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, path.join(dir, "SKILL.md"));
      wrote++;
    }
  }
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory() && !want[d.name]) {
        fs.rmSync(path.join(root, d.name), { recursive: true, force: true });
        pruned++;
      }
    }
  } catch { /* fresh dir */ }
  try { fs.writeFileSync(syncedFile, JSON.stringify(want)); } catch {}
  return { wrote, pruned };
}

// Sync every agent in the registry (boot).
function syncAll(agentsRoot, agents, skills) {
  let wrote = 0, pruned = 0;
  for (const [id, a] of Object.entries(agents || {})) {
    if (a.isUser) continue;   // the human CEO never runs as an agent — no skill files
    const r = syncAgent(agentsRoot, id, a.skills || [], skills || {});
    wrote += r.wrote; pruned += r.pruned;
  }
  return { wrote, pruned };
}

// May the office rewrite this skill's own instructions?
//
// Reflection after a task can revise a skill it decides was wrong. That is
// only ever allowed on skills the office WROTE ITSELF and nobody has since
// touched. A builtin is part of the office's contract with every user, and a
// skill a human edited is that human's writing — neither is a draft the model
// gets to improve. Kept here, as one function, so the rule cannot drift
// between the place that enforces it and the place that documents it.
function canRefine(sk) {
  return !!(sk && sk.auto && !sk.builtin && !sk.edited);
}

module.exports = { agentDir, skillsRoot, frontmatter, syncAgent, syncAll, effectiveIds,
  canRefine };
