// Issue #39: registering a folder must not silently become "run this repo's hooks".
// The fingerprint is the whole gate — if it misses a change, a once-approved project
// can start executing something else; if it changes for no reason, the owner is
// trained to click through the one card that matters.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fingerprint, readHooks } = require("../projecttrust");

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-trust-"));
  return dir;
}
function writeSettings(dir, obj, name = "settings.json") {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", name), JSON.stringify(obj, null, 2));
}
const HOOKED = {
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "node marker-hook.js" }] }],
  },
};

test("an ordinary project asks for nothing — no hooks, no hash", () => {
  const dir = tmpProject();
  assert.deepStrictEqual(fingerprint(dir), { hooks: [], scripts: [], hash: "" });
  // Settings that carry only permissions are NOT gated (see module header).
  writeSettings(dir, { permissions: { allow: ["Bash(git status)"] } });
  assert.strictEqual(fingerprint(dir).hash, "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a repo-supplied command hook is surfaced with what it would run", () => {
  const dir = tmpProject();
  writeSettings(dir, HOOKED);
  const fp = fingerprint(dir);
  assert.ok(fp.hash);
  assert.strictEqual(fp.hooks.length, 1);
  assert.strictEqual(fp.hooks[0].event, "SessionStart");
  assert.strictEqual(fp.hooks[0].command, "node marker-hook.js");
  assert.strictEqual(fp.hooks[0].file, ".claude/settings.json");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("settings.local.json counts too — gitignored is not trusted", () => {
  const dir = tmpProject();
  writeSettings(dir, HOOKED, "settings.local.json");
  assert.ok(fingerprint(dir).hash);
  assert.strictEqual(readHooks(dir)[0].file, ".claude/settings.local.json");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("approval sticks: an unchanged project keeps the same fingerprint", () => {
  const dir = tmpProject();
  writeSettings(dir, HOOKED);
  fs.writeFileSync(path.join(dir, "marker-hook.js"), "console.log(1)\n");
  const a = fingerprint(dir).hash;
  fs.writeFileSync(path.join(dir, "README.md"), "unrelated edit\n");
  assert.strictEqual(fingerprint(dir).hash, a);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("changing the hook command re-asks", () => {
  const dir = tmpProject();
  writeSettings(dir, HOOKED);
  const before = fingerprint(dir).hash;
  writeSettings(dir, {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node other.js" }] }] },
  });
  assert.notStrictEqual(fingerprint(dir).hash, before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("changing the referenced SCRIPT re-asks, even with settings untouched", () => {
  const dir = tmpProject();
  writeSettings(dir, HOOKED);
  const script = path.join(dir, "marker-hook.js");
  fs.writeFileSync(script, "console.log('harmless')\n");
  const fp = fingerprint(dir);
  assert.deepStrictEqual(fp.scripts.map((s) => s.rel), ["marker-hook.js"]);
  fs.writeFileSync(script, "require('child_process').exec('curl evil')\n");
  assert.notStrictEqual(fingerprint(dir).hash, fp.hash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("$CLAUDE_PROJECT_DIR paths resolve to the file that would actually run", () => {
  const dir = tmpProject();
  writeSettings(dir, {
    hooks: { SessionStart: [{ hooks: [{ type: "command",
      command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/start.sh" }] }] },
  });
  fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
  const sh = path.join(dir, ".claude", "hooks", "start.sh");
  fs.writeFileSync(sh, "echo hi\n");
  const before = fingerprint(dir);
  assert.deepStrictEqual(before.scripts.map((s) => s.rel), [".claude/hooks/start.sh"]);
  fs.writeFileSync(sh, "echo pwned\n");
  assert.notStrictEqual(fingerprint(dir).hash, before.hash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unreadable/absent settings never throw — the gate must not brick a project", () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{ not json ");
  assert.strictEqual(fingerprint(dir).hash, "");
  assert.strictEqual(fingerprint(path.join(dir, "nope")).hash, "");
  fs.rmSync(dir, { recursive: true, force: true });
});
