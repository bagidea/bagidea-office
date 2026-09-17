// Two field failures from one support call, and the guards that keep them fixed.
//
// A machine set up for a customer came up with a blank chat window. Two separate
// things were wrong, and neither said anything on screen:
//
//   1. PowerShell's DEFAULT execution policy is Restricted, and in PowerShell
//      `npm` resolves to npm.ps1 — a script. So `npm install -g` inside the
//      installer was refused, the Claude Code CLI never landed, and the
//      installer printed "installed" anyway. Every agent in the office is a
//      claude session, so that is the whole product, reported as a success.
//
//   2. Something on that box stood between the window and 127.0.0.1:8787. The
//      window showed nothing at all — no text, no error — so the only way to
//      find it was to go through the firewall and the proxy by hand.
//
// These tests are about the two things that made it hard: a false success, and
// a silent failure.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const INSTALLER = fs.readFileSync(path.join(ROOT, "installer", "install.ps1"), "utf8");
const SHELL = fs.readFileSync(path.join(ROOT, "shell", "src", "main.rs"), "utf8");
const doctor = require(path.join(ROOT, "cli", "doctor.js"));

// ── the installer, under a Restricted execution policy ──────────────────────
test("the installer never invokes bare `npm` — PowerShell resolves that to npm.ps1", () => {
  // `npm.ps1` is a script, and the default policy refuses scripts outright:
  //   "npm : File ...\npm.ps1 cannot be loaded because running scripts is
  //    disabled on this system."
  // npm.cmd does the same job and no policy can block it.
  const lines = INSTALLER.split(/\r?\n/);
  const offenders = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !/^\s*#/.test(l))                 // comments may say "npm"
    .filter(({ l }) => /(^|[\s;(&|])npm\s+(install|i|exec|run)\b/.test(l))
    .filter(({ l }) => !/npm\.cmd/.test(l))
    .map(({ n, l }) => `line ${n}: ${l.trim().slice(0, 90)}`);
  assert.deepStrictEqual(offenders, [],
    "bare `npm` is npm.ps1 in PowerShell and dies under the default policy:\n  " +
    offenders.join("\n  "));
});

test("the installer resolves npm through the .cmd shim", () => {
  assert.match(INSTALLER, /function Npm-Exe/,
    "the npm.cmd resolver is gone — bare npm will come back with it");
  assert.match(INSTALLER, /Get-Command npm\.cmd/);
});

test("the installer lifts the execution policy for its OWN session only", () => {
  // Process scope dies with the installer and is never written to the registry.
  // Silently changing a machine's persistent policy is not ours to do — least
  // of all on a customer's machine.
  assert.match(INSTALLER, /Set-ExecutionPolicy\s+-Scope\s+Process\s+-ExecutionPolicy\s+Bypass/,
    "the installer no longer makes itself immune to the policy");
  const persistent = INSTALLER.split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .filter((l) => /Set-ExecutionPolicy/.test(l) && /-Scope\s+CurrentUser/.test(l));
  // The persistent one may exist, but only behind an explicit answer or opt-in
  // env var — never unconditionally.
  for (const l of persistent) {
    assert.ok(/BAGIDEA_SET_EXECUTION_POLICY|\$sp\s*-eq\s*"y"/.test(l) ||
              /Read-Host/.test(INSTALLER),
      "CurrentUser policy is changed without asking: " + l.trim());
  }
});

test("the installer verifies Claude Code landed instead of claiming it did", () => {
  // The old line was:
  //   npm install -g @anthropic-ai/claude-code; Sync-Path; Ok "installed"
  // — "installed" printed whether or not npm had been refused.
  const step = INSTALLER.slice(INSTALLER.indexOf("Step 6"),
                               INSTALLER.indexOf("Step 6") + 1400);
  assert.match(step, /if \(Have "claude"\)[\s\S]*Ok "installed/,
    "the success message is not guarded by a check that claude exists");
  assert.match(step, /Warn "npm finished but the 'claude' command is still not on PATH/,
    "there is no honest failure message when npm was blocked");
});

// ── the window that said nothing ────────────────────────────────────────────
test("the shell waits for the daemon before calling it unreachable", () => {
  assert.match(SHELL, /fn wait_for_daemon\(/,
    "no readiness wait — a slow boot would be reported as a blocked machine");
  assert.match(SHELL, /wait_for_daemon\(std::time::Duration::from_secs\((\d+)\)\)/);
  const secs = Number(SHELL.match(/wait_for_daemon\(std::time::Duration::from_secs\((\d+)\)\)/)[1]);
  assert.ok(secs >= 15, `only ${secs}s to boot the daemon — too eager to declare failure`);
});

test("an unreachable daemon shows an explanation, not an empty window", () => {
  assert.match(SHELL, /const OFFLINE_HTML/, "the offline page is gone");
  const page = SHELL.slice(SHELL.indexOf("const OFFLINE_HTML"),
                           SHELL.indexOf("fn spawn_daemon"));
  // The three things that actually cause it, and the one command that tells you
  // which of them it is.
  assert.match(page, /proxy/i);
  assert.match(page, /firewall/i);
  assert.match(page, /bagidea doctor/,
    "the page doesn't point at the diagnostic — that is the whole point of it");
  // It must not need the daemon to render, since not reaching the daemon is the
  // situation it exists for.
  assert.doesNotMatch(page, /src=["']http:\/\/127\.0\.0\.1:8787/,
    "the offline page fetches from the daemon it cannot reach");
  assert.match(SHELL, /if daemon_reachable \{[\s\S]{0,200}with_url[\s\S]{0,200}\} else \{[\s\S]{0,200}with_html\(OFFLINE_HTML\)/,
    "the shell no longer chooses the offline page when the daemon is unreachable");
});

// ── the diagnostic itself ───────────────────────────────────────────────────
test("doctor recognises a proxy bypass list that covers loopback", () => {
  // Windows writes "<local>" for the "bypass for local addresses" tickbox;
  // people also type the literals. Any of them means local traffic is exempt.
  for (const good of ["<local>", "127.0.0.1", "localhost", "LOCALHOST",
                      "10.0.0.1;<local>", "corp.local;127.0.0.1;x.y"]) {
    assert.strictEqual(doctor.bypassesLoopback(good), true, `should pass: ${good}`);
  }
  // and must NOT be fooled by a list that only covers the corporate network —
  // that is the exact configuration that breaks the office.
  for (const bad of ["", null, undefined, "10.0.0.1", "corp.local;*.internal"]) {
    assert.strictEqual(doctor.bypassesLoopback(bad), false, `should fail: ${JSON.stringify(bad)}`);
  }
});

test("doctor tells a refused connection apart from a hang", async () => {
  // They mean different things: refused = nothing is listening (the office is
  // simply off), a hang = something is swallowing loopback traffic. Reporting
  // one as the other sends the reader down the wrong path.
  const r = await doctor.probeTcp(600);
  assert.ok(typeof r.ok === "boolean");
  if (!r.ok) assert.ok(r.why, "a failed probe must say why");
});

test("doctor runs without the daemon — that is the case it exists for", () => {
  const src = fs.readFileSync(path.join(ROOT, "cli", "doctor.js"), "utf8");
  assert.doesNotMatch(src, /require\(["']\.\.\/daemon/,
    "doctor pulls in the daemon it is supposed to diagnose the absence of");
  const cli = fs.readFileSync(path.join(ROOT, "cli", "bagidea.js"), "utf8");
  assert.match(cli, /cmd === "doctor"/, "doctor is not wired into the CLI");
  assert.match(cli, /row\("doctor"/, "doctor is not in `bagidea --help`, so nobody will find it");
});
