// Unit tests for daemon/exec-backend.js — pure, no daemon and no Docker needed.
//
// The thing worth testing here is not "does it build a docker command", it is
// "does it REFUSE when the command it would build is wrong". A backend that
// silently drops --settings produces a run with no permission broker: the agent
// still works, nothing errors, and nobody is watching it.
const test = require("node:test");
const assert = require("node:assert");
const B = require("../exec-backend");

const OFFICE = "E:/Projects/bagidea-office";
const PROJ = "E:/Projects/my-game";
const ARGV = ["-p", "--output-format", "stream-json", "--verbose",
  "--allowedTools", "Read,Edit,Bash",
  "--settings", OFFICE + "/workspace/.claude/settings.json",
  "--add-dir", OFFICE + "/daemon/agents/shino"];

// ── path remapping ─────────────────────────────────────────────────────
test("remapPath: a path under a mount is rewritten", () => {
  assert.strictEqual(
    B.remapPath(OFFICE + "/workspace/x.json", [{ from: OFFICE, to: "/office" }]),
    "/office/workspace/x.json");
});

test("remapPath: the mount root itself maps to the mount point", () => {
  assert.strictEqual(B.remapPath(OFFICE, [{ from: OFFICE, to: "/office" }]), "/office");
});

test("remapPath: backslashes become forward slashes on the far side", () => {
  assert.strictEqual(
    B.remapPath(OFFICE + "\\daemon\\agents", [{ from: OFFICE, to: "/office" }]),
    "/office/daemon/agents");
});

test("remapPath: the LONGEST matching mount wins", () => {
  // A project inside the office root must land in the project mount, not the
  // office one, or the container writes into a read-only tree.
  const maps = [{ from: OFFICE, to: "/office" }, { from: OFFICE + "/projects/p1", to: "/work" }];
  assert.strictEqual(B.remapPath(OFFICE + "/projects/p1/src/a.js", maps), "/work/src/a.js");
});

test("remapPath: a sibling directory with a shared prefix is NOT a match", () => {
  // E:/Projects/bagidea-office-notes must not be mistaken for the office root.
  assert.strictEqual(
    B.remapPath(OFFICE + "-notes/x", [{ from: OFFICE, to: "/office" }]), null);
});

test("remapPath: a path outside every mount returns null", () => {
  assert.strictEqual(B.remapPath("D:/elsewhere/f", [{ from: OFFICE, to: "/office" }]), null);
});

test("remapArgs: only the values of path flags are rewritten", () => {
  const { args } = B.remapArgs(ARGV, [{ from: OFFICE, to: "/office" }]);
  assert.deepStrictEqual(args.slice(0, 6), ARGV.slice(0, 6));      // tools list untouched
  assert.strictEqual(args[7], "/office/workspace/.claude/settings.json");
  assert.strictEqual(args[9], "/office/daemon/agents/shino");
});

test("remapArgs: an unmappable path value is reported, not silently dropped", () => {
  const { args, missed } = B.remapArgs(
    ["--settings", "D:/other/settings.json"], [{ from: OFFICE, to: "/office" }]);
  assert.strictEqual(missed.length, 1);
  assert.match(missed[0], /--settings D:\/other/);
  assert.deepStrictEqual(args, ["--settings", "D:/other/settings.json"]);
});

test("remapArgs: a trailing path flag with no value does not crash", () => {
  const { args } = B.remapArgs(["-p", "--settings"], [{ from: OFFICE, to: "/office" }]);
  assert.deepStrictEqual(args, ["-p", "--settings"]);
});

// ── local ──────────────────────────────────────────────────────────────
test("local: unchanged from what the office always did", () => {
  const p = B.plan({ kind: "local" }, { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE });
  assert.strictEqual(p.file, "claude");
  assert.deepStrictEqual(p.args, ARGV);
  assert.strictEqual(p.options.shell, true);   // how claude.cmd resolves on Windows
  assert.strictEqual(p.options.cwd, PROJ);
});

test("pick: no configuration at all means local", () => {
  assert.strictEqual(B.pick({}, "shino").name, "local");
});

test("pick: an agent's own backend beats the office default", () => {
  const reg = { execBackend: "box", execBackends: { box: { kind: "docker", image: "i" },
    far: { kind: "ssh", host: "h" } }, agents: { shino: { backend: "far" } } };
  assert.strictEqual(B.pick(reg, "shino").name, "far");
  assert.strictEqual(B.pick(reg, "other").name, "box");
});

test("pick: a name that no longer exists falls back to local, and says so", () => {
  // A typo in a setting must not stop the office working.
  const got = B.pick({ execBackend: "gone", execBackends: {} }, "shino");
  assert.strictEqual(got.name, "local");
  assert.strictEqual(got.unknown, "gone");
});

