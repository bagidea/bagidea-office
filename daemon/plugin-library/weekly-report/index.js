// 📊 Weekly Report — a schedule trigger, a gather node that reads the office's
// own records, a Director turn that writes it, and delivery to a channel + file.
const fs = require("fs");
const path = require("path");
const http = require("http");

const WF_ID = "weekly-report";
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

module.exports = (ctx) => {
  const REPORTS = path.join(ctx.dataDir, "reports");
  fs.mkdirSync(REPORTS, { recursive: true });
  const port = process.env.OEP_PORT || 8787;
  const getJson = (p) => new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port, path: p, timeout: 8000 }, (res) => { let b = ""; res.on("data", (d) => b += d); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); });
    r.on("error", () => resolve(null)); r.on("timeout", () => { r.destroy(); resolve(null); });
  });

  // The numbers, from the office's own records — no model involved.
  async function gather(days) {
    const n = Math.max(1, Math.min(90, Number(days) || 7));
    const since = Date.now() - n * 86400000;
    const [stats, budget] = await Promise.all([getJson("/stats"), getJson("/budget")]);
    const done = ctx.tasks.list({ status: "done" }).filter((t) => t.done >= since);
    const open = ctx.tasks.list({ open: true });
    const overdue = open.filter((t) => t.overdue);
    const runs = ctx.workflow.runs({ limit: 200 }).filter((r) => (r.startedAt || 0) >= since);
    const spend = (stats && stats.days || []).slice(-n).reduce((s, d) => s + (d.cost || 0), 0);
    const byOwner = {};
    for (const t of done) byOwner[t.owner] = (byOwner[t.owner] || 0) + 1;
    const lines = [
      `Period: last ${n} day(s) (since ${new Date(since).toDateString()})`,
      `Cards finished: ${done.length}` + (Object.keys(byOwner).length ? " — " + Object.entries(byOwner).map(([o, c]) => `${o}: ${c}`).join(", ") : ""),
      ...done.slice(0, 25).map((t) => `  ✓ ${t.title}${t.project ? " (" + t.project + ")" : ""} — ${t.owner}`),
      `Open cards: ${open.length} · in progress ${open.filter((t) => t.status === "doing").length} · waiting ${open.filter((t) => t.status === "waiting").length} · overdue ${overdue.length}`,
      ...overdue.slice(0, 10).map((t) => `  🔴 overdue: ${t.title} — ${t.owner}`),
      `Workflow runs: ${runs.length} (${runs.filter((r) => r.state === "done").length} done, ${runs.filter((r) => r.state === "failed").length} failed)`,
      ...runs.slice(0, 10).map((r) => `  🔀 ${r.name}: ${r.state}`),
      `Claude spend (real): $${spend.toFixed(2)}` + (budget && budget.office ? ` · today $${Number(budget.office.spent || 0).toFixed(2)}${budget.office.cap ? " / $" + budget.office.cap : ""}` : ""),
      `Upcoming: ${ctx.calendar.occurrences(Date.now(), Date.now() + 7 * 86400000, { limit: 10 }).map((o) => `${new Date(o.at).toLocaleDateString()} ${o.title}`).join("; ") || "nothing booked"}`,
    ];
    return lines.join("\n");
  }

  ctx.workflow.node("gather-report", (n) => gather(Number(n.text) || 7), { label: "📊 Gather report data", hint: "how many days back (default 7)" });

  const template = () => ({
    id: WF_ID, name: "📊 Weekly report",
    nodes: [
      { id: "t", type: "trigger", text: "Monday 09:00 (schedule trigger)", x: 300, y: 40 },
      { id: "g", type: "gather-report", text: "7", x: 300, y: 180 },
      { id: "w", type: "action", text: "@main: Write the weekly office report for the owner from these facts. Lead with what got done and what it cost, then what is overdue or stuck, then what is coming. Short headings, plain sentences, no filler. Facts:\n{{g.output}}", x: 300, y: 320 },
      { id: "o", type: "output", text: "channel: {{w.output}}", x: 300, y: 460 },
      { id: "f", type: "output", text: "file:" + path.join(REPORTS, "report-{{run.id}}.md").replace(/\\/g, "/"), x: 560, y: 460 },
    ],
    edges: [{ from: "t", to: "g" }, { from: "g", to: "w" }, { from: "w", to: "o" }, { from: "w", to: "f" }],
  });
  // {{run.id}} is not a template var the engine knows for output paths — write the file ourselves too.
  function saveReport(text) {
    const name = "report-" + new Date().toISOString().slice(0, 10) + ".md";
    fs.writeFileSync(path.join(REPORTS, name), text); return name;
  }
  function setup(spec) {
    const m = /^\s*([a-z]{3})?\s*(\d\d:\d\d)?/i.exec(String(spec || ""));
    const weekday = m && m[1] && DAYS[m[1].toLowerCase()] !== undefined ? DAYS[m[1].toLowerCase()] : 1;
    const at = (m && m[2]) || "09:00";
    const wf = template(); wf.nodes = wf.nodes.filter((n) => n.id !== "f");   // the plugin writes the file itself (see onEvent)
    wf.edges = wf.edges.filter((e) => e.to !== "f");
    ctx.workflow.save(wf);
    for (const t of ctx.triggers.list()) if (t.workflowId === WF_ID && t.kind === "schedule") ctx.triggers.remove(t.id);
    const trig = ctx.triggers.add({ kind: "schedule", workflowId: WF_ID, name: "📊 weekly report", cfg: { at, weekday } });
    return { ok: true, workflowId: WF_ID, trigger: trig, when: `${Object.keys(DAYS)[weekday]} ${at}` };
  }
  const reports = () => fs.readdirSync(REPORTS).filter((f) => f.endsWith(".md")).sort().reverse();

  return {
    onCommand(cmd, args) {
      const a = typeof args === "string" ? args : (args && args.text) || "";
      if (cmd === "setup") return setup(a);
      if (cmd === "gather") return gather(a).then((text) => ({ ok: true, text }));
      if (cmd === "run") {
        if (!ctx.workflow.exists(WF_ID)) setup("");
        const run = ctx.workflow.start(WF_ID, { trigger: { source: "plugin", event: "weekly-report", data: { days: Number(a) || 7 } }, by: "weekly-report" });
        return { ok: true, run: run && run.id ? { id: run.id } : run };
      }
      if (cmd === "last") { const f = reports()[0]; return f ? { ok: true, file: f, text: fs.readFileSync(path.join(REPORTS, f), "utf8") } : { ok: false, error: "no report yet — run `run`" }; }
      return { ok: false, error: "commands: setup · run · gather · last" };
    },
    // When our workflow finishes, keep the written report on disk.
    onEvent(type, evt) {
      if (type !== "workflow.run" || !evt.run || evt.run.workflowId !== WF_ID || evt.run.state !== "done") return;
      try {
        const full = ctx.workflow.getRunFull(evt.run.id);
        const text = full && full.nodes && full.nodes.w && full.nodes.w.output;
        if (text) { const name = saveReport(String(text)); ctx.broadcast({ type: "plugin.event", plugin: "weekly-report", event: "report", file: name }, false); }
      } catch (e) { ctx.log("[weekly-report] " + e.message); }
    },
    routes: {
      reports: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ reports: reports(), installed: ctx.workflow.exists(WF_ID), triggers: ctx.triggers.list().filter((t) => t.workflowId === WF_ID) })); },
      report: (req, res) => {
        const f = String(new URL(req.url, "http://x").searchParams.get("f") || "").replace(/[^\w.-]/g, "");
        try { res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end(fs.readFileSync(path.join(REPORTS, f), "utf8")); }
        catch { res.writeHead(404); res.end(""); }
      },
    },
  };
};
