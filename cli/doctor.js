// `bagidea doctor` — find out WHY the office isn't reachable, and say so.
//
// This exists because of a real support call. On a customer's machine the
// office came up and the chat window stayed blank: something on that box was
// blocking http://127.0.0.1:8787. The person who set it up had installed on
// dozens of machines without ever seeing it, and had to go through the firewall
// and the proxy by hand to find it, while the customer sat in front of a window
// that said nothing at all.
//
// A blank window is the worst possible error message. Every check below prints
// what it found and what to do about it — and each one is a thing that has
// actually stopped an office from working, not a checklist for its own sake.
//
// Zero dependencies, and safe to run when the daemon is down (that is the case
// it is FOR).

const http = require("http");
const net = require("net");
const { execFileSync } = require("child_process");

const PORT = 8787;
const HOST = "127.0.0.1";

// Windows keeps the proxy settings the whole OS (and WebView2 with it) reads
// under Internet Settings. A proxy here with no loopback exemption is the
// classic way 127.0.0.1 stops resolving to your own machine.
function winProxy() {
  if (process.platform !== "win32") return null;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
  const read = (name) => {
    try {
      const out = execFileSync("reg", ["query", key, "/v", name],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(new RegExp(name + "\\s+REG_\\w+\\s+(.*)"));
      return m ? m[1].trim() : null;
    } catch { return null; }
  };
  return {
    enabled: read("ProxyEnable") === "0x1",
    server: read("ProxyServer"),
    override: read("ProxyOverride"),
    pac: read("AutoConfigURL"),
  };
}

function winPolicy() {
  if (process.platform !== "win32") return null;
  try {
    return execFileSync("powershell",
      ["-NoProfile", "-Command", "Get-ExecutionPolicy"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

// Is anything holding the port, and can we actually speak to it? These are two
// different questions: a listener you cannot reach is exactly the symptom a
// local proxy or filter produces.
function probeTcp(timeout = 2500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(r); } };
    s.setTimeout(timeout);
    s.once("connect", () => finish({ ok: true }));
    s.once("timeout", () => finish({ ok: false, why: "timed out" }));
    s.once("error", (e) => finish({ ok: false, why: e.code || e.message }));
    s.connect(PORT, HOST);
  });
}

function probeHttp(timeout = 3000) {
  return new Promise((resolve) => {
    const r = http.request({ host: HOST, port: PORT, path: "/health", timeout },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ ok: res.statusCode === 200, code: res.statusCode, body: d.slice(0, 200) }));
      });
    r.on("timeout", () => { r.destroy(); resolve({ ok: false, why: "timed out" }); });
    r.on("error", (e) => resolve({ ok: false, why: e.code || e.message }));
    r.end();
  });
}

function have(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(probe, [cmd], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch { return false; }
}

// A proxy bypass list that covers loopback. Windows writes "<local>" for the
// "bypass for local addresses" checkbox; people also list the literals.
function bypassesLoopback(override) {
  if (!override) return false;
  const v = String(override).toLowerCase();
  return v.includes("<local>") || v.includes("127.0.0.1") || v.includes("localhost");
}

async function run(io) {
  const { ok, bad, warn, info, head, rule } = io;
  let problems = 0;
  const fail = (msg, ...fixes) => { problems++; bad(msg); fixes.forEach((f) => info("   → " + f)); };

  head("Can we reach the office?");
  const tcp = await probeTcp();
  if (tcp.ok) {
    const h = await probeHttp();
    if (h.ok) ok(`daemon answering on ${HOST}:${PORT}  ${h.body ? "· " + h.body : ""}`);
    else if (h.why) {
      fail(`port ${PORT} accepts a connection but HTTP fails (${h.why})`,
        "something is intercepting local HTTP — see the proxy check below",
        "an antivirus with 'web protection' / 'HTTPS scanning' is the usual culprit");
    } else {
      fail(`${HOST}:${PORT} replied ${h.code}, expected 200`,
        "another program may be sitting on port 8787 — `bagidea restart`");
    }
  } else if (tcp.why === "ECONNREFUSED") {
    warn(`nothing is listening on ${HOST}:${PORT} — the office is not running`);
    info("   → start it:  bagidea start");
    info("   → this is normal if you meant to run doctor while it's stopped");
  } else {
    fail(`cannot reach ${HOST}:${PORT} (${tcp.why})`,
      "a firewall or security product is blocking loopback traffic",
      "allow node.exe through the firewall, or exempt 127.0.0.1");
  }

  const px = winProxy();
  if (px) {
    head("System proxy (WebView2 and the chat window follow it)");
    if (px.pac) {
      warn(`an auto-config script is set: ${px.pac}`);
      info("   → if that PAC returns a proxy for 127.0.0.1, the chat window cannot load");
      info("   → test by unticking 'Use setup script' in Settings › Network › Proxy");
    }
    if (px.enabled) {
      if (bypassesLoopback(px.override)) {
        ok(`proxy ${px.server} is set, and loopback is exempt (${px.override})`);
      } else {
        fail(`proxy ${px.server} is on and does NOT exempt loopback` +
             (px.override ? ` (bypass list: ${px.override})` : " (no bypass list at all)"),
          "the chat window loads http://127.0.0.1:8787 — through a proxy that fails",
          "Settings › Network & internet › Proxy › Manual setup › Edit,",
          "   tick \"Don't use the proxy server for local addresses\",",
          "   or add  <local>;127.0.0.1;localhost  to the exception list");
      }
    } else if (!px.pac) {
      ok("no system proxy configured");
    }
  }

  const envProxy = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
    .filter((k) => process.env[k]);
  if (envProxy.length) {
    head("Proxy environment variables");
    const no = process.env.NO_PROXY || process.env.no_proxy || "";
    if (bypassesLoopback(no)) ok(`${envProxy.join(", ")} set · NO_PROXY covers loopback`);
    else fail(`${envProxy.join(", ")} set and NO_PROXY does not cover loopback`,
      "set  NO_PROXY=127.0.0.1,localhost  so local calls skip the proxy");
  }

  const pol = winPolicy();
  if (pol) {
    head("PowerShell execution policy");
    if (pol === "Restricted" || pol === "AllSigned") {
      // Not fatal for the office itself — the daemon runs claude through cmd —
      // but it is fatal for the terminal step the install tells people to do.
      fail(`policy is ${pol}, so your terminal will refuse claude and npm`,
        "npm installs those as .ps1 scripts, which this policy blocks",
        "either type claude.cmd / npm.cmd, or run:",
        "   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser");
    } else ok(`policy is ${pol} — scripts can run`);
  }

  head("The toolchain every agent needs");
  const claude = have("claude") || have("claude.cmd");
  if (claude) ok("claude — found");
  else fail("claude is NOT installed — every agent is a Claude Code session",
    "npm.cmd install -g @anthropic-ai/claude-code");
  if (have("node")) ok("node — found"); else fail("node is missing", "reinstall, or install Node LTS");
  if (have("git")) ok("git — found"); else warn("git is missing — updates and project work need it");

  rule();
  if (problems === 0) {
    ok("nothing wrong found");
  } else {
    bad(`${problems} problem${problems > 1 ? "s" : ""} found — the lines marked → are the fixes`);
    info("still stuck? open an issue with this output:");
    info("github.com/bagidea/bagidea-office/issues");
  }
  console.log("");
  return problems;
}

module.exports = { run, bypassesLoopback, winProxy, probeTcp, probeHttp };
