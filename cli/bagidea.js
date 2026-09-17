#!/usr/bin/env node
// bagidea — command line for the BagIdea Office.
// Zero dependencies. Talks to the daemon on :8787; can launch the suite.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:" + (process.env.OEP_PORT || 8787);   // OEP_PORT: talk to a daemon on another port (tests, a second office)

// ---- palette (truecolor; degrades fine on basic terminals) -------------------
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  brand: "\x1b[38;2;86;167;255m",   // BAG IDEA blue
  accent: "\x1b[38;2;125;205;255m",
  ok: "\x1b[38;2;78;222;128m",
  warn: "\x1b[38;2;255;192;92m",
  err: "\x1b[38;2;255;112;112m",
  mag: "\x1b[38;2;196;148;255m",
  gray: "\x1b[38;2;134;144;160m",
};
const ok = (s) => console.log(`  ${c.ok}✓${c.reset} ${s}`);
const bad = (s) => console.log(`  ${c.err}✗${c.reset} ${s}`);
const warn = (s) => console.log(`  ${c.warn}!${c.reset} ${s}`);
const info = (s) => console.log(`  ${c.gray}${s}${c.reset}`);
const rule = () => console.log(`  ${c.gray}${"─".repeat(44)}${c.reset}`);
const head = (s) => console.log(`\n  ${c.bold}${s}${c.reset}`);

function banner() {
  console.log("");
  console.log(`  ${c.brand}${c.bold}◍ BAG IDEA${c.reset}  ${c.gray}·${c.reset}  ${c.bold}Office${c.reset}`);
  console.log(`  ${c.gray}your wallpaper, at work${c.reset}`);
}

// ---- quoting a path into somebody else's language ----------------------------
// A path handed to a shell or to AppleScript has to be quoted for THAT language,
// not eyeballed. The install root and the temp dir both follow the user's account
// name, and an account called O'Brien puts an apostrophe in the middle of every
// path we build — which closes a single-quoted string and turns the rest of the
// path into code to run.
const shQuote  = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const osaQuote = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// ---- tiny http ---------------------------------------------------------------
function req(method, p, body, asBuffer) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(BASE + p, {
      method,
      headers: {
        "x-bagidea-ui": "1",
        ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (ch) => chunks.push(ch));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (asBuffer) return resolve({ status: res.statusCode, buf });
        try { resolve(JSON.parse(buf.toString("utf8"))); }
        catch { resolve(buf.toString("utf8")); }
      });
    });
    r.setTimeout(method === "POST" && (p === "/chat" || p === "/tts" || p === "/gen/image" || p.startsWith("/codex/"))
      ? 11 * 60000 : 8000, () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}
async function daemonUp() {
  try { return !!(await req("GET", "/health")); } catch { return false; }
}

// ---- help --------------------------------------------------------------------
function row(left, right) {
  const pad = 22;
  const gap = " ".repeat(Math.max(2, pad - left.length));
  console.log(`  ${c.accent}${left}${c.reset}${gap}${c.gray}${right}${c.reset}`);
}
function help() {
  banner();
  console.log(`\n  ${c.gray}Usage${c.reset}  ${c.bold}bagidea${c.reset} ${c.gray}<command> [args]${c.reset}`);

  head("Suite");
  row("start", "Launch the office (if not already running)");
  row("stop", "Shut it all down — shell · wallpaper · daemon");
  row("restart", "Stop everything, then start it fresh");
  row("status", "System overview · agents · projects");
  row("stats", "7-day activity + cost report");
  row("update", "Update to the latest version + restart");
  row("startup [on|off]", process.platform === "win32" ? "Launch the office automatically with Windows" : "Launch the office automatically at login");
  row("uninstall [--keep-data]", process.platform === "win32" ? "Remove the app (PATH, shortcut, autostart, files)" : "Remove the app (PATH, login item, files)");

  head("Talk to the office");
  row('ask "<msg>"', "Order as the CEO and wait for the answer");
  row('chat <agent> "<msg>"', "Hand a task to a specific agent");
  row("feed", "Live event stream (Ctrl+C to exit)");
  row('note "<msg>"', "Pin a note to the central board");

  head("Team & work");
  row("agents", "Roster — roles · voices · tools");
  row("brains", "Per-agent model + provider connect status");
  row("projects", "Projects + who is working on them");
  row('open "<project>"', "Open a project window");
  row("editor", "Open the 3D Office Editor");
  row("jobs", "Scheduled / recurring agent jobs");
  row("proposals", "Team project pitches awaiting a verdict");
  row("proposal show <id>", "Read a pitch in full");
  row("proposal <approve|reject> <id> [message]", "Decide on a pitch (+ optional note)");
  row("memory <agent>", "Read an agent's memory");
  row("office", "Read OFFICE.md (shared brief)");

  head(`AI features ${c.gray}(use the main API keys)${c.reset}`);
  row('say "<msg>" [preset]', "Speak it with a TTS voice (default: sunny)");
  row("voices", "List the TTS voice presets");
  row('image "<prompt>"', "Generate an AI image → file path");

  head("Configure");
  row("lang [code]", "Show / set the office language (14 languages)");
  row("auto [on|off]", "🤖 Keep going without asking — decide and finish the job");
  row("eco [on|off]", "🌱 Cut idle token burn (rhythms stretch, QA pass off)");
  row("trust [allow|deny]", "🛡 Projects whose own hooks are waiting on your word");
  row("keys", "List configured API keys (values hidden)");
  row("key set <NAME> <value>", "Add a key · key rm <NAME> · key test [NAME]");
  row("channels", "Telegram / Discord / LINE status");
  row("plugins", "Installed plugins");
  row("plugin install <git-url>", "Add a plugin · plugin remove <id>");

  head("Move to a new machine");
  row("export [file]", "Pack agents · skills · memory · plugins → one .tgz");
  row("import <file>", "Restore an exported office here (overwrites)");

  head("Inbox");
  row("inbox", "What's waiting for you, and what's unread");
  row("approve <n|id> [note]", "Answer an item · deny <n|id> [note] · answer <n|id> <option> [note]");
  row("notify [test]", "Unread notifications · `notify test` sends one through your rules");
  row("budget", "Today's spend vs your caps (office · agent · project)");
  row("budget set office 5", "Cap the office at $5/day · set agent <id> 2 · set project <id> 40 · off");
  row("budget digest [on|off|HH:MM]", "Morning digest: yesterday's spend + what's waiting");
  head("Work");
  row("tasks [todo|doing|waiting|done]", "The task board — every open card, or one column");
  row('task add "<title>" [--owner id] [--due YYYY-MM-DD] [--p 1-4]', "Add a card · task done <n|id> · task move <n|id> <status>");
  row('cal [add "<title>" <YYYY-MM-DDTHH:MM> [--every day|week|month]]', "Upcoming events (30 days) · `cal ics > office.ics` exports");
  row('codex ["<task>" --project <name>]', "Codex status + recent runs, or hand it a task · codex review [project]");
  row("teams · hire --team <id>", "Pre-built teams (dev-shop · research-lab · content-studio · customer-support · solo-assistant)");
  row("plugin library · plugin install <id>", "The official plugins that ship with the office — install by id");

  head("Maintenance");
  row("doctor", "Diagnose why the office won't load (ports, proxy, firewall)");
  row("fixmic", "Reset Windows voice-typing if it's stuck");
  row("--version, -v", "Show version");
  row("--help, -h", "Show this screen");
  console.log("");
}

const { findShellExe: _findShell } = require("./find-shell");

function findShellExe() {
  return _findShell(ROOT);
}

