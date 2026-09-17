// 📣 Campaign Board — the second demo of the v2 plan. Posts are work items on
// the office board (so the team sees them everywhere), copy is an agent turn in
// the brand voice, nothing is published without an approval, and publishing is
// whatever tools the agent has (X, Bluesky, LinkedIn, a blog CMS, an email list).
const fs = require("fs");
const path = require("path");

const STATES = ["planned", "drafted", "approved", "published", "failed"];

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "posts.json");
  let db = { voice: "", posts: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  const get = (id) => db.posts.find((p) => p.id === id) || (() => { throw new Error("no post " + id); })();
  const emit = (p) => ctx.broadcast({ type: "plugin.event", plugin: "campaign-board", event: "post", post: p }, false);
  const agentText = (r) => String((r && (r.text || r.out || r)) || "");

  function add(date, channel, title, brief, by) {
    if (!/^\d{4}-\d\d-\d\d$/.test(String(date || "").trim())) throw new Error("add <YYYY-MM-DD> :: <channel> :: <title> [:: brief]");
    channel = String(channel || "").trim().toLowerCase().slice(0, 30); title = String(title || "").trim().slice(0, 160);
    if (!channel || !title) throw new Error("add <YYYY-MM-DD> :: <channel> :: <title> [:: brief]");
    const p = { id: newId(), date: String(date).trim(), channel, title, brief: String(brief || "").slice(0, 1000), copy: "", state: "planned", by: by || "you", created: Date.now(), log: [] };
    try { const card = ctx.tasks.create({ title: `📣 ${channel}: ${title}`, detail: p.brief, owner: "main", due: p.date, priority: 3, source: { kind: "campaign", ref: p.id }, tags: ["campaign", channel] }); p.taskId = card.id; } catch {}
    db.posts.push(p); save(); emit(p);
    return p;
  }
  const setState = (p, state, note) => { p.state = state; p.log.push({ at: Date.now(), state, note: String(note || "").slice(0, 300) }); save(); emit(p);
    try { if (p.taskId) ctx.tasks.move(p.taskId, state === "published" ? "done" : state === "failed" ? "waiting" : "doing"); } catch {} };

  // A real agent turn writes the copy — in the brand voice, for that channel.
  async function draft(id, instructions) {
    const p = get(id);
    const r = await new Promise((resolve) => ctx.runClaude("main",
      `Write the copy for a ${p.channel} post.\nTitle/angle: ${p.title}\n${p.brief ? "Brief: " + p.brief + "\n" : ""}${db.voice ? "Brand voice: " + db.voice + "\n" : ""}${instructions ? "Instructions: " + instructions + "\n" : ""}` +
      `Respect the channel's norms (length, hashtags, links, line breaks). Output ONLY the post text, ready to publish — no preamble, no options.`,
      { session: "new", noSub: true, logPrompt: "📣 draft: " + p.title, track: { agent: "main", title: "📣 draft: " + p.title }, onDone: (out, ok) => resolve({ ok, text: out }) }));
    if (!r.ok || !agentText(r).trim()) { setState(p, "failed", "draft failed"); throw new Error("the draft turn failed"); }
    p.copy = agentText(r).trim().slice(0, 4000); setState(p, "drafted", "drafted");
    return p;
  }
  // The approval goes through the inbox: sidebar, chat card, phone.
  async function approve(id) {
    const p = get(id);
    if (!p.copy) throw new Error("draft it first");
    const d = await ctx.approvals.ask({ title: `📣 Publish on ${p.channel}: ${p.title}`, detail: p.copy, options: [{ value: "approve", label: "✅ Publish" }, { value: "reject", label: "✗ Not this" }], meta: { plugin: "campaign-board", post: p.id } });
    const decision = typeof d === "string" ? d : (d && (d.decision || d.value)) || "";
    if (/approve|yes|ok/i.test(decision)) { setState(p, "approved", "approved"); return p; }
    setState(p, "drafted", "rejected: " + ((d && d.note) || "")); return p;
  }
  async function publish(id) {
    const p = get(id);
    if (p.state !== "approved") throw new Error("approve it first (state: " + p.state + ")");
    const r = await new Promise((resolve) => ctx.runClaude("main",
      `Publish this post on ${p.channel} using the tool you have for it (an MCP server for X / Bluesky / LinkedIn / the blog / the newsletter). Post EXACTLY this text, nothing else:\n\n${p.copy}\n\nIf you have no tool for ${p.channel}, do NOT paste it anywhere else — reply with "NO TOOL for ${p.channel}". Otherwise reply with the URL or id of the published post.`,
      { session: "new", noSub: true, logPrompt: "📣 publish: " + p.title, track: { agent: "main", title: "📣 publish: " + p.title }, onDone: (out, ok) => resolve({ ok, text: out }) }));
    const text = agentText(r);
    if (!r.ok || /NO TOOL/i.test(text)) { setState(p, "failed", text.slice(0, 200) || "publish failed"); ctx.notify({ kind: "blocked", title: "📣 Could not publish: " + p.title, body: text.slice(0, 300) || "no tool for " + p.channel + " — grant one in the Tools Hub" }); throw new Error(text.slice(0, 200) || "publish failed"); }
    p.result = text.slice(0, 500); setState(p, "published", text.slice(0, 200));
    ctx.notify({ kind: "done", title: "📣 Published on " + p.channel + ": " + p.title, body: p.result });
    return p;
  }
  function list(range) {
    const now = new Date(); const day = (d) => d.toISOString().slice(0, 10);
    const from = range === "all" ? "0000" : day(new Date(now.getTime() - 86400000));
    const to = range === "month" ? day(new Date(now.getTime() + 31 * 86400000)) : range === "all" ? "9999" : day(new Date(now.getTime() + 8 * 86400000));
    return db.posts.filter((p) => p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  }

  // A workflow node: plan a post from a step's output ("2026-09-20 :: x :: title").
  ctx.workflow.node("campaign-post", (n) => { const [d, c, t, b] = String(n.text).split("::").map((s) => s.trim()); const p = add(d, c, t, b, "workflow"); return { id: p.id, title: p.title }; },
    { label: "📣 Plan a post", hint: "YYYY-MM-DD :: channel :: title [:: brief]" });

  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());
  return {
    onCommand(cmd, args) {
      const p = parse(args);
      if (cmd === "add") return { ok: true, post: add(p[0], p[1], p[2], p[3], "agent") };
      if (cmd === "draft") return draft(p[0], p[1]).then((post) => ({ ok: true, post }));
      if (cmd === "approve") return approve(p[0]).then((post) => ({ ok: true, post }));
      if (cmd === "publish") return publish(p[0]).then((post) => ({ ok: true, post }));
      if (cmd === "voice") { db.voice = String(p[0] || "").slice(0, 600); save(); return { ok: true, voice: db.voice }; }
      if (cmd === "list") { const l = list(p[0] || "week"); return { ok: true, posts: l, text: l.map((x) => `${x.date} · ${x.channel} · ${x.title} [${x.state}] (${x.id})`).join("\n") || "(nothing planned)" }; }
      return { ok: false, error: "commands: add · draft · approve · publish · list · voice" };
    },
    // A card dragged to done on the board counts as published by hand.
    onEvent(type, evt) {
      if (type !== "work.done" || !evt.item || !evt.item.source || evt.item.source.kind !== "campaign") return;
      const p = db.posts.find((x) => x.id === evt.item.source.ref);
      if (p && p.state !== "published") { p.state = "published"; p.log.push({ at: Date.now(), state: "published", note: "marked done on the board" }); save(); emit(p); }
    },
    routes: {
      posts: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ voice: db.voice, posts: db.posts.slice().sort((a, b) => a.date.localeCompare(b.date)), states: STATES })); },
      remove: (req, res, { readBody }) => readBody(req, (b) => { try { const { id } = JSON.parse(b); const p = get(id); db.posts = db.posts.filter((x) => x.id !== id); save(); try { if (p.taskId) ctx.tasks.remove(p.taskId); } catch {} res.writeHead(200); res.end("ok"); } catch (e) { res.writeHead(400); res.end(String(e.message)); } }),
      copy: (req, res, { readBody }) => readBody(req, (b) => { try { const { id, copy } = JSON.parse(b); const p = get(id); p.copy = String(copy || "").slice(0, 4000); if (p.state === "planned" && p.copy) setState(p, "drafted", "edited by hand"); else save(); emit(p); res.writeHead(200); res.end("ok"); } catch (e) { res.writeHead(400); res.end(String(e.message)); } }),
    },
  };
};
