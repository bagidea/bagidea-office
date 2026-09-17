// 🐙 GitHub Triage — the first demo of the v2 plan. A webhook trigger with a
// secret, a decision on the event, an agent turn that labels and drafts, an
// approval node in front of anything outward, and an agent turn that posts
// with the gh CLI. The plugin only installs the pieces; the engine runs them.
const fs = require("fs");
const path = require("path");

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "repos.json");
  let repos = [];
  try { repos = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(repos, null, 2));
  const slug = (r) => String(r).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const port = process.env.OEP_PORT || 8787;

  function workflowFor(repo) {
    return {
      id: "github-triage-" + slug(repo), name: "🐙 Triage " + repo,
      nodes: [
        { id: "t", type: "trigger", text: "GitHub webhook: issues", x: 330, y: 30 },
        { id: "d", type: "decision", text: "{{trigger.data.action}} == opened", x: 330, y: 150 },
        { id: "a", type: "action", text: "@main: A new issue was opened on " + repo + ".\nTitle: {{trigger.data.issue.title}}\nBody:\n{{trigger.data.issue.body}}\nAuthor: {{trigger.data.issue.user.login}} · #{{trigger.data.issue.number}}\n\n" +
            "Read the repository (gh repo view " + repo + ", the README, recent issues with gh issue list) enough to answer well. Then: 1) pick ONE label from bug / question / feature / docs (create it with gh label create if the repo lacks it); 2) if it is a duplicate, say which issue; 3) write the reply you would post — helpful, specific, in the author's language; 4) if a maintainer should own it, name who. " +
            "Reply in exactly this form:\nLABEL: <label>\nDUPLICATE: <#n or none>\nASSIGN: <github login or none>\nREPLY:\n<the reply text>", x: 330, y: 290 },
        { id: "ap", type: "approval", text: "Post this to " + repo + "#{{trigger.data.issue.number}} \"{{trigger.data.issue.title}}\"?\n\n{{a.output}}", x: 330, y: 440 },
        { id: "p", type: "action", text: "@main: Carry out the approved triage on " + repo + "#{{trigger.data.issue.number}} with the gh CLI, exactly as written here (label, optional duplicate note, optional assignee, then post the REPLY text as a comment):\n{{a.output}}\nUse: gh issue edit --add-label, gh issue comment, gh issue edit --add-assignee. Report what you did in one line.", x: 330, y: 590 },
        { id: "n", type: "notify", text: "🐙 " + repo + "#{{trigger.data.issue.number}} triaged — {{p.output}}", x: 330, y: 730 },
      ],
      edges: [{ from: "t", to: "d" }, { from: "d", to: "a", label: "yes" }, { from: "a", to: "ap" }, { from: "ap", to: "p" }, { from: "p", to: "n" }],
    };
  }
  function setup(repo, secret) {
    repo = String(repo || "").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("setup <owner/repo> [:: secret]");
    const id = "github-triage-" + slug(repo);
    ctx.workflow.save(workflowFor(repo));
    let rec = repos.find((r) => r.repo === repo);
    if (rec && rec.triggerId) { try { ctx.triggers.remove(rec.triggerId); } catch {} }
    const t = ctx.triggers.add({ kind: "webhook", workflowId: id, name: "🐙 " + repo, cfg: secret ? { secret: String(secret).trim() } : {} });
    const token = (ctx.triggers.get(t.id) || t).cfg && (ctx.triggers.get(t.id) || t).cfg.token;
    if (!rec) { rec = { repo, created: Date.now() }; repos.push(rec); }
    rec.triggerId = t.id; rec.workflowId = id; rec.hasSecret = !!secret; save();
    const raw = (ctx.reg.triggers || []).find((x) => x.id === t.id);
    const url = `http://127.0.0.1:${port}/hook/${(raw && raw.cfg && raw.cfg.token) || token || "<token>"}`;
    return { ok: true, repo, workflowId: id, url, hasSecret: !!secret,
      next: `On GitHub: ${repo} → Settings → Webhooks → Add. Payload URL = your tunnel + the path above (e.g. cloudflared tunnel --url http://127.0.0.1:${port}), content type application/json${secret ? ", the same secret" : ""}, event: Issues.` };
  }
  return {
    onCommand(cmd, args) {
      const a = String(typeof args === "string" ? args : (args && args.text) || "");
      if (cmd === "setup") { const [repo, secret] = a.split("::").map((s) => s.trim()); return setup(repo, secret); }
      if (cmd === "triage") {
        const m = /^([\w.-]+\/[\w.-]+)#(\d+)/.exec(a.trim()); if (!m) throw new Error("triage <owner/repo>#<number>");
        const id = "github-triage-" + slug(m[1]);
        if (!ctx.workflow.exists(id)) setup(m[1]);
        // Fetch the issue with gh so the workflow sees the same shape a webhook sends.
        const { execFileSync } = require("child_process");
        let issue; try { issue = JSON.parse(execFileSync("gh", ["issue", "view", m[2], "--repo", m[1], "--json", "number,title,body,author"], { encoding: "utf8", timeout: 20000 })); }
        catch (e) { throw new Error("gh issue view failed — is gh installed and logged in? " + e.message.split("\n")[0]); }
        const run = ctx.workflow.start(id, { trigger: { source: "plugin", event: "issues", data: { action: "opened", issue: { number: issue.number, title: issue.title, body: issue.body, user: { login: issue.author && issue.author.login } } } }, by: "github-triage" });
        return { ok: true, run: { id: run.id } };
      }
      if (cmd === "status") return { ok: true, repos, runs: repos.flatMap((r) => ctx.workflow.runs({ workflowId: r.workflowId, limit: 5 })) };
      return { ok: false, error: "commands: setup · triage · status" };
    },
    routes: {
      status: (req, res) => {
        const out = repos.map((r) => ({ ...r, trigger: ctx.triggers.get(r.triggerId), runs: ctx.workflow.runs({ workflowId: r.workflowId, limit: 8 }) }));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ repos: out, port }));
      },
    },
  };
};