const NOT_RUNNING = () => bad(`The office isn't running — run ${c.accent}bagidea start${c.reset} first`);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || ["help", "--help", "-h"].includes(cmd)) return help();

  if (["version", "--version", "-v"].includes(cmd)) {
    let ver = "0.0.0";
    try { ver = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim(); } catch {}
    let build = "";
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
      const date = execFileSync("git", ["log", "-1", "--format=%cd", "--date=short"], { cwd: ROOT }).toString().trim();
      build = ` ${c.gray}(build ${sha} · ${date})${c.reset}`;
    } catch {}
    console.log(`  ${c.brand}${c.bold}BAG IDEA Office${c.reset} ${c.accent}v${ver}${c.reset}${build}`);
    // If the office is running, it knows the latest released version too.
    if (await daemonUp()) {
      try {
        const v = await req("GET", "/version");
        if (v && v.updateAvailable)
          warn(`A new version is available: ${c.accent}v${v.latest}${c.reset} — run ${c.accent}bagidea update${c.reset}`);
        else if (v && v.latest) ok("You're on the latest version");
      } catch {}
    }
    return;
  }

  if (cmd === "startup") {
    // Autostart toggle (HKCU Run key on Windows, LaunchAgent on macOS).
    if (!(await daemonUp())) return NOT_RUNNING();
    const arg = (rest[0] || "").toLowerCase();
    if (!arg) {
      const s = await req("GET", "/startup");
      const label = process.platform === "win32" ? "Start with Windows" : "Start at login";
      return info(`${label} is ${s && s.on ? c.ok + "ON" : c.gray + "OFF"}${c.reset}` +
        ` ${c.gray}— bagidea startup on|off${c.reset}`);
    }
    if (!["on", "off"].includes(arg)) return bad("usage: bagidea startup on|off");
    const r = await req("POST", "/startup", { on: arg === "on" });
    return r && r.on ? ok(process.platform === "win32" ? "The office will launch with Windows" : "The office will launch at login")
      : ok("Auto-start disabled");
  }

  // --- process control shared by start / stop / restart -----------------------
  const killAll = () => new Promise((res) => {
    if (process.platform === "win32") {
      const KILL_PS = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'server\\.js') -or $_.Name -eq 'bagidea-office-shell.exe' -or $_.Name -like 'Godot*' -or $_.Name -eq 'BagIdeaOffice.exe' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F } | Out-Null";
      spawn("powershell", ["-NoProfile", "-Command", KILL_PS], { stdio: "ignore" }).on("close", res);
    } else {
      // macOS/Linux: pkill for name patterns, killall for exact names
      // We don't want to kill ALL 'node' processes, just the ones with 'server.js'
      const script = `
        pkill -f "node.*server\\.js" || true
        killall bagidea-office-shell || true
        pkill -f "BagIdeaOffice" || true
      `;
      spawn("sh", ["-c", script], { stdio: "ignore" }).on("close", res);
    }
  });
  const startOffice = async (verb) => {
    const exe = findShellExe();
    if (!exe) { bad(`shell exe not found — run ${c.accent}cargo build --release${c.reset} in shell/`); return false; }
    spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" }).unref();
    process.stdout.write(`  ${c.gray}${verb}${c.reset}`);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      process.stdout.write(`${c.gray}.${c.reset}`);
      if (await daemonUp()) { console.log(""); return true; }
    }
    console.log("");
    warn("Still booting — if the office isn't on screen yet, give it a moment");
    return false;
  };

  if (cmd === "start") {
    if (await daemonUp()) return ok("The office is already running");
    if (await startOffice("starting the office")) ok("The office is ready 🏢");
    return;
  }

  if (cmd === "stop") {
    await killAll();
    return ok("The office is closed");
  }

  if (cmd === "restart") {
    // ALWAYS kill — never gate on /health. A half-dead daemon (process alive
    // but not answering, or a stale shell holding the single-instance lock)
    // reports "down", and gating the kill on that left the old shell running
    // so the fresh one bailed on the single-instance check → nothing restarted.
    info("Stopping the office…");
    await killAll();
    // let Windows release the processes + port 8787 before relaunching
    await new Promise((r) => setTimeout(r, 2500));
    if (await startOffice("restarting the office")) ok("The office is back 🏢");
    return;
  }

  if (cmd === "editor") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const r = await req("POST", "/editor/open", {});
    if (r && r.error) return bad(r.error);   // e.g. Godot engine missing on this machine
    return ok("Opening the 3D Office Editor (separate window) — save when you're done");
  }

  if (cmd === "auto") {
    // 🤖 Keep-going mode — the team decides for itself and opens its own next
    // turn instead of stopping mid-job to ask you. Off by default.
    if (!(await daemonUp())) return NOT_RUNNING();
    const arg = (rest[0] || "").toLowerCase();
    if (!arg) {
      const s = await req("GET", "/registry");
      return info(`Keep-going mode is ${s && s.autoPilot ? c.ok + "ON" : c.gray + "OFF"}${c.reset} ${c.gray}— bagidea auto on|off${c.reset}`);
    }
    if (!["on", "off"].includes(arg)) return bad("usage: bagidea auto on|off");
    const r = await req("POST", "/registry/autopilot", { on: arg === "on" });
    return r && r.auto
      ? ok(`Keep-going mode ON — the team decides and works on without asking (up to ${(r.max || 8)} rounds per job; it still stops for missing access and irreversible actions)`)
      : ok("Keep-going mode OFF — they check with you before big calls");
  }

  if (cmd === "trust") {
    // 🛡 Projects whose own .claude hooks are waiting on your word (issue #39).
    // Work inside them is parked until you answer, so the terminal needs a way
    // to answer too — not only the office window.
    if (!(await daemonUp())) return NOT_RUNNING();
    const list = (await req("GET", "/project/trust")) || [];
    const arg = (rest[0] || "").toLowerCase();
    if (!arg) {
      if (!list.length) return info("No project is waiting for a trust decision");
      for (const t of list) {
        console.log(`\n  ${c.bold}${t.project}${c.reset}  ${c.gray}${t.dir}${c.reset}`);
        console.log(`  ${t.changed ? "hooks CHANGED after your approval" : "ships its own hooks — they run by themselves when work opens here"}`);
        for (const h of t.hooks || []) console.log(`    ${c.gray}${h.event} →${c.reset} ${h.command}`);
        for (const s of (t.scripts || []).filter((x) => x.outside))
          console.log(`    ${c.warn || c.gray}⚠ ${s.rel} resolves outside the project${c.reset}`);
        console.log(`  ${c.gray}bagidea trust allow "${t.project}"  |  bagidea trust deny "${t.project}"${c.reset}`);
      }
      return;
    }
    if (!["allow", "deny"].includes(arg)) return bad('usage: bagidea trust [allow|deny] "<project>"');
    const name = (rest.slice(1).join(" ") || "").toLowerCase();
    const hit = name ? list.find((t) => String(t.project).toLowerCase() === name) : list[0];
    if (!hit) return bad(list.length ? "no pending project by that name" : "nothing is waiting for a trust decision");
    await req("POST", "/project/trust", { id: hit.trust, decision: arg });
    return ok(arg === "allow"
      ? `Trusted “${hit.project}” — its hooks may run, and parked work resumes now (any edit to them asks again)`
      : `Denied “${hit.project}” — its hooks stay blocked and the parked work is dropped`);
  }

  if (cmd === "eco") {
    // 🌱 Eco mode — one switch that cuts idle token burn (rhythms stretch,
    // QA double-pass off). Direct orders are never throttled.
    if (!(await daemonUp())) return NOT_RUNNING();
    const arg = (rest[0] || "").toLowerCase();
    if (!arg) {
      const s = await req("GET", "/registry");
      return info(`Eco mode is ${s && s.ecoMode ? c.ok + "ON" : c.gray + "OFF"}${c.reset} ${c.gray}— bagidea eco on|off${c.reset}`);
    }
    if (!["on", "off"].includes(arg)) return bad("usage: bagidea eco on|off");
    const r = await req("POST", "/registry/eco", { on: arg === "on" });
    return r && r.eco
      ? ok("Eco mode ON — idle rhythms stretched, QA double-pass off (your direct orders are never slowed)")
      : ok("Eco mode OFF — full office rhythm restored");
  }

  // ---- 📥 inbox --------------------------------------------------------------
  if (cmd === "inbox") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const j = await req("GET", "/inbox");
    banner();
    head(`📥 Waiting for you (${j.pending.length})`);
    if (!j.pending.length) ok("nothing — the office isn't waiting on you");
    j.pending.forEach((it, n) => {
      console.log(`  ${c.accent}${n + 1}${c.reset}. ${c.bold}${it.title}${c.reset}  ${c.gray}[${it.kind}${it.agent ? " · " + it.agent : ""}]${c.reset}`);
      if (it.detail) console.log(`     ${c.gray}${String(it.detail).split("\n")[0].slice(0, 100)}${c.reset}`);
      console.log(`     ${c.gray}${it.options.map((o) => o.value).join(" / ")}  →  bagidea answer ${n + 1} ${it.options[0].value}${c.reset}`);
    });
    head(`🔔 Notifications — ${j.unread} unread`);
    (j.recent || []).slice(0, 8).forEach((it) => console.log(`  ${it.read ? c.gray + "·" : c.warn + "•"}${c.reset} ${it.title}${c.gray}${it.body ? " — " + String(it.body).split("\n")[0].slice(0, 70) : ""}${c.reset}`));
    console.log("");
    return;
  }
  if (cmd === "approve" || cmd === "deny" || cmd === "answer") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const target = rest[0];
    if (!target) return bad(`usage: bagidea ${cmd} <n|id> ${cmd === "answer" ? "<option> " : ""}[note]`);
    const pend = (await req("GET", "/approvals?pending=1")).items || [];
    const item = /^\d+$/.test(target) ? pend[Number(target) - 1] : pend.find((i) => i.id === target);
    if (!item) return bad(`nothing pending matches "${target}" — see: bagidea inbox`);
    let decision, note;
    if (cmd === "answer") { decision = rest[1]; note = rest.slice(2).join(" "); }
    else { decision = cmd === "approve" ? item.options[0].value : item.options[item.options.length - 1].value; note = rest.slice(1).join(" "); }
    if (!item.options.some((o) => o.value === decision))
      return bad(`"${decision}" isn't an option here — one of: ${item.options.map((o) => o.value).join(", ")}`);
    const r = await req("POST", "/approvals/respond", { id: item.id, decision, note });
    if (r && r.ok) ok(`${decision} → ${item.title}${note ? `  (${note})` : ""}`);
    else bad("that item is no longer waiting");
    return;
  }
  if (cmd === "notify") {
    if (!(await daemonUp())) return NOT_RUNNING();
    if (rest[0] === "test") {
      const r = await req("POST", "/notify/send", { kind: "system", title: "🔔 Test notification",
        body: "Sent from the terminal — if you can see this in the sidebar (and on your phone, if a channel is on), the rules work." });
      ok(`sent · routed: ${Object.entries(r.routed || {}).filter(([k, v]) => v === true && k !== "quietNow" && k !== "away").map(([k]) => k).join(", ") || "centre only"}` +
         (r.routed && r.routed.quietNow ? "  (quiet hours)" : "") + (r.routed && r.routed.away ? "  (you're marked away)" : ""));
      return;
    }
    const j = await req("GET", "/notify?unread=1&limit=30");
    head(`🔔 ${j.unread} unread`);
    (j.items || []).forEach((it) => console.log(`  ${c.warn}•${c.reset} ${it.title}${c.gray}${it.body ? " — " + String(it.body).split("\n")[0].slice(0, 80) : ""}${c.reset}`));
    if (!j.unread) ok("nothing unread");
    console.log("");
    return;
  }

  // ---- 💸 budget -------------------------------------------------------------
  if (cmd === "budget") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const usd = (n) => "$" + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
    const sub = rest[0];
    if (sub === "set") {
      const [scope, a, b] = rest.slice(1);
      let patch = null;
      if (scope === "office") patch = { office: { daily: Number(a) } };
      else if (scope === "agent" && a) patch = { agents: { [a]: { daily: Number(b) } } };
      else if (scope === "project" && a) patch = { projects: { [a]: { total: Number(b) } } };
      if (!patch) return bad("usage: bagidea budget set office <usd/day> | agent <id> <usd/day> | project <id> <usd total>");
      await req("POST", "/budget", patch);
      ok(`cap set — ${scope}${scope !== "office" ? " " + a : ""}: ${usd(scope === "office" ? a : b)}${scope === "project" ? " total" : " / day"}`);
      return;
    }
    if (sub === "off") { await req("POST", "/budget", { office: { daily: 0 } }); return ok("office cap removed (per-agent and per-project caps untouched)"); }
    if (sub === "digest") {
      const v = rest[1];
      if (v === "on" || v === "off") { await req("POST", "/budget", { digest: { enabled: v === "on" } }); return ok(`digest ${v}`); }
      if (/^\d\d:\d\d$/.test(v || "")) { await req("POST", "/budget", { digest: { enabled: true, time: v } }); return ok(`digest at ${v} every morning`); }
      const r = await req("POST", "/budget/digest", {});
      console.log(""); console.log(r.text.split("\n").map((l) => "  " + l).join("\n")); console.log(""); return;
    }
    const j = await req("GET", "/budget");
    banner();
    head(`💸 Today (${j.day})`);
    const bar = (spent, cap) => cap ? `${usd(spent)} / ${usd(cap)}  ${Math.round(spent / cap * 100)}%${spent >= cap ? c.err + "  STOPPED" + c.reset : spent >= cap * j.warnAt ? c.warn + "  warning" + c.reset : ""}` : `${usd(spent)}  ${c.gray}(no cap)${c.reset}`;
    console.log(`  office   ${bar(j.office.spent, j.office.cap)}${j.office.estimated ? c.gray + "  ≈ includes estimates" + c.reset : ""}`);
    const agents = Object.entries(j.agents || {}); if (agents.length) { head("agents"); for (const [id, a] of agents) console.log(`  ${id.padEnd(14)} ${bar(a.spent, a.cap)}`); }
    const projects = Object.entries(j.projects || {}); if (projects.length) { head("projects (lifetime)"); for (const [id, p] of projects) console.log(`  ${id.padEnd(14)} ${bar(p.total, p.cap)}`); }
    info(`digest: ${j.digest.enabled ? "on at " + j.digest.time : "off"}  ·  set caps: bagidea budget set office 5`);
    console.log("");
    return;
  }

  // ---- 👥 teams (v1.5) --------------------------------------------------------
  if (cmd === "teams") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const j = await req("GET", "/teams");
    banner(); head(`👥 Team templates (${j.staff}/${j.max} staff)`);
    for (const t of j.teams || []) {
      console.log(`  ${c.bold}${t.id.padEnd(18)}${c.reset} ${t.name}  ${c.gray}${t.tagline}${c.reset}`);
      console.log(`  ${" ".repeat(18)} ${c.gray}${t.agents.map((a) => (a.present ? "✓ " : "") + a.name + " (" + a.role + ")").join(" · ")}${c.reset}`);
    }
    info("hire one: bagidea hire --team dev-shop");
    console.log(""); return;
  }
  if (cmd === "hire") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const i = rest.indexOf("--team"); const id = i > -1 ? rest[i + 1] : rest[0];
    if (!id) return bad("usage: bagidea hire --team <id>   (see: bagidea teams)");
    const r = await req("POST", "/teams/hire", { id });
    if (!r || typeof r === "string") return bad(String(r || "hire failed"));
    if (r.hired.length) ok(`hired ${r.hired.join(", ")} (${r.staff}/${r.max} staff)`);
    for (const s of r.skipped || []) warn(`skipped ${s.id}: ${s.why}`);
    if (!r.hired.length && !(r.skipped || []).length) info("nothing to hire");
    return;
  }

  // ---- 📋 tasks / 📅 calendar / 🧑‍💻 codex (v1.4) --------------------------------
  const flag = (name) => { const i = rest.indexOf("--" + name); return i > -1 ? rest[i + 1] : undefined; };
  const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  if (cmd === "tasks") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const j = await req("GET", "/tasks/board");
    const cols = rest[0] && j.board[rest[0]] ? [rest[0]] : ["todo", "doing", "waiting", "done"];
    banner();
    const sm = j.summary || {};
    info(`${sm.open || 0} open · ${sm.doing || 0} doing · ${sm.waiting || 0} waiting · ${sm.overdue || 0} overdue · ${sm.doneToday || 0} done today`);
    let n = 0;
    for (const col of cols) {
      const items = col === "done" ? j.board.done.slice(0, 8) : j.board[col];
      head(`${{ todo: "📝", doing: "🔨", waiting: "⏸", done: "✅" }[col]} ${col.toUpperCase()} (${j.board[col].length})`);
      if (!items.length) console.log(`  ${c.gray}—${c.reset}`);
      for (const t of items) {
        n++;
        const who = t.owner === "you" ? "you" : (j.agents[t.owner] || t.owner);
        console.log(`  ${c.accent}${String(n).padStart(2)}${c.reset}. ${t.priority <= 2 ? c.warn : ""}P${t.priority}${c.reset} ${c.bold}${t.title}${c.reset}  ${c.gray}${who}${t.project ? " · " + t.project : ""}${t.due ? " · due " + new Date(t.due).toLocaleDateString() : ""}${t.blocked ? " · 🔒" : ""}${t.overdue ? c.err + " · OVERDUE" + c.reset : ""} [${t.id}]${c.reset}`);
      }
    }
    console.log("");
    return;
  }
  if (cmd === "task") {
    if (!(await daemonUp())) return NOT_RUNNING();
    const sub = rest[0];
    if (sub === "add") {
      const title = positional().slice(1).join(" ").trim();
      if (!title) return bad('usage: bagidea task add "<title>" [--owner <id>] [--due YYYY-MM-DD] [--p 1-4] [--project <name>]');
      const t = await req("POST", "/tasks", { title, owner: flag("owner") || "you", due: flag("due") || "", priority: Number(flag("p")) || 3, project: flag("project") || "" });
      return t && t.id ? ok(`added [${t.id}] ${t.title}${t.status === "waiting" ? " (waiting)" : ""}`) : bad(String(t && t.error || t));
    }
    if (sub === "done" || sub === "move") {
      const target = rest[1], status = sub === "done" ? "done" : rest[2];
      if (!target || !status) return bad(`usage: bagidea task ${sub} <n|id>${sub === "move" ? " <todo|doing|waiting|done>" : ""}`);
      const j = await req("GET", "/tasks/board");
      const all = [].concat(j.board.todo, j.board.doing, j.board.waiting, j.board.done.slice(0, 8));
      const item = /^\d+$/.test(target) ? all[Number(target) - 1] : all.find((t) => t.id === target) || (await req("GET", "/tasks")).tasks.find((t) => t.id === target);
      if (!item) return bad(`no card matches "${target}" — see: bagidea tasks`);
      const r = await req("POST", "/tasks/move", { id: item.id, status });
      return r && r.id ? ok(`${status} → ${item.title}`) : bad(String(r));
    }
    return bad("usage: bagidea task add \"<title>\" | done <n|id> | move <n|id> <status>");
  }
  if (cmd === "cal") {
    if (!(await daemonUp())) return NOT_RUNNING();
    if (rest[0] === "ics") { process.stdout.write(String(await req("GET", "/calendar/ics"))); return; }
    if (rest[0] === "add") {
      const p = positional().slice(1);
      const when = p[p.length - 1], title = p.slice(0, -1).join(" ").trim();
      if (!title || !when || Number.isNaN(Date.parse(when))) return bad('usage: bagidea cal add "<title>" <YYYY-MM-DDTHH:MM> [--every day|week|month] [--remind <min>]');
      const every = flag("every");
      const rec = every ? { freq: { day: "daily", week: "weekly", month: "monthly" }[every] || every } : null;
      const r = await req("POST", "/calendar", { title, at: when, remindMin: Number(flag("remind")) || 10, recurrence: rec });
      return r && r.id ? ok(`booked ${r.title} — ${new Date(r.at).toLocaleString()}${rec ? " · every " + every : ""}`) : bad(String(r));
    }
    const j = await req("GET", "/calendar");
    banner(); head(`📅 Next 30 days (${(j.upcoming || []).length})`);
    if (!(j.upcoming || []).length) ok("nothing booked");
    for (const o of (j.upcoming || []).slice(0, 40))
      console.log(`  ${o.recurring ? "🔁" : "📅"} ${c.bold}${new Date(o.at).toLocaleString()}${c.reset}  ${o.title}${o.allDay ? c.gray + "  (all day)" + c.reset : ""}`);
    console.log("");
    return;
  }
  if (cmd === "codex") {
    if (!(await daemonUp())) return NOT_RUNNING();
    if (rest[0] === "review") {
      info("asking Codex for a review… (this can take minutes)");
      const r = await req("POST", "/codex/review", { project: rest[1] || flag("project") || "", instructions: flag("ask") || "" });
      console.log(""); console.log((r.text || r.error || "").split("\n").map((l) => "  " + l).join("\n")); console.log("");
      return r.ok ? ok("review done") : bad("review failed: " + (r.error || "unknown"));
    }
    const task = positional().join(" ").trim();
    if (task) {
      info("Codex is working… (the call returns when it finishes)");
      const r = await req("POST", "/codex/exec", { task, project: flag("project") || "", sandbox: flag("sandbox") });
      console.log(""); console.log((r.text || r.error || "").split("\n").map((l) => "  " + l).join("\n")); console.log("");
      if (r.diff && r.diff.files) info(`changes: ${r.diff.files} file(s) ${r.diff.summary ? "— " + r.diff.summary : ""}`);
      return r.ok ? ok("done") : bad("failed: " + (r.error || "unknown"));
    }
    const j = await req("GET", "/codex/status");
    banner();
    head("🧑‍💻 Codex");
    if (j.installed) ok(`codex ${j.version} · sandbox ${j.settings.sandbox}${j.settings.model ? " · model " + j.settings.model : ""}${j.settings.oss ? " · local (" + j.settings.localProvider + ")" : ""}${j.settings.enabled ? "" : c.warn + " · switched OFF" + c.reset}`);
    else bad("codex not found — npm i -g @openai/codex, then: codex login");
    if ((j.runs || []).length) { head("recent runs"); for (const r of j.runs.slice(0, 10)) console.log(`  ${r.state === "done" ? "✅" : r.state === "running" ? "🔴" : "✗"} ${c.gray}${new Date(r.startedAt).toLocaleTimeString()}${c.reset} ${r.kind === "review" ? "review" : r.task.slice(0, 70)}${r.diff && r.diff.files ? c.gray + "  ✎ " + r.diff.files : ""}${c.reset}`); }
    info('hand it a task: bagidea codex "add a --json flag to the exporter" --project my-app');
    console.log("");
    return;
  }

  // Runs WITHOUT the daemon on purpose — an unreachable daemon is the thing it
  // is meant to explain.
  if (cmd === "doctor") {
    banner();
    const rc = await require("./doctor").run({ ok, bad, warn, info, head, rule });
    process.exitCode = rc > 0 ? 1 : 0;
    return;
  }
  if (cmd === "fixmic") {
    if (process.platform !== "win32") return info("Voice-typing reset is only applicable on Windows");
    spawn("powershell", ["-NoProfile", "-Command",
      "Get-Process TextInputHost -ErrorAction SilentlyContinue | Stop-Process -Force"],
      { stdio: "ignore" }).on("close", () =>
      ok("Voice-typing panel reset (Windows reopens it on its own)"));
    return;
  }
  if (cmd === "update") {
    if (process.platform === "darwin") {
      const sh = path.join(ROOT, "installer", "update-mac.sh");
      if (!fs.existsSync(sh)) return bad("installer/update-mac.sh not found");
      info("Updating… (the app will restart itself)");
      spawn("bash", [sh], { cwd: ROOT, detached: true, stdio: "inherit" });
      return;
    }
    if (process.platform !== "win32") {
      // Linux: a helper script does git pull + rebuild-if-changed + restart.
      const sh = path.join(ROOT, "installer", "update-linux.sh");
      if (fs.existsSync(sh)) {
        info("Updating… (the app will restart itself)");
        spawn("bash", [sh], { cwd: ROOT, detached: true, stdio: "inherit" });
        return;
      }
      return info(`Run ${c.accent}git pull${c.reset}, then ${c.accent}cargo build --release${c.reset} in ${c.accent}shell/${c.reset} if it changed, then ${c.accent}bagidea restart${c.reset}.`);
    }
    const ps = path.join(ROOT, "installer", "update.ps1");
    if (!fs.existsSync(ps)) return bad("installer/update.ps1 not found");
    info("Updating… (the app will restart itself)");
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps],
      { cwd: ROOT, detached: true, stdio: "inherit" });
    return;
  }

  // --- migrate: pack the whole office → move it to another machine ------------
  // Everything that makes an office YOURS lives in three places: daemon/*.json
  // state (registry = agents/skills/keys/brains, plus jobs/notes/calendar/…),
  // workspace/ (agent memory, meetings, projects, uploads) and plugins/.
  // We tar those relative to ROOT with the system tar — it ships with
  // Windows 10+, macOS and Linux, so the CLI stays zero-dependency.
  const exportPaths = () => {
    const daemonState = ["registry.json", "jobs.json", "notes.json", "calendar.json",
      "layout.json", "projects.json", "proposals.json", "paused.json", "assets.json",
      "mcp_main.json"].map((f) => "daemon/" + f);
    return [...daemonState, "daemon/i18n", "workspace", "plugins"]
      .filter((p) => fs.existsSync(path.join(ROOT, p)));
  };
  // node_modules are reinstallable, _trash/temp/staging are scratch — real
  // offices carry 100+ MB of them for nothing. Both pattern shapes so any tar
  // flavor (bsdtar on Win/mac, GNU on Linux) drops them at every depth.
  const TAR_SKIP = ["--exclude=node_modules", "--exclude=*/node_modules",
    "--exclude=_trash", "--exclude=*/_trash", "--exclude=.DS_Store",
    "--exclude=workspace/temp", "--exclude=workspace/staging"];
  // Run tar from the archive's own folder and pass -f a bare basename: GNU tar
  // reads "C:\…" as a REMOTE host:path (bsdtar doesn't take --force-local, so
  // the flag can't fix it portably) — a colon-free -f dodges it on every tar.
  const tarRun = (dir, args) =>
    execFileSync("tar", args, { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });

  if (cmd === "export") {
    const out = path.resolve(rest.find((a) => !a.startsWith("-")) ||
      `bagidea-office-backup-${new Date().toISOString().slice(0, 10)}.tgz`);
    const paths = exportPaths();
    if (!paths.includes("daemon/registry.json"))
      return bad("nothing to export — daemon/registry.json not found (has the office ever run?)");
    info("Packing: " + paths.join(" · "));
    try {
      tarRun(path.dirname(out), [...TAR_SKIP, "-czf", path.basename(out), "-C", ROOT, ...paths]);
    } catch (e) { return bad("tar failed: " + (e && e.message)); }
    const mb = (fs.statSync(out).size / 1048576).toFixed(1);
    ok(`Exported → ${c.accent}${out}${c.reset} ${c.gray}(${mb} MB)${c.reset}`);
    warn("This file contains your API keys and agent data — keep it private, delete it after importing.");
    info(`On the new machine: install BagIdea Office, then run ${c.accent}bagidea import "${path.basename(out)}"${c.reset}`);
    return;
  }

  if (cmd === "import") {
    const file = rest.find((a) => !a.startsWith("-"));
    if (!file) return bad("usage: bagidea import <backup.tgz>");
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) return bad("not found: " + abs);
    let names = [];
    try {
      names = execFileSync("tar", ["-tzf", path.basename(abs)],
        { cwd: path.dirname(abs), encoding: "utf8", maxBuffer: 64 * 1048576 })
        .split("\n").map((n) => n.trim()).filter(Boolean);
    } catch (e) { return bad("not a readable backup: " + (e && e.message)); }
    if (!names.includes("daemon/registry.json"))
      return bad("this archive has no daemon/registry.json — not a bagidea export");
    // Only our three roots, only relative paths — refuse anything a crafted
    // archive could use to write outside the install (absolute, .., drive:).
    const stray = names.find((n) =>
      !/^(daemon|workspace|plugins)(\/|$)/.test(n) || n.split("/").includes("..") || n.includes(":"));
    if (stray) return bad("archive contains an unexpected path: " + stray);
    const doImport = async () => {
      info("Stopping the office…");
      await killAll();
      await new Promise((r) => setTimeout(r, 2500));
      const regNow = path.join(ROOT, "daemon", "registry.json");
      if (fs.existsSync(regNow)) {
        const bak = regNow + ".pre-import-" + new Date().toISOString().slice(0, 10);
        fs.copyFileSync(regNow, bak);
        info(`Current team backed up → ${c.accent}${path.basename(bak)}${c.reset}`);
      }
      try { tarRun(path.dirname(abs), ["-xzf", path.basename(abs), "-C", ROOT]); }
      catch (e) { return bad("extract failed: " + (e && e.message)); }
      ok(`Imported ${names.length} files`);
      if (await startOffice("starting the office")) ok("The office is back — same team, new machine 🏢");
    };
    if (rest.includes("-y") || rest.includes("--yes")) return doImport();
    warn(`This OVERWRITES this machine's office — agents, skills, memory, keys, plugins (${names.length} files).`);
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${c.warn}Type 'yes' to import:${c.reset} `, (ans) => {
      rl.close();
      if (String(ans).trim().toLowerCase() === "yes") doImport();
      else info("Cancelled — nothing was changed.");
    });
    return;
  }

  if (cmd === "uninstall") {
    if (process.platform === "darwin") {
      const sh = path.join(ROOT, "installer", "uninstall-mac.sh");
      if (!fs.existsSync(sh)) return bad("installer/uninstall-mac.sh not found");
      const keepData = rest.includes("--keep-data");
      const shArgs = [sh];
      if (keepData) shArgs.push("--keep-data");
      const go = () => {
        info("Uninstalling… a new Terminal window finishes up.");
        // Two languages, two quotings: the command is built for the shell, then
        // the whole thing is quoted again as an AppleScript string literal.
        const inner = "bash " + shArgs.map(shQuote).join(" ");
        spawn("osascript", ["-e",
          `tell application "Terminal" to do script ${osaQuote(inner)}`,
        ], { detached: true, stdio: "ignore" }).unref();
        process.exit(0);
      };
      if (rest.includes("-y") || rest.includes("--yes")) return go();
      warn(`This removes BagIdea Office — app files, PATH entry, LaunchAgent (autostart).`);
      process.stdout.write("  Continue? (y/N) ");
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.once("line", (a) => { rl.close(); if (/^y/i.test(a.trim())) go(); else info("Cancelled."); });
      return;
    }
    if (process.platform !== "win32") {
      // Linux: remove the autostart entry, then guide the rest (safe — no auto-delete).
      const desk = path.join(require("os").homedir(), ".config", "autostart", "bagidea-office.desktop");
      try { if (fs.existsSync(desk)) fs.unlinkSync(desk); } catch {}
      info(`Removed autostart. To finish: ${c.accent}bagidea stop${c.reset}, delete this folder (${ROOT}), and remove the PATH/symlink to ${c.accent}cli/bagidea${c.reset} from your shell profile (~/.bashrc or ~/.profile).`);
      return;
    }
    const ps = path.join(ROOT, "installer", "uninstall.ps1");
    if (!fs.existsSync(ps)) return bad("installer/uninstall.ps1 not found");
    const keepData = rest.includes("--keep-data");
    const psArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps];
    if (keepData) psArgs.push("-KeepData");
    const go = () => {
      info("Uninstalling… a new window finishes up (this terminal can close).");
      spawn("powershell", psArgs,
        { cwd: require("os").homedir(), detached: true, stdio: "ignore", windowsHide: false }).unref();
      process.exit(0);
    };
    if (rest.includes("-y") || rest.includes("--yes")) return go();
    warn(`This removes BagIdea Office — app files, PATH entry, Start Menu shortcut, autostart`
      + (keepData ? " (your data is backed up first)." : ", AND your data (agents, projects, keys)."));
    info("It does NOT remove Git / Node / Rust / Claude (shared tools).");
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${c.warn}Type 'yes' to uninstall:${c.reset} `, (ans) => {
      rl.close();
      if (String(ans).trim().toLowerCase() === "yes") go();
      else info("Cancelled — nothing was removed.");
    });
    return;
  }

  // ---- everything below needs the daemon --------------------------------------
  if (!(await daemonUp())) return NOT_RUNNING();

  if (cmd === "status") {
    const h = await req("GET", "/health");
    const pr = await req("GET", "/projects");
    const reg = await req("GET", "/registry");
    const f = await req("GET", "/features");
    banner();
    console.log(`\n  ${c.ok}● online${c.reset}   ${c.gray}clients${c.reset} ${h.clients}   ${c.gray}worktree${c.reset} ${h.wt ? c.ok + "✓" + c.reset : c.err + "✗" + c.reset}   ${c.gray}pending perms${c.reset} ${h.pendingPerms}`);
    console.log(`  ${c.gray}keys${c.reset}  OpenAI ${f.openai ? c.ok + "✓" + c.reset : c.gray + "—" + c.reset}   Gemini ${f.gemini ? c.ok + "✓" + c.reset : c.gray + "—" + c.reset}`);
    head("Team");
    for (const [id, a] of Object.entries(reg.agents || {}).filter(([i]) => i !== "ceo"))
      console.log(`  ${c.bold}${a.name}${c.reset} ${c.gray}${id} · ${a.role}${a.voice ? " · 🗣" : ""}${c.reset}`);
    head("Projects");
    if (!(pr.projects || []).length) info("(no projects yet)");
    for (const p of pr.projects || []) {
      const st = p.ai ? `${c.accent}🤖 ${(p.agents || []).join(", ")} working${c.reset}`
        : p.open ? (p.visible ? `${c.ok}🖥 open${c.reset}` : `${c.warn}🫥 background${c.reset}`)
        : `${c.gray}closed${c.reset}`;
      console.log(`  ${c.bold}${p.name}${c.reset} ${c.gray}${p.dir}${c.reset} — ${st}`);
    }
    console.log("");
    return;
  }

  if (cmd === "stats") {
    const s = await req("GET", "/stats");
    const today = s.days[s.days.length - 1];
    banner();
    console.log(`\n  ${c.bold}Today${c.reset}  ${c.bold}${today.runs}${c.reset} jobs   ${c.ok}✓ ${today.done}${c.reset}  ${c.err}✗ ${today.failed}${c.reset}   ${c.warn}$${(today.cost || 0).toFixed(2)}${c.reset}   ${c.gray}uptime ${Math.floor(s.uptimeSec / 3600)}h ${Math.floor((s.uptimeSec % 3600) / 60)}m${c.reset}`);
    {
      const g = (today.aux && today.aux.gemini) || 0, o = (today.aux && today.aux.openai) || 0, cl = today.cost || 0;
      console.log(`  ${c.gray}spend  Claude $${cl.toFixed(2)} · Gemini ≈$${g.toFixed(3)} · OpenAI ≈$${o.toFixed(3)} · total ≈$${(cl + g + o).toFixed(2)}  (Gemini/OpenAI are estimates)${c.reset}`);
    }
    head("Last 7 days");
    const maxR = Math.max(1, ...s.days.map((d) => d.runs));
    for (const d of s.days) {
      const bar = "▉".repeat(Math.round((d.runs / maxR) * 22)) || c.gray + "·" + c.reset;
      console.log(`  ${c.gray}${d.day.slice(5)}${c.reset}  ${c.brand}${bar}${c.reset} ${c.gray}${d.runs}${c.reset}`);
    }
    const ag = Object.entries(today.agents || {}).sort((a, b) => b[1] - a[1]);
    if (ag.length) {
      head("Top agents today");
      for (const [id, n] of ag.slice(0, 6)) console.log(`  ${c.accent}${id}${c.reset} ${c.gray}${n} jobs${c.reset}`);
    }
    console.log("");
    return;
  }

  if (cmd === "ask") {
    const q = rest.join(" ").trim();
    if (!q) return info('Usage: bagidea ask "<message>"');
    info("→ sending as the CEO… (the Director walks over to take it, then waits for the reply)");
    const r = await req("POST", "/chat", { agent: "ceo", prompt: q, wait: true });
    rule();
    console.log("  " + ((r && r.text) || "(no reply)").replace(/\n/g, "\n  "));
    return;
  }

  if (cmd === "chat") {
    const agent = rest[0];
    const q = rest.slice(1).join(" ").trim();
    if (!agent || !q) return info('Usage: bagidea chat <agent_id> "<message>"');
    const r = await req("POST", "/chat", { agent, prompt: q });
    return ok(`Sent to ${c.bold}${agent}${c.reset} (task ${r.task}) — watch ${c.accent}feed${c.reset} or the app window`);
  }

  if (cmd === "agents") {
    const reg = await req("GET", "/registry");
    console.log("");
    for (const [id, a] of Object.entries(reg.agents || {})) {
      if (id === "ceo") continue;
      console.log(`  ${c.bold}${a.name}${c.reset} ${c.gray}${id}${c.reset}  ${a.role} ${c.gray}· tier ${a.tier || 3}${a.voice ? ` · 🗣 ${a.voice}` : ""}${c.reset}`);
      console.log(`  ${c.gray}🎯 ${(a.skills || []).length} skills · 🔧 ${(a.tools || []).join(", ") || "read-only"}${c.reset}\n`);
    }
    return;
  }

  if (cmd === "brains") {
    const b = await req("GET", "/brains");
    const fmtK = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n || 0));
    head("Providers");
    for (const p of b.providers || []) {
      const dot = p.connected ? `${c.ok}●${c.reset}` : `${c.gray}○${c.reset}`;
      const star = p.id === b.defaultProvider ? ` ${c.warn}★${c.reset}` : "";
      console.log(`  ${dot} ${c.bold}${p.label}${c.reset}${star} ${c.gray}· ${(p.agents || []).length} agent${c.reset}`);
    }
    head("Agents · brains");
    for (const a of b.agents || []) {
      const u = a.usage;
      const ctx = u ? `  ${c.gray}📊 ${fmtK(u.in)}/${fmtK(u.win)} (${u.pct}%)${c.reset}` : "";
      console.log(`  ${c.bold}${a.name}${c.reset} ${c.gray}${a.role || ""}${c.reset}  🧠 ${a.tag}${ctx}`);
    }
    console.log("");
    return;
  }

  if (cmd === "projects") {
    const pr = await req("GET", "/projects");
    console.log("");
    for (const p of pr.projects || [])
      console.log(`  ${c.bold}${p.name}${c.reset} ${c.gray}${p.dir}${c.reset}` +
        `${p.ai ? ` ${c.accent}🤖 ${(p.agents || []).join(", ")}${c.reset}` : ""}` +
        `${p.open ? (p.visible ? ` ${c.ok}🖥${c.reset}` : ` ${c.warn}🫥${c.reset}`) : ""}`);
    if (!(pr.projects || []).length) info("(no projects yet)");
    return;
  }

  if (cmd === "open") {
    const name = rest.join(" ").trim().toLowerCase();
    const pr = await req("GET", "/projects");
    const p = (pr.projects || []).find((x) => x.name.toLowerCase() === name);
    if (!p) return bad(`No project by that name — see ${c.accent}bagidea projects${c.reset}`);
    await req("POST", "/projects/open", { id: p.id, mode: "play" });
    return ok(`Opened ${c.bold}${p.name}${c.reset}`);
  }

  if (cmd === "note") {
    const t = rest.join(" ").trim();
    if (!t) return info('Usage: bagidea note "<message>"');
    await req("POST", "/notes", { text: t });
    return ok("Note pinned 📝");
  }

  if (cmd === "memory") {
    const agent = (rest[0] || "main").replace(/[^\w-]/g, "_");
    const f = path.join(ROOT, "workspace", "memory", agent + ".md");
    try { console.log(fs.readFileSync(f, "utf8")); }
    catch { info(`(no memory for ${agent} yet)`); }
    return;
  }

  if (cmd === "office") {
    const t = await req("GET", "/office-md");
    console.log(typeof t === "string" ? t : "");
    return;
  }

  if (cmd === "keys") {
    const reg = await req("GET", "/registry");
    const f = await req("GET", "/features");
    console.log("");
    console.log(`  ${c.bold}Main${c.reset}   OpenAI ${f.openai ? c.ok + "✓ set" + c.reset : c.warn + "not set" + c.reset}   Gemini ${f.gemini ? c.ok + "✓ set" + c.reset : c.warn + "not set" + c.reset}`);
    const extras = Object.keys(reg.apiKeys || {})
      .filter((n) => n !== "OPENAI_API_KEY" && n !== "GEMINI_API_KEY");
    console.log(`  ${c.bold}Extra${c.reset}  ${extras.join(", ") || c.gray + "(none)" + c.reset}`);
    return;
  }

  if (cmd === "channels") {
    const ch = await req("GET", "/channels/status");
    console.log("");
    for (const [k, v] of Object.entries(ch))
      console.log(`  ${k.padEnd(9)} ${v === "on" ? c.ok + "● on" + c.reset
        : v === "off" ? c.gray + "○ off" + c.reset : c.warn + "● " + v + c.reset}`);
    return;
  }

  if (cmd === "say") {
    const presets = ["sunny", "sweet", "cool", "genki", "boyish", "warm", "serious", "polite"];
    const last = rest[rest.length - 1];
    const preset = presets.includes(last) ? last : "sunny";
    const sayText = (presets.includes(last) ? rest.slice(0, -1) : rest)
      .filter((x) => !x.startsWith("--")).join(" ").trim();
    if (!sayText) return info('Usage: bagidea say "<message>" [preset]');
    info(`🗣 synthesizing voice (${preset})…`);
    const r = await req("POST", "/tts", { preset, text: sayText }, true);
    if (r.status !== 200) return bad(r.buf.toString("utf8"));
    const wav = path.join(require("os").tmpdir(), "bagidea_say.wav");
    fs.writeFileSync(wav, r.buf);
    if (process.platform === "win32") {
      // The path travels in the ENVIRONMENT, never in the command text — so there
      // is no string for an apostrophe in it to close. Interpolated here, one
      // statement became three on any account whose name has one.
      spawn("powershell", ["-NoProfile", "-Command",
        "(New-Object Media.SoundPlayer $env:BAGIDEA_SAY_WAV).PlaySync()"],
        { stdio: "ignore", env: { ...process.env, BAGIDEA_SAY_WAV: wav } })
        .on("close", () => ok("Done speaking"));
    } else if (process.platform === "darwin") {
      spawn("afplay", [wav], { stdio: "ignore" })
        .on("close", () => ok("Done speaking"));
    } else {
      // Linux: try common players in order until one plays the WAV.
      const players = [["paplay", [wav]], ["aplay", ["-q", wav]],
        ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", wav]], ["play", [wav]]];
      (function tryPlay(i) {
        if (i >= players.length) return info("Saved the voice but found no audio player (install pulseaudio-utils or alsa-utils): " + wav);
        const p = spawn(players[i][0], players[i][1], { stdio: "ignore" });
        p.on("error", () => tryPlay(i + 1));
        p.on("close", (code) => code === 0 ? ok("Done speaking") : tryPlay(i + 1));
      })(0);
    }
    return;
  }

  if (cmd === "image") {
    const prompt = rest.join(" ").trim();
    if (!prompt) return info('Usage: bagidea image "<prompt>"');
    info("🖼 generating image… (this can take a moment)");
    const r = await req("POST", "/gen/image", { prompt });
    if (r && r.path) return ok(`Image ready → ${c.accent}${r.path}${c.reset}`);
    return bad(String(r));
  }

  if (cmd === "feed") {
    const J = path.join(ROOT, "daemon", "journal.jsonl");
    let pos = 0;
    try { pos = fs.statSync(J).size; } catch {}
    info("📡 live events… (Ctrl+C to exit)");
    setInterval(() => {
      let size = 0;
      try { size = fs.statSync(J).size; } catch { return; }
      if (size <= pos) return;
      const fd = fs.openSync(J, "r");
      const buf = Buffer.alloc(size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      pos = size;
      for (const line of buf.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        const t = new Date(e.ts).toLocaleTimeString();
        const ts = `${c.gray}${t}${c.reset}`;
        if (e.type === "chat.message")
          console.log(`${ts} ${c.accent}${e.sub || e.agent}${c.reset}: ${String(e.text).split("\n")[0].slice(0, 110)}`);
        else if (e.type === "task.started")
          console.log(`${ts} ${c.ok}▶${c.reset} ${e.agent}: ${e.title || ""}`);
        else if (e.type === "task.completed") console.log(`${ts} ${c.ok}✓ ${e.agent} done${c.reset}`);
        else if (e.type === "task.failed") console.log(`${ts} ${c.err}✗ ${e.agent} failed${c.reset}`);
        else if (e.type === "perm.requested")
          console.log(`${ts} ${c.warn}🛡 ${e.agent} wants ${e.tool} — click allow in the app${c.reset}`);
        else if (e.type === "task.delegated") console.log(`${ts} 📋 main → ${e.target}`);
        else if (e.type === "channel.message")
          console.log(`${ts} 📨 [${e.channel}] ${e.from}: ${e.text}`);
        else if (e.type === "voice.say")
          console.log(`${ts} ${c.mag}🗣 ${e.agent}: ${e.text}${c.reset}`);
        else if (e.type === "proposal.created")
          console.log(`${ts} ${c.warn}💡 new proposal: ${e.name}${c.reset}`);
      }
    }, 800);
    return;
  }

  if (cmd === "lang") {
    const langs = { en: "🇬🇧 English", zh: "🇨🇳 中文", es: "🇪🇸 Español", hi: "🇮🇳 हिन्दी",
      ar: "🇸🇦 العربية", pt: "🇧🇷 Português", ru: "🇷🇺 Русский", ja: "🇯🇵 日本語",
      de: "🇩🇪 Deutsch", fr: "🇫🇷 Français", ko: "🇰🇷 한국어", id: "🇮🇩 Indonesia",
      vi: "🇻🇳 Tiếng Việt", th: "🇹🇭 ไทย" };
    const code = (rest[0] || "").toLowerCase();
    if (!code) {
      const reg = await req("GET", "/registry");
      const cur = reg.lang || "en";
      console.log(`\n  Office language: ${c.bold}${langs[cur] || cur}${c.reset}`);
      info("Change with: bagidea lang <code>  —  " + Object.keys(langs).join(", "));
      return;
    }
    if (!langs[code]) return bad("Unknown language. Available: " + Object.keys(langs).join(", "));
    await req("POST", "/registry/lang", { lang: code });
    return ok(`Office language set to ${c.bold}${langs[code]}${c.reset}`);
  }

  if (cmd === "voices") {
    const v = await req("GET", "/tts/presets");
    console.log("");
    for (const [id, label] of Object.entries(v))
      console.log(`  ${c.accent}${id.padEnd(10)}${c.reset}${c.gray}${label}${c.reset}`);
    info('\n  Use: bagidea say "<message>" <preset>');
    return;
  }

  if (cmd === "plugins") {
    const r = await req("GET", "/plugins");
    console.log("");
    if (!(r.plugins || []).length) return info("(no plugins installed)");
    for (const p of r.plugins) {
      console.log(`  ${c.bold}${p.name}${c.reset} ${c.gray}${p.id} · v${p.version || "?"}${c.reset}`);
      if (p.description) console.log(`  ${c.gray}${p.description}${c.reset}`);
      const cmds = (p.commands || []).map((x) => x.name || x).filter(Boolean);
      if (cmds.length) console.log(`  ${c.gray}commands: ${cmds.join(", ")}${c.reset}`);
      console.log("");
    }
    return;
  }

  if (cmd === "plugin") {
    const sub = rest[0];
    const arg = rest.slice(1).join(" ").trim();
    if (sub === "install") {
      if (!arg) return info("Usage: bagidea plugin install <git-url | library id>   (bagidea plugin library lists the ids)");
      // A bare id installs from the library that ships with the office.
      if (!/^https?:\/\//.test(arg)) {
        const r = await req("POST", "/plugins/library/install", { id: arg });
        if (r && r.ok) return ok(`Installed ${c.bold}${r.name}${c.reset} from the library`);
        return bad(typeof r === "string" ? r : (r && r.error) || "install failed");
      }
      info("📦 cloning + installing…");
      const r = await req("POST", "/plugins/install", { url: arg });
      if (r && r.ok) return ok(`Installed plugin ${c.bold}${r.name}${c.reset}`);
      return bad(typeof r === "string" ? r : "install failed");
    }
    if (sub === "library" || sub === "lib") {
      const j = await req("GET", "/plugins/library");
      banner(); head("📦 Official plugin library");
      for (const p of j.library || []) console.log(`  ${p.installed ? c.gray + "✓" : c.accent + "·"}${c.reset} ${c.bold}${p.id.padEnd(18)}${c.reset} ${p.name}${c.gray} — ${String(p.description || "").slice(0, 90)}${c.reset}`);
      info("install one: bagidea plugin install <id>");
      console.log(""); return;
    }
    if (sub === "remove" || sub === "rm") {
      if (!arg) return info("Usage: bagidea plugin remove <id>");
      const r = await req("POST", "/plugins/remove", { id: arg });
      if (typeof r === "string" && r && !/^ok$/i.test(r)) return bad(r);
      return ok(`Removed plugin ${c.bold}${arg}${c.reset}`);
    }
    return info("Usage: bagidea plugin <install <git-url | library id> | library | remove <id>>");
  }

  if (cmd === "proposals") {
    const r = await req("GET", "/proposals");
    const ps = (r.proposals || []).filter((p) => !p.status || p.status === "pending");
    console.log("");
    if (!ps.length) return info("(no pending proposals)");
    for (const p of ps) {
      console.log(`  ${c.warn}💡${c.reset} ${c.bold}${p.name}${c.reset} ${c.gray}#${p.id} · ${(p.agents || []).join(", ")}${c.reset}`);
      if (p.detail) console.log(`     ${c.gray}${String(p.detail).slice(0, 100)}${c.reset}`);
    }
    info("\n  Read: bagidea proposal show <id>   ·   Decide: proposal <approve|reject> <id>");
    return;
  }

  if (cmd === "proposal") {
    const sub = rest[0];
    const id = rest[1];
    if (sub === "show" || sub === "view") {
      if (!id) return info("Usage: bagidea proposal show <id>");
      const r = await req("GET", "/proposals");
      const p = (r.proposals || []).find((x) => String(x.id) === String(id));
      if (!p) return bad(`No proposal #${id} — see ${c.accent}bagidea proposals${c.reset}`);
      console.log(`\n  ${c.warn}💡 ${c.bold}${p.name}${c.reset}`);
      console.log(`  ${c.gray}#${p.id} · by ${(p.agents || []).join(", ")} · ${p.status || "pending"}${c.reset}`);
      rule();
      console.log("  " + String(p.detail || "(no detail)").replace(/\n/g, "\n  "));
      if (p.message) console.log(`\n  ${c.gray}your note:${c.reset} ${p.message}`);
      rule();
      info("Decide: bagidea proposal approve " + p.id + " [message]  |  reject " + p.id + " [message]");
      return;
    }
    if (!["approve", "reject"].includes(sub) || !id)
      return info("Usage: bagidea proposal <show|approve|reject> <id> [message]");
    const message = rest.slice(2).join(" ");   // optional note to the team
    await req("POST", "/proposals/respond", { id, decision: sub, message });
    return ok(sub === "approve"
      ? `Approved #${id} — a project is being created and staffed 🎉`
      : `Rejected #${id}`);
  }

  if (cmd === "key") {
    const sub = rest[0];
    if (sub === "set") {
      const name = rest[1];
      const value = rest.slice(2).join(" ");
      if (!name || !value) return info("Usage: bagidea key set <NAME> <value>");
      await req("POST", "/registry/key", { name, value });
      return ok(`Key ${c.bold}${name.toUpperCase()}${c.reset} saved`);
    }
    if (sub === "rm" || sub === "remove") {
      const name = rest[1];
      if (!name) return info("Usage: bagidea key rm <NAME>");
      await req("POST", "/registry/key", { name, remove: true });
      return ok(`Key ${c.bold}${name.toUpperCase()}${c.reset} removed`);
    }
    if (sub === "test") {
      const name = (rest[1] || "OPENAI_API_KEY").toUpperCase();
      info(`🧪 testing ${name}…`);
      const r = await req("POST", "/registry/key/test", { name });
      return r && r.ok ? ok(`${name}: ${r.msg || "works"}`) : bad(`${name}: ${(r && r.msg) || "failed"}`);
    }
    return info("Usage: bagidea key <set <NAME> <value> | rm <NAME> | test [NAME]>");
  }

  if (cmd === "jobs") {
    const r = await req("GET", "/jobs");
    console.log("");
    if (!(r.jobs || []).length) return info("(no scheduled jobs)");
    for (const j of r.jobs) {
      const sched = j.mode === "every" ? `every ${j.everyMin}m`
        : j.mode === "at" ? `${j.daily ? "daily " : ""}${j.time}` : "once";
      console.log(`  ${c.accent}${sched.padEnd(12)}${c.reset}${c.gray}${j.agent}${c.reset}  ${String(j.prompt || "").split("\n")[0].slice(0, 60)}`);
    }
    return;
  }

  bad(`Unknown command "${cmd}" — see ${c.accent}bagidea --help${c.reset}`);
}

main().catch((e) => { console.error(`  ${c.err}✗${c.reset} ${e.message}`); process.exit(1); });
