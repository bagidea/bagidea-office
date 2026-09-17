// 📰 Content Pipeline — a plugin that teaches the Workflow Builder two things
// (an "rss" trigger kind and a "fetch-article" node) and ships a pipeline built
// on them: item in → article text → summary → draft → approval → channel.
const fs = require("fs");
const path = require("path");

module.exports = (ctx) => {
  const { httpFetch } = require(path.join(ctx.daemonDir, "workflows"));
  const FILE = path.join(ctx.dataDir, "feeds.json");
  let feeds = [];
  try { feeds = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(feeds, null, 2));
  const slug = (s) => String(s).toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const WF_ID = "content-pipeline";

  // ---- a tiny RSS/Atom reader — no dependencies ----
  const untag = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  function parseFeed(xml) {
    const items = [];
    const pick = (block, tag) => { const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i").exec(block); return m ? untag(m[1]) : ""; };
    const link = (block) => { const a = /<link[^>]*href="([^"]+)"/i.exec(block); if (a) return a[1]; return pick(block, "link"); };
    for (const m of String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
      const b = m[2];
      items.push({ id: pick(b, "guid") || pick(b, "id") || link(b), title: pick(b, "title"), link: link(b), summary: (pick(b, "description") || pick(b, "summary") || pick(b, "content")).slice(0, 1200), date: pick(b, "pubDate") || pick(b, "published") || pick(b, "updated") });
    }
    return items;
  }
  async function readFeed(url) {
    const r = await httpFetch(url, { method: "GET", headers: { "user-agent": "bagidea-office/1.5 content-pipeline" }, timeout: 20000 });
    if (!r || r.status >= 400) throw new Error("feed returned " + (r && r.status));
    return parseFeed(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  }
  const seenFile = path.join(ctx.dataDir, "seen.json");
  let seen = {}; try { seen = JSON.parse(fs.readFileSync(seenFile, "utf8")); } catch {}
  const saveSeen = () => fs.writeFileSync(seenFile, JSON.stringify(seen));

  // ---- the trigger kind: poll a feed, fire once per new item ----
  ctx.triggers.register("rss", {
    label: "📰 RSS / Atom feed", fields: [{ key: "url", label: "feed URL" }, { key: "everyMin", label: "check every N minutes (default 30)" }],
    start: (t, fire) => {
      const url = t.cfg.url; if (!url) return null;
      const key = t.id;
      const poll = async () => {
        try {
          const items = await readFeed(url);
          seen[key] = seen[key] || { ids: [], primed: false };
          const s = seen[key];
          if (!s.primed) { s.ids = items.map((i) => i.id).slice(0, 200); s.primed = true; saveSeen(); return; }   // first poll: remember, don't flood
          for (const it of items.slice().reverse()) {
            if (!it.id || s.ids.includes(it.id)) continue;
            s.ids.unshift(it.id); s.ids = s.ids.slice(0, 500);
            fire({ ...it, feed: url });
          }
          saveSeen();
        } catch (e) { ctx.log("[content-pipeline] " + url + ": " + e.message); }
      };
      poll();
      return setInterval(poll, Math.max(5, Number(t.cfg.everyMin) || 30) * 60000);
    },
    stop: (h) => clearInterval(h),
  });

  // ---- the node: a URL → readable text ----
  ctx.workflow.node("fetch-article", async (n) => {
    const url = String(n.text || "").trim().split(/\s+/)[0];
    if (!/^https?:\/\//.test(url)) throw new Error("fetch-article needs a URL");
    const r = await httpFetch(url, { method: "GET", headers: { "user-agent": "bagidea-office/1.5 content-pipeline" }, timeout: 25000 });
    if (!r || r.status >= 400) throw new Error("article returned " + (r && r.status));
    let html = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
    html = html.replace(/<(script|style|nav|footer|header|aside|noscript)[\s\S]*?<\/\1>/gi, " ");
    const main = (/<(article|main)[\s\S]*?<\/\1>/i.exec(html) || [])[0] || html;
    return { url, title: untag(title), text: untag(main).slice(0, 12000) };
  }, { label: "📰 Fetch article", hint: "a URL · output { url, title, text } — use {{n.output.text}}" });

  function template(instructions) {
    const voice = instructions || "our voice: clear, useful, no hype";
    return {
      id: WF_ID, name: "📰 Content pipeline",
      nodes: [
        { id: "t", type: "trigger", text: "A new feed item, or a URL you hand it", x: 330, y: 30 },
        { id: "f", type: "fetch-article", text: "{{trigger.data.link}}", x: 330, y: 160 },
        { id: "s", type: "action", text: "@main: Summarize this article in 5 bullet points, then one line on why it matters to our audience. Title: {{f.output.title}}\n\n{{f.output.text}}", x: 330, y: 300 },
        { id: "d", type: "action", text: "@main: Draft a social post (under 280 characters) and a longer LinkedIn/blog version (under 150 words) about the article, linking {{f.output.url}}. " + voice + ". Base it on:\n{{s.output}}", x: 330, y: 440 },
        { id: "ap", type: "approval", text: "Publish this?\n\n{{d.output}}", x: 330, y: 580 },
        { id: "o", type: "output", text: "channel: {{d.output}}", x: 330, y: 720 },
      ],
      edges: [{ from: "t", to: "f" }, { from: "f", to: "s" }, { from: "s", to: "d" }, { from: "d", to: "ap" }, { from: "ap", to: "o" }],
    };
  }
  const ensure = (instr) => { if (instr || !ctx.workflow.exists(WF_ID)) ctx.workflow.save(template(instr)); };

  function follow(url, everyMin, instr) {
    url = String(url || "").trim(); if (!/^https?:\/\//.test(url)) throw new Error("follow <feed url> [:: every N min] [:: instructions]");
    ensure(instr);
    let f = feeds.find((x) => x.url === url);
    if (f && f.triggerId) { try { ctx.triggers.remove(f.triggerId); } catch {} }
    const t = ctx.triggers.add({ kind: "rss", workflowId: WF_ID, name: "📰 " + slug(url), cfg: { url, everyMin: Number(everyMin) || 30 } });
    if (!f) { f = { url, created: Date.now() }; feeds.push(f); }
    f.triggerId = t.id; f.everyMin = Number(everyMin) || 30; save();
    return f;
  }
  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());
  return {
    onCommand(cmd, args) {
      const p = parse(args);
      if (cmd === "follow") return { ok: true, feed: follow(p[0], p[1], p[2]) };
      if (cmd === "unfollow") { const i = feeds.findIndex((f) => f.url === p[0]); if (i < 0) throw new Error("not following " + p[0]); const f = feeds.splice(i, 1)[0]; if (f.triggerId) { try { ctx.triggers.remove(f.triggerId); } catch {} } save(); return { ok: true }; }
      if (cmd === "run") { if (!/^https?:\/\//.test(p[0] || "")) throw new Error("run <article url> [:: instructions]"); ensure(p[1]); const run = ctx.workflow.start(WF_ID, { trigger: { source: "plugin", event: "url", data: { link: p[0], title: "", feed: "" } }, by: "content-pipeline" }); return { ok: true, run: { id: run.id } }; }
      if (cmd === "list") return { ok: true, feeds, text: feeds.map((f) => `${f.url} · every ${f.everyMin} min`).join("\n") || "(no feeds)" };
      return { ok: false, error: "commands: follow · unfollow · run · list" };
    },
    routes: {
      list: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ feeds: feeds.map((f) => ({ ...f, trigger: ctx.triggers.get(f.triggerId) })), runs: ctx.workflow.runs({ workflowId: WF_ID, limit: 10 }), installed: ctx.workflow.exists(WF_ID) })); },
      preview: async (req, res) => {
        const url = new URL(req.url, "http://x").searchParams.get("url") || "";
        try { const items = await readFeed(url); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ items: items.slice(0, 10) })); }
        catch (e) { res.writeHead(400); res.end(String(e.message)); }
      },
    },
    _parseFeed: parseFeed,
  };
};