// ── docker ─────────────────────────────────────────────────────────────
test("docker: mounts the office read-only and the project writable", () => {
  const p = B.plan({ kind: "docker", image: "node:22" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE });
  assert.strictEqual(p.file, "docker");
  assert.ok(p.args.includes(OFFICE + ":/office:ro"), "office not mounted read-only");
  assert.ok(p.args.includes(PROJ + ":/work"), "project not mounted");
  assert.strictEqual(p.args[p.args.indexOf("-w") + 1], "/work");
  assert.strictEqual(p.options.shell, false, "argv form must not go through a shell");
});

test("docker: the claude arguments arrive with container paths", () => {
  const p = B.plan({ kind: "docker", image: "node:22" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE });
  const i = p.args.indexOf("claude");
  assert.ok(i > 0, "claude not in the command");
  const after = p.args.slice(i + 1);
  assert.strictEqual(after[after.indexOf("--settings") + 1],
    "/office/workspace/.claude/settings.json");
  assert.ok(!p.args.some((a) => a.startsWith("E:") && a.includes("settings.json")),
    "a host path survived into the container command");
});

test("docker: REFUSES rather than run without the permission broker", () => {
  // The settings file is what installs the broker. If it cannot be mounted, the
  // run would work and be unwatched — the one outcome worth failing for.
  assert.throws(
    () => B.plan({ kind: "docker", image: "node:22" },
      { argv: ["-p", "--settings", "D:/somewhere-else/settings.json"],
        cwd: PROJ, env: {}, officeRoot: OFFICE }),
    /cannot see .*--settings/);
});

test("docker: an image is required", () => {
  assert.throws(() => B.plan({ kind: "docker" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE }), /no image/);
});

test("docker: secrets travel by NAME, never as a value on the command line", () => {
  const p = B.plan({ kind: "docker", image: "node:22" },
    { argv: ARGV, cwd: PROJ, officeRoot: OFFICE,
      env: { ...process.env, ANTHROPIC_API_KEY: "sk-secret-value" } });
  assert.ok(p.args.includes("-e") && p.args.includes("ANTHROPIC_API_KEY"),
    "key not forwarded");
  assert.ok(!p.args.some((a) => String(a).includes("sk-secret-value")),
    "the key value ended up in the process command line");
});

test("docker: when the project IS the office root, there is one mount", () => {
  const p = B.plan({ kind: "docker", image: "node:22" },
    { argv: ARGV, cwd: OFFICE, env: {}, officeRoot: OFFICE });
  assert.strictEqual(p.args.filter((a) => a === "-v").length, 1);
  assert.strictEqual(p.args[p.args.indexOf("-w") + 1], "/office");
});

// ── ssh ────────────────────────────────────────────────────────────────
test("ssh: refuses without a remote office directory", () => {
  assert.throws(() => B.plan({ kind: "ssh", host: "build01" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE }), /officeDir/);
});

test("ssh: builds one remote shell command with quoted arguments", () => {
  const p = B.plan({ kind: "ssh", host: "build01", officeDir: "/srv/office", dir: "/srv/game" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE });
  assert.strictEqual(p.file, "ssh");
  const remote = p.args[p.args.length - 1];
  assert.match(remote, /^cd '\/srv\/game' && /);
  assert.match(remote, /'--settings' '\/srv\/office\/workspace\/\.claude\/settings\.json'/);
  assert.strictEqual(p.options.shell, false);
});

test("ssh: a single quote in a value cannot end the remote string", () => {
  const p = B.plan({ kind: "ssh", host: "h", officeDir: "/srv/office", dir: "/srv/it's mine" },
    { argv: ["-p"], cwd: PROJ, env: {}, officeRoot: OFFICE });
  const remote = p.args[p.args.length - 1];
  assert.match(remote, /cd '\/srv\/it'\\''s mine'/);
});

test("ssh: an env value with a quote is quoted too", () => {
  const p = B.plan({ kind: "ssh", host: "h", officeDir: "/srv/office" },
    { argv: ["-p"], cwd: PROJ, officeRoot: OFFICE,
      env: { ...process.env, ODD: "a'b; rm -rf /" } });
  const remote = p.args[p.args.length - 1];
  assert.ok(remote.includes("ODD='a'\\''b; rm -rf /'"),
    "env value not quoted for the remote shell: " + remote);
});

test("ssh: BatchMode is on so a run never blocks on a password prompt", () => {
  const p = B.plan({ kind: "ssh", host: "h", officeDir: "/srv/office" },
    { argv: ["-p"], cwd: PROJ, env: {}, officeRoot: OFFICE });
  assert.ok(p.args.includes("BatchMode=yes"));
});

test("an unknown kind is an error, not a silent local run", () => {
  assert.throws(() => B.plan({ kind: "kubernetes" },
    { argv: ARGV, cwd: PROJ, env: {}, officeRoot: OFFICE }), /unknown execution backend/);
});
