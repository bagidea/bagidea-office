// BagIdea Office — plugin host (zero-dep).
// A plugin is a folder under plugins/<id>/ with a plugin.json manifest and an
// optional index.js (server side). Plugins extend the office in real ways:
//   • add HTTP routes under /plugin/<id>/...   (server-side power)
//   • add an overlay panel (panel.html)        (a UI the user opens)
//   • expose agent COMMANDS                     (so agents can drive the plugin)
//
// plugin.json:
//   {
//     "id": "music", "name": "🎵 Music Player", "version": "1.0.0",
//     "description": "...", "panel": "panel.html",
//     "commands": [{ "name":"play", "args":"<query>", "desc":"play a track" }],
//     "needsKeys": []            // main keys this plugin requires (optional)
//   }
//
// index.js exports: (ctx) => ({ routes?, onCommand?(cmd, args, reply), onEvent?(type, evt) })
//   ctx = { broadcast, feed, reg, saveReg, workspace, daemonDir,
//           dataDir, pluginDir, manifest, log, runClaude,
//           // v1.4 hooks (design H) — every one optional, every old plugin keeps working:
//           notify(item), approvals.ask(item) → promise, tasks, calendar, schedule(job),
//           triggers.register(kind, { start(trigger, fire), stop?(handle) }),
//           workflow.node(kind, impl(node, helpers) → output, { label, hint }),
//           memory.provider(fn(agentId, info) → string | string[]) }
// Built-in plugins ship enabled; users drop new folders in plugins/ and
// restart (or call /plugins/reload). See docs/guide/plugins.md.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Syntax-check a plugin's index.js with `node --check` BEFORE require(), so a
// broken file (unbalanced brace, stray token…) is rejected up front with a clear
// parser error instead of throwing inside require(). The waxwing unlock crash
// showed why this matters: a JS-broken plugin used to load with mod:null and
// still log "loaded", masking the failure as a silent runtime glitch. Returns
// null when the file parses, or the first useful line of the parser message.
// Uses process.execPath (the running node) so it never depends on PATH.
function checkSyntax(file) {
  try {
    execFileSync(process.execPath, ["--check", file],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5000 });
    return null;
  } catch (err) {
    // `node --check` prints a "file:line" header, the offending line, a caret,
    // then a "SyntaxError: <reason>" line, then a stack trace. Keep the
    // location + the reason — together they say exactly what and where.
    const lines = String(err.stderr || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const loc = lines[0] || "";
    const reason = lines.find((l) => /SyntaxError|Error:/.test(l)) || "";
    return [loc, reason].filter(Boolean).join(" — ") || err.message;
  }
}

