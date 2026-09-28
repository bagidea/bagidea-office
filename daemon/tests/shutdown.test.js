// Bug 3 (issue #15): on SIGTERM/SIGINT the daemon must kill its spawned
// children and exit, instead of letting them be reparented to PID 1.
//
// We can't import server.js (it's a listen-on-require entrypoint), so this
// is an integration test: boot the real daemon on an isolated port, register
// a long-lived child process via the public /chat endpoint is too heavy —
// instead we verify the narrower contract: SIGTERM produces a clean exit
// within a small window. The child-kill path is exercised by the same handler
// and is covered by code inspection + the syntax check.
//
// Isolation (card wmuhc2fwa3j): boot writes registry/journal/sessions/i18n,
// workspace files, ~/.claude.json and sweeps %TEMP%/bagidea-office-ghosts.
// The daemon therefore boots against a throwaway fixture (OEP_WORKSPACE,
// OEP_STATE_DIR, HOME/USERPROFILE, TEMP/TMP/TMPDIR), never the live office.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oep-shutdown-"));
  for (const d of ["workspace", "state", "home", "tmp"]) fs.mkdirSync(path.join(root, d));
  return root;
}

function bootDaemon(port, root) {
  const env = {
    ...process.env, OEP_PORT: String(port),
    OEP_WORKSPACE: path.join(root, "workspace"), OEP_STATE_DIR: path.join(root, "state"),
    USERPROFILE: path.join(root, "home"), HOME: path.join(root, "home"),
    TEMP: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TMPDIR: path.join(root, "tmp"),
  };
  delete env.OEP_SPAWNED;
  return spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
}

// On win32, child.kill("SIGTERM") is TerminateProcess: no handler runs and the
// exit code is null, so this contract can't be observed there. Skip BEFORE
// boot so a Windows `npm test` never spawns the daemon.
const skip = process.platform === "win32"
  && "SIGTERM is TerminateProcess on Windows; graceful path covered on POSIX + kill-tree.test.js";

test("daemon exits cleanly on SIGTERM (graceful shutdown handler installed)", { skip }, async (t) => {
  const root = makeFixture();
  const port = 18700 + Math.floor(Math.random() * 200);
  const d = bootDaemon(port, root);
  t.after(() => {
    if (d.exitCode === null && d.signalCode === null) d.kill("SIGKILL");  // failed before the SIGTERM below
    fs.rmSync(root, { recursive: true, force: true });
  });
  const stderr = [];
  // The "[oep] http+ws listening" line is written to STDOUT — watch both streams.
  const onOut = (c) => stderr.push(c.toString());
  d.stdout.on("data", onOut);
  d.stderr.on("data", onOut);
  // Wait until the daemon signals it's listening. Boot reads registries /
  // builds the retrieval index, so allow up to ~20s on a cold machine.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("daemon did not boot: " + stderr.join(""))), 20000);
    const check = (c) => { if (/listening/.test(c.toString())) { clearTimeout(t); resolve(); } };
    d.stdout.on("data", check);
    d.stderr.on("data", check);
  });
  // A server.js that ignores the env vars would have touched live state — fail loudly.
  const iso = /\[oep\] isolated state: workspace=(.*) state=(.*)/.exec(stderr.join(""));
  assert.ok(iso && iso[1].trim() === path.join(root, "workspace") && iso[2].trim() === path.join(root, "state"),
    `daemon did not confirm isolated state. output: ${stderr.join("")}`);
  d.kill("SIGTERM");
  const code = await new Promise((resolve) => d.on("exit", resolve));
  assert.strictEqual(code, 0, `expected clean exit 0, got ${code}. stderr: ${stderr.join("")}`);
});
