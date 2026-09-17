// 🗂 Client Folders — one file trigger + one workflow per client. The agent
// reads what landed, does the obvious thing (summary, extraction, a reply
// draft), saves it beside the original, and the owner is told. Every file is
// also a card on the board so nothing gets lost.
const fs = require("fs");
const path = require("path");

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "clients.json");
  let clients = [];
  try { clients = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(clients, null, 2));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "client";

  function workflowFor(c) {
    const who = c.agent && c.agent !== "main" ? "@" + c.agent + ": " : "@main: ";
    return {
      id: "client-" + c.slug, name: "🗂 " + c.name + " — new file",
      nodes: [
        { id: "t", type: "trigger", text: "A file lands in " + c.dir, x: 300, y: 40 },
        { id: "a", type: "action", text: who + "A new file arrived for client \"" + c.name + "\": {{trigger.data.path}} ({{trigger.data.change}}, {{trigger.data.size}} bytes). Read it. " +
            (c.instructions || "Write a one-page summary of what it is and what it asks of us, save it next to the original as <name>.summary.md, and reply with the summary and any action items.") +
            " Do not modify the original file.", x: 300, y: 190 },
        { id: "n", type: "notify", text: "🗂 " + c.name + ": {{trigger.data.name}} handled — {{a.output}}", x: 300, y: 340 },
      ],
      edges: [{ from: "t", to: "a" }, { from: "a", to: "n" }],
    };
  }
  function add(name, dir, agent, instructions) {
    name = String(name || "").trim().slice(0, 60); dir = String(dir || "").trim();
    if (!name || !dir) throw new Error("add <client> :: <folder path> [:: agent] [:: instructions]");
    if (!fs.existsSync(dir)) throw new Error("no such folder: " + dir);
    const c = { name, slug: slug(name), dir: path.resolve(dir), agent: String(agent || "main").trim(), instructions: String(instructions || "").trim().slice(0, 600), created: Date.now(), files: [] };
    remove(name, true);
    ctx.workflow.save(workflowFor(c));
    const t = ctx.triggers.add({ kind: "file", workflowId: "client-" + c.slug, name: "🗂 " + c.name, cfg: { dir: c.dir, glob: "*" } });
    c.triggerId = t.id;
    clients.push(c); save();
    return c;
  }
  function remove(name, quiet) {
    const i = clients.findIndex((c) => c.name.toLowerCase() === String(name || "").trim().toLowerCase() || c.slug === slug(name));
    if (i < 0) { if (quiet) return null; throw new Error("no client " + name); }
    const c = clients[i];
    if (c.triggerId) { try { ctx.triggers.remove(c.triggerId); } catch {} }
    clients.splice(i, 1); save();
    return c;
  }
  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());

  return {
    onCommand(cmd, args) {
      const p = parse(args);
      if (cmd === "add") return { ok: true, client: add(p[0], p[1], p[2], p[3]) };
      if (cmd === "remove") return { ok: true, client: remove(p[0]) };
      if (cmd === "list") return { ok: true, clients, text: clients.map((c) => `${c.name} → ${c.dir} (${c.agent}) · ${c.files.length} file(s) handled`).join("\n") || "(no clients yet)" };
      return { ok: false, error: "commands: add · remove · list" };
    },
    // Every file that fires becomes a card owned by the client's agent; the run
    // finishing closes it.
    onEvent(type, evt) {
      if (type !== "workflow.run" || !evt.run) return;
      const c = clients.find((x) => "client-" + x.slug === evt.run.workflowId);
      if (!c) return;
      const r = evt.run;
      if (r.state === "running") {
        const name = (r.trigger && r.trigger.data && r.trigger.data.name) || "file";
        c.files.unshift({ name, at: Date.now(), runId: r.id, state: "running" }); c.files = c.files.slice(0, 50); save();
        try { ctx.tasks.create({ title: "🗂 " + c.name + ": " + name, kind: "task", owner: c.agent, status: "doing", source: { kind: "client-file", ref: r.id }, tags: ["client", c.slug] }); } catch {}
      } else {
        const f = c.files.find((x) => x.runId === r.id); if (f) { f.state = r.state; save(); }
        try { const card = ctx.tasks.bySource("client-file", r.id); if (card) ctx.tasks.move(card.id, r.state === "done" ? "done" : "waiting"); } catch {}
      }
      ctx.broadcast({ type: "plugin.event", plugin: "client-folders", event: "file", client: c.name }, false);
    },
    routes: {
      list: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ clients, agents: Object.fromEntries(Object.entries(ctx.reg.agents || {}).filter(([id]) => id !== "ceo").map(([id, a]) => [id, a.name || id])) })); },
    },
  };
};