module.exports = function initPlugins(ctx) {
  // ctx.pluginsDir lets a test harness point load() at a throwaway folder;
  // production callers leave it unset and we use the real plugins/ tree.
  const DIR = (ctx && ctx.pluginsDir) || path.join(__dirname, "..", "plugins");
  fs.mkdirSync(DIR, { recursive: true });
  let plugins = {};   // id -> { manifest, mod, dir, dataDir }
  const memoryProviders = new Map();   // plugin id -> fn(agentId, info) => lines
  const hookNames = new Map();         // plugin id -> { triggers: [], nodes: [] }
  // The scoped hooks a plugin gets: registrations are tagged with the plugin id so
  // a reload (or a failed load) drops exactly that plugin's contributions.
  function scopedCtx(base, id) {
    const names = { triggers: [], nodes: [] };
    hookNames.set(id, names);
    return {
      ...base,
      triggers: {
        register: (kind, def) => {
          if (!ctx.triggers || !ctx.triggers.registerKind) throw new Error("triggers are not available to plugins here");
          ctx.triggers.registerKind(kind, def, id); names.triggers.push(kind);
        },
        fire: (kindOrId, data) => ctx.triggers && ctx.triggers.fireKind ? ctx.triggers.fireKind(kindOrId, data, id) : 0,
        // the trigger records themselves (a plugin can wire its own workflow up)
        add: (spec) => ctx.triggers.add({ ...spec, by: id }), update: (tid, patch) => ctx.triggers.update(tid, patch),
        remove: (tid) => ctx.triggers.remove(tid), list: () => ctx.triggers.list(), get: (tid) => ctx.triggers.get(tid),
      },
      workflow: {
        node: (kind, impl, meta) => {
          if (!ctx.workflows || !ctx.workflows.registerNode) throw new Error("the workflow engine is not available to plugins here");
          ctx.workflows.registerNode(kind, impl, { ...(meta || {}), owner: id }); names.nodes.push(kind);
        },
        start: (wfOrId, o) => ctx.workflows && ctx.workflows.start ? ctx.workflows.start(wfOrId, o) : null,
        // templates: save (once, with ifMissing) / load / runs
        save: (wf, o) => ctx.workflows.save(wf, o), exists: (wid) => ctx.workflows.exists(wid), load: (wid) => ctx.workflows.load(wid),
        runs: (o) => ctx.workflows.runs(o || {}), getRun: (rid) => ctx.workflows.getRun(rid), getRunFull: (rid) => ctx.workflows.getRunFull(rid),
      },
      memory: { provider: (fn) => { if (typeof fn !== "function") throw new Error("memory.provider needs a function"); memoryProviders.set(id, fn); } },
    };
  }
  function dropHooks(id) {
    memoryProviders.delete(id);
    const names = hookNames.get(id);
    if (names) {
      if (ctx.triggers && ctx.triggers.unregisterOwner) ctx.triggers.unregisterOwner(id);
      if (ctx.workflows && ctx.workflows.unregisterOwner) ctx.workflows.unregisterOwner(id);
    }
    hookNames.delete(id);
  }
  // Result of the most recent load(): { loaded, failed:[{id,file,error}] }.
  // Exposed so /plugins/reload can report a clear failure instead of "ok".
  let lastLoad = { loaded: 0, failed: [] };

  function load() {
    for (const id of Object.keys(plugins)) dropHooks(id);
    for (const id of [...hookNames.keys()]) dropHooks(id);
    plugins = {};
    const failed = [];
    let loadedCount = 0;
    let entries = [];
    try { entries = fs.readdirSync(DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".")); }
    catch { return; }
    for (const e of entries) {
      const dir = path.join(DIR, e.name);
      const manFile = path.join(dir, "plugin.json");
      if (!fs.existsSync(manFile)) continue;
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manFile, "utf8")); }
      catch (err) { ctx.log("[plugin] bad manifest " + e.name + ": " + err.message); continue; }
      manifest.id = manifest.id || e.name;
      if (manifest.enabled === false) continue;
      const dataDir = path.join(dir, "data");
      fs.mkdirSync(dataDir, { recursive: true });
      let mod = null;
      const idx = path.join(dir, "index.js");
      if (fs.existsSync(idx)) {
        const synErr = checkSyntax(idx);
        if (synErr) {
          // Syntax-broken JS must NOT be registered — rejecting up front here
          // keeps a bad plugin from sneaking in as mod:null and logging
          // "loaded" (the silent-fail that masked the waxwing unlock crash).
          ctx.log("[plugin] syntax fail " + manifest.id + ": " + synErr);
          failed.push({ id: manifest.id, file: "index.js", error: synErr });
          continue;
        }
        try {
          delete require.cache[require.resolve(idx)];
          const factory = require(idx);
          mod = factory(scopedCtx({ ...ctx, dataDir, pluginDir: dir, manifest }, manifest.id));
        } catch (err) {
          dropHooks(manifest.id);
          // Same anti-mask rule as the syntax check above: a plugin whose
          // factory throws at load time must be skipped and reported, not
          // registered as mod:null and logged "loaded".
          ctx.log("[plugin] load fail " + manifest.id + ": " + err.message);
          failed.push({ id: manifest.id, file: "index.js", error: err.message });
          continue;
        }
      }
      plugins[manifest.id] = { manifest, mod, dir, dataDir };
      loadedCount++;
      ctx.log("[plugin] loaded " + manifest.id + " v" + (manifest.version || "?"));
    }
    lastLoad = { loaded: loadedCount, failed };
    return lastLoad;
  }
  load();

  // The note appended to agent prompts so they know what plugins they can drive.
  function agentNote() {
    const cmds = [];
    for (const p of Object.values(plugins)) {
      for (const c of p.manifest.commands || [])
        cmds.push(`- ${p.manifest.name} → curl -s -X POST http://127.0.0.1:8787/plugin/${p.manifest.id}/cmd ` +
          `-H "content-type: application/json" -d "{\\"cmd\\":\\"${c.name}\\",\\"args\\":\\"...\\"}" : ${c.desc}`);
    }
    const create = `You can also BUILD a new plugin: create plugins/<id>/ with a ` +
      `plugin.json (+ optional index.js / panel.html), then ` +
      `curl -s -X POST http://127.0.0.1:8787/plugins/reload -H "x-bagidea-ui: 1". ` +
      `Full spec: docs/guide/plugins.md. ` +
      `To SHARE a plugin on the public Plugins Hub so others can install it, follow ` +
      `docs/guide/plugin-hub.md: publish it as a public GitHub repo, then open a PR ` +
      `adding one entry to web/plugins.json (id must match plugin.json). If the owner ` +
      `asks you to submit one, walk them through those exact steps.`;
    // Non-ASCII on a Windows command line is mangled to "?" by the shell codepage
    // BEFORE curl runs — so a Thai/Chinese/etc. arg passed inline arrives corrupted.
    // Tell agents to send the JSON body from a FILE instead (the Write tool saves UTF-8).
    const utf8 = `⚠️ If any value contains non-English text (Thai, Chinese, emoji words…), ` +
      `do NOT pass it inline — on Windows the shell turns it into "?". Instead Write the ` +
      `JSON body to a file (UTF-8) and send that file:\n` +
      `  curl -s -X POST http://127.0.0.1:8787/plugin/<id>/cmd -H "content-type: application/json" --data-binary @body.json`;
    if (!cmds.length) return `\n<office-plugins>\n${create}\n</office-plugins>`;
    return `\n<office-plugins>\nExtensions you can drive (via Bash):\n${cmds.join("\n")}\n\n${utf8}\n\n${create}\n</office-plugins>`;
  }

  // HTTP dispatch for /plugin/<id>/...  — returns true if handled.
  function handleHttp(req, res, readBody, readBodyRaw) {
    const m = req.url.match(/^\/plugin\/([\w-]+)\/(.+?)(\?|$)/);
    if (!m) return false;
    const p = plugins[m[1]];
    if (!p) { res.writeHead(404); res.end("unknown plugin"); return true; }
    const sub = m[2];

    // built-in: serve the panel + static files from the plugin folder.
    if (req.method === "GET" && (sub === "panel" || sub.startsWith("static/") || sub === p.manifest.panel)) {
      const file = sub === "panel" ? p.manifest.panel : sub.replace(/^static\//, "");
      const full = path.join(p.dir, file.replace(/\.\./g, ""));
      fs.readFile(full, (e, data) => {
        if (e) { res.writeHead(404); return res.end(); }
        const ext = full.split(".").pop().toLowerCase();
        const mime = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css",
          png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", json: "application/json",
          mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" }[ext] || "application/octet-stream";
        res.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
        res.end(data);
      });
      return true;
    }

    // agent / UI command: POST /plugin/<id>/cmd {cmd, args}
    if (req.method === "POST" && sub === "cmd") {
      readBody(req, (body) => {
        let payload; try { payload = JSON.parse(body); } catch { payload = {}; }
        if (!p.mod || !p.mod.onCommand) { res.writeHead(501); return res.end("plugin has no commands"); }
        let answered = false;
        const reply = (data) => {
          if (answered) return; answered = true;
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(data || { ok: true }));
        };
        try {
          ctx.broadcast({ type: "plugin.cmd", plugin: p.manifest.id, cmd: payload.cmd, args: payload.args }, false);
          const r = p.mod.onCommand(payload.cmd, payload.args, reply, payload);
          if (r && typeof r.then === "function") r.then(reply).catch((e) => { if (!answered) { res.writeHead(500); res.end(String(e.message)); } });
          else if (r !== undefined) reply(r);
          // else: the plugin will call reply() itself (async)
        } catch (e) { if (!answered) { res.writeHead(500); res.end(String(e.message)); } }
      });
      return true;
    }

    // custom plugin routes: mod.routes[sub] (METHOD-agnostic handler)
    if (p.mod && p.mod.routes && p.mod.routes[sub]) {
      p.mod.routes[sub](req, res, { readBody, readBodyRaw });
      return true;
    }
    res.writeHead(404); res.end("no such plugin route"); return true;
  }

  // ---- v1.4 hooks -----------------------------------------------------------
  // Office events reach plugins that export onEvent(type, evt). One plugin's
  // throw never reaches another, and the world's position spam is skipped.
  function onEvent(evt) {
    if (!evt || !evt.type || evt.type === "world.pos") return 0;
    let n = 0;
    for (const p of Object.values(plugins)) {
      if (!p.mod || typeof p.mod.onEvent !== "function") continue;
      n++;
      try { p.mod.onEvent(evt.type, evt); }
      catch (e) { ctx.log("[plugin] " + p.manifest.id + " onEvent: " + (e && e.message)); }
    }
    return n;
  }
  // Lines a plugin contributes at prompt-assembly time (the narrow hook agreed in
  // #42): opt-in per agent (reg.agents[id].memoryPlugins lists the plugin ids),
  // the core owns the timeout and the character budget, and a throw yields zero
  // lines — a plugin can add context, never break a turn.
  const MEMORY_BUDGET = 1500, MEMORY_TIMEOUT_MS = 800;
  async function memoryLines(agentId, info) {
    if (!memoryProviders.size) return "";
    const agent = (ctx.reg && ctx.reg.agents && ctx.reg.agents[agentId]) || {};
    const wanted = Array.isArray(agent.memoryPlugins) ? agent.memoryPlugins : [];
    const picks = [...memoryProviders.entries()].filter(([id]) => wanted.includes(id));
    if (!picks.length) return "";
    const results = await Promise.all(picks.map(([id, fn]) =>
      Promise.race([
        Promise.resolve().then(() => fn(agentId, info || {})),
        new Promise((res) => setTimeout(() => res(null), MEMORY_TIMEOUT_MS)),
      ]).then((r) => ({ id, lines: Array.isArray(r) ? r.map(String) : (r == null ? [] : String(r).split("\n")) }))
        .catch((e) => { ctx.log("[plugin] " + id + " memory: " + (e && e.message)); return { id, lines: [] }; })));
    let budget = MEMORY_BUDGET; const out = [];
    for (const r of results) {
      for (const l of r.lines) {
        const s = l.trim(); if (!s) continue;
        if (s.length + 1 > budget) break;
        out.push(s); budget -= s.length + 1;
      }
    }
    if (!out.length) return "";
    return `\n<plugin-memory>\nContext contributed by your memory plugins (${picks.map(([id]) => id).join(", ")}):\n${out.join("\n")}\n</plugin-memory>`;
  }
  function memoryPlugins() { return [...memoryProviders.keys()]; }

  function list() {
    return Object.values(plugins).map((p) => ({
      id: p.manifest.id, name: p.manifest.name, version: p.manifest.version,
      description: p.manifest.description, panel: !!p.manifest.panel,
      commands: p.manifest.commands || [], needsKeys: p.manifest.needsKeys || [],
      core: !!p.manifest.core,
      hooks: { onEvent: !!(p.mod && typeof p.mod.onEvent === "function"), memory: memoryProviders.has(p.manifest.id),
               triggers: (hookNames.get(p.manifest.id) || { triggers: [] }).triggers, nodes: (hookNames.get(p.manifest.id) || { nodes: [] }).nodes },
      // Optional pop-out window hints: { w, h, resizable } (see plugin template).
      window: p.manifest.window || null,
    }));
  }

  // Resolve a plugin's on-disk dir by its manifest id. Most plugins live in a
  // folder named after their id, but a manually-placed one may not (e.g. folder
  // "waxwing" with id "wax-wallet") — so look it up in the loaded map, never
  // assume plugins/<id>. Returns null if no loaded plugin has that id.
  function dirOf(id) { return plugins[id] ? plugins[id].dir : null; }

  return { load, list, handleHttp, agentNote, dirOf, lastLoad: () => lastLoad, onEvent, memoryLines, memoryPlugins };
};
