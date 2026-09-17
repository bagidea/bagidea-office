// 🧠 Decision Log — the #42 shape: "we decided X because Y" entries with
// supersede chains, injected at prompt time through the memory provider hook.
// The core owns the timeout and the character budget; this plugin just keeps
// the list short and the wording exact.
const fs = require("fs");
const path = require("path");

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "decisions.json");
  let items = [];
  try { items = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
  const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function add(what, why, by, supersedes) {
    what = String(what || "").trim().slice(0, 300); why = String(why || "").trim().slice(0, 500);
    if (!what) throw new Error("a decision needs a 'what'");
    const d = { id: newId(), what, why, by: by || "you", at: Date.now(), active: true, supersedes: supersedes || null, supersededBy: null };
    if (supersedes) {
      const old = items.find((x) => x.id === supersedes);
      if (!old) throw new Error("no decision " + supersedes);
      old.active = false; old.supersededBy = d.id;
    }
    items.push(d); save();
    ctx.broadcast({ type: "plugin.event", plugin: "decision-log", event: "decided", decision: d }, false);
    return d;
  }
  function retire(id) { const d = items.find((x) => x.id === id); if (!d) throw new Error("no decision " + id); d.active = false; d.retiredAt = Date.now(); save(); return d; }
  const active = () => items.filter((d) => d.active).sort((a, b) => b.at - a.at);
  const line = (d) => `we decided ${d.what} because ${d.why || "(no reason recorded)"} [${d.id}]`;

  // The memory hook: the newest active decisions, one line each. The core cuts
  // at its budget, so newest-first matters.
  ctx.memory.provider(() => active().slice(0, 12).map(line));

  // A workflow node: record what the previous step concluded.
  ctx.workflow.node("decision-log", (n) => {
    const [what, why] = String(n.text || "").split("::").map((s) => s.trim());
    return line(add(what || n.prev, why || "", "workflow"));
  }, { label: "🧠 Log a decision", hint: "what :: why   (use {{prev}} for either)" });

  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());
  return {
    onCommand(cmd, args) {
      if (cmd === "add") { const [what, why] = parse(args); return { ok: true, decision: add(what, why, "agent") }; }
      if (cmd === "supersede") { const [id, what, why] = parse(args); return { ok: true, decision: add(what, why, "agent", id) }; }
      if (cmd === "retire") return { ok: true, decision: retire(parse(args)[0]) };
      if (cmd === "list") { const all = /all/.test(String(args || "")); return { ok: true, decisions: all ? items : active(), text: (all ? items : active()).map(line).join("\n") || "(no decisions yet)" }; }
      return { ok: false, error: "commands: add · supersede · retire · list" };
    },
    routes: {
      list: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ decisions: items.slice().sort((a, b) => b.at - a.at) })); },
    },
  };
};
