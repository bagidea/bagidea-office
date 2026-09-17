// 📬 Inbox Agent — the mail tool is the agent's (Gmail MCP from the Tools Hub,
// or any other); this plugin supplies the discipline: a schedule, a
// classification pass, drafts, an approval in front of every send.
const fs = require("fs");
const path = require("path");

const WF_ID = "inbox-agent";

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "config.json");
  let cfg = { agent: "main", everyMin: 30, rules: "" };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));

  function template() {
    const who = cfg.agent && cfg.agent !== "main" ? "@" + cfg.agent + ": " : "@main: ";
    const rules = cfg.rules ? "\nHouse rules: " + cfg.rules : "";
    return {
      id: WF_ID, name: "📬 Inbox check",
      nodes: [
        { id: "t", type: "trigger", text: "Every " + cfg.everyMin + " minutes", x: 330, y: 30 },
        { id: "c", type: "action", text: who + "Check the mailbox with your mail tool: list UNREAD messages received in the last 24 hours (skip ones you already handled — search for our own replies). For each, classify as urgent / needs-reply / fyi / newsletter / spam, and for urgent and needs-reply draft a complete reply in the sender's language and our tone." + rules + "\nOutput a numbered list: for each message, `#n · from · subject · CLASS` then, when there is a draft, `REPLY:` and the text. End with one line: `SUMMARY: <n> unread, <n> drafts`. If there is nothing to reply to, say so plainly.", x: 330, y: 170 },
        { id: "d", type: "decision", text: "{{c.output}} contains REPLY:", x: 330, y: 320 },
        { id: "ap", type: "approval", text: "Send these replies?\n\n{{c.output}}", x: 330, y: 470 },
        { id: "s", type: "action", text: who + "Send exactly the drafts marked REPLY: below with your mail tool, as replies to the original messages, then mark them read. Do not send anything not listed. Report one line per email sent.\n\n{{c.output}}", x: 330, y: 620 },
        { id: "n", type: "notify", text: "📬 Inbox: {{s.output}}", x: 330, y: 760 },
        { id: "n2", type: "notify", text: "📬 Inbox checked — nothing needs a reply. {{c.output}}", x: 620, y: 470 },
      ],
      edges: [{ from: "t", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "ap", label: "yes" }, { from: "d", to: "n2", label: "no" }, { from: "ap", to: "s" }, { from: "s", to: "n" }],
    };
  }
  function schedule() {
    for (const t of ctx.triggers.list()) if (t.workflowId === WF_ID) ctx.triggers.remove(t.id);
    return ctx.triggers.add({ kind: "schedule", workflowId: WF_ID, name: "📬 inbox check", cfg: { everyMin: cfg.everyMin } });
  }
  function setup(everyMin, agent, rules) {
    if (everyMin) cfg.everyMin = Math.max(5, Number(everyMin) || 30);
    if (agent) cfg.agent = String(agent).trim();
    if (rules !== undefined && rules !== "") cfg.rules = String(rules).slice(0, 600);
    save();
    ctx.workflow.save(template());
    const t = schedule();
    return { ok: true, workflowId: WF_ID, everyMin: cfg.everyMin, agent: cfg.agent, trigger: t };
  }
  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());
  return {
    onCommand(cmd, args) {
      const p = parse(args);
      if (cmd === "setup") return setup(p[0], p[1], p[2]);
      if (cmd === "run") { if (!ctx.workflow.exists(WF_ID)) ctx.workflow.save(template()); const run = ctx.workflow.start(WF_ID, { trigger: { source: "plugin", event: "inbox", data: {} }, by: "inbox-agent" }); return { ok: true, run: { id: run.id } }; }
      if (cmd === "off") { for (const t of ctx.triggers.list()) if (t.workflowId === WF_ID) ctx.triggers.remove(t.id); return { ok: true }; }
      if (cmd === "status") return { ok: true, cfg, triggers: ctx.triggers.list().filter((t) => t.workflowId === WF_ID), runs: ctx.workflow.runs({ workflowId: WF_ID, limit: 8 }) };
      return { ok: false, error: "commands: setup · run · off · status" };
    },
    routes: {
      status: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ cfg, installed: ctx.workflow.exists(WF_ID), triggers: ctx.triggers.list().filter((t) => t.workflowId === WF_ID), runs: ctx.workflow.runs({ workflowId: WF_ID, limit: 8 }), agents: Object.fromEntries(Object.entries(ctx.reg.agents || {}).filter(([id]) => id !== "ceo").map(([id, a]) => [id, a.name || id])) })); },
    },
  };
};
