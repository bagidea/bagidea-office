// Unit tests for daemon/worktree.js against REAL git repositories in a temp
// directory. Mocking git here would test the mock: the whole value of this
// module is that it does the right thing to an actual repo, and the thing that
// matters most is what it does to the OWNER'S checkout, which is nothing.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const W = require("../worktree");

const RUN = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], RUN).trim();

let hasGit = true;
try { execFileSync("git", ["--version"], RUN); } catch { hasGit = false; }

const made = [];
function newRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-wt-test-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.local");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

test.after(() => {
  for (const d of made) {
    try { W.sweep(new Set()); } catch {}
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

test("repoRoot: a plain directory is not a repository", { skip: !hasGit }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-plain-"));
  made.push(d);
  assert.strictEqual(W.repoRoot(d), null);
});

test("repoRoot: finds the top of the repo from a subdirectory", { skip: !hasGit }, () => {
  const repo = newRepo();
  const sub = path.join(repo, "src", "deep");
  fs.mkdirSync(sub, { recursive: true });
  assert.strictEqual(fs.realpathSync(W.repoRoot(sub)), fs.realpathSync(repo));
});

test("create: returns null outside a repo, so the caller just shares the dir",
  { skip: !hasGit }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-plain2-"));
    made.push(d);
    assert.strictEqual(W.create(d, "g1"), null);
  });

test("create: a ghost gets its own checkout on its own branch", { skip: !hasGit }, () => {
  const repo = newRepo();
  const wt = W.create(repo, "g-alpha");
  assert.ok(wt, "no worktree created");
  assert.ok(fs.existsSync(path.join(wt.dir, "a.txt")), "checkout is empty");
  assert.strictEqual(git(wt.dir, "rev-parse", "--abbrev-ref", "HEAD"), wt.branch);
  assert.notStrictEqual(fs.realpathSync(wt.dir), fs.realpathSync(repo));
  W.remove(wt, { keepBranch: false });
});

test("create: the worktree lives outside the owner's project", { skip: !hasGit }, () => {
  // A stray directory inside someone's repo is how a feature gets switched off.
  const repo = newRepo();
  const wt = W.create(repo, "g-outside");
  assert.ok(!fs.realpathSync(wt.dir).startsWith(fs.realpathSync(repo)),
    "worktree was created inside the project");
  W.remove(wt, { keepBranch: false });
});

test("two ghosts editing the same file do not collide", { skip: !hasGit }, () => {
  // The reason this module exists.
  const repo = newRepo();
  const a = W.create(repo, "g-a"), b = W.create(repo, "g-b");
  fs.writeFileSync(path.join(a.dir, "a.txt"), "written by A\n");
  fs.writeFileSync(path.join(b.dir, "a.txt"), "written by B\n");
  assert.strictEqual(fs.readFileSync(path.join(a.dir, "a.txt"), "utf8"), "written by A\n");
  assert.strictEqual(fs.readFileSync(path.join(b.dir, "a.txt"), "utf8"), "written by B\n");
  // and the owner's copy is untouched by either
  assert.strictEqual(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "one\n");
  W.remove(a, { keepBranch: false });
  W.remove(b, { keepBranch: false });
});

test("settle: a ghost that changed nothing leaves nothing behind", { skip: !hasGit }, () => {
  const repo = newRepo();
  const wt = W.create(repo, "g-idle");
  const note = W.settle(wt, "did nothing");
  assert.strictEqual(note, "");
  assert.ok(!fs.existsSync(wt.dir), "worktree directory survived");
  const branches = git(repo, "branch", "--list");
  assert.ok(!branches.includes(wt.branch), "an empty branch was left behind: " + branches);
});

test("settle: work is kept on a branch and named in the result", { skip: !hasGit }, () => {
  const repo = newRepo();
  const wt = W.create(repo, "g-work");
  fs.writeFileSync(path.join(wt.dir, "new.txt"), "from the ghost\n");
  const note = W.settle(wt, "added new.txt");
  assert.match(note, /office\/ghost-g-work/);
  assert.ok(!fs.existsSync(wt.dir), "worktree not cleaned up");
  // The branch is still there and holds the file.
  const show = git(repo, "show", wt.branch + ":new.txt");
  assert.strictEqual(show, "from the ghost");
});

test("settle: the owner's checkout and branch are never touched", { skip: !hasGit }, () => {
  const repo = newRepo();
  const before = git(repo, "rev-parse", "HEAD");
  const wt = W.create(repo, "g-safe");
  fs.writeFileSync(path.join(wt.dir, "a.txt"), "ghost overwrote this\n");
  W.settle(wt, "edited a.txt");
  assert.strictEqual(git(repo, "rev-parse", "HEAD"), before, "owner's HEAD moved");
  assert.strictEqual(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "one\n",
    "owner's working copy was modified");
  assert.strictEqual(git(repo, "status", "--porcelain"), "",
    "owner's tree left dirty");
});

test("keep: commits without needing the owner to have a git identity",
  { skip: !hasGit }, () => {
    const repo = newRepo();
    // Remove the repo-level identity so a commit would fail without -c.
    try { git(repo, "config", "--unset", "user.email"); } catch {}
    try { git(repo, "config", "--unset", "user.name"); } catch {}
    const wt = W.create(repo, "g-noident");
    fs.writeFileSync(path.join(wt.dir, "x.txt"), "x\n");
    const branch = W.keep(wt, "work");
    assert.strictEqual(branch, wt.branch);
    assert.match(git(wt.dir, "log", "-1", "--format=%an"), /BagIdea Office/);
    W.remove(wt, { keepBranch: false });
  });

test("create: a leftover directory from a killed run is reclaimed",
  { skip: !hasGit }, () => {
    const repo = newRepo();
    const first = W.create(repo, "g-crash");
    fs.writeFileSync(path.join(first.dir, "half.txt"), "interrupted\n");
    // Simulate the daemon dying: nothing settled, everything still on disk.
    const second = W.create(repo, "g-crash");
    assert.ok(second, "the id stayed blocked after a crash");
    assert.ok(!fs.existsSync(path.join(second.dir, "half.txt")),
      "the new run inherited the dead run's files");
    W.remove(second, { keepBranch: false });
  });

test("sweep: clears abandoned worktrees but spares live ones", { skip: !hasGit }, () => {
  const repo = newRepo();
  const dead = W.create(repo, "g-dead");
  const live = W.create(repo, "g-live");
  W.sweep(new Set([live.dir]));
  assert.ok(!fs.existsSync(dead.dir), "abandoned worktree survived a sweep");
  assert.ok(fs.existsSync(live.dir), "a running ghost's worktree was swept away");
  W.remove(live, { keepBranch: false });
});

test("a ghost id with path characters cannot escape the worktree home",
  { skip: !hasGit }, () => {
    const repo = newRepo();
    const wt = W.create(repo, "../../etc/evil");
    assert.ok(wt, "no worktree created");
    assert.ok(fs.realpathSync(wt.dir).startsWith(fs.realpathSync(W.worktreeHome())),
      "worktree escaped its home: " + wt.dir);
    W.remove(wt, { keepBranch: false });
  });

test("rewritePaths: an absolute shared path in a job becomes the ghost's own", () => {
  const B = String.fromCharCode(92);
  const from = "C:" + B + "work" + B + "game";
  const text = "In " + from + " edit shared.txt, and check C:/work/game/logs";
  const out = W.rewritePaths(text, from, "D:/wt/g1");
  assert.ok(!out.includes("work" + B + "game"), "backslash form survived: " + out);
  assert.ok(!out.includes("C:/work/game"), "forward-slash form survived: " + out);
  assert.strictEqual(out, "In D:/wt/g1 edit shared.txt, and check D:/wt/g1/logs");
});

test("rewritePaths: leaves text alone when there is nothing to rewrite", () => {
  assert.strictEqual(W.rewritePaths("just do the thing", "C:/a", "C:/b"),
    "just do the thing");
  assert.strictEqual(W.rewritePaths("x", null, "C:/b"), "x");
  assert.strictEqual(W.rewritePaths("", "C:/a", "C:/b"), "");
});

test("rewritePaths: a path with regex characters is matched literally", () => {
  // Project directories really are called things like "my-app (v2)".
  const from = "C:/work/my-app (v2)+beta";
  assert.strictEqual(W.rewritePaths("go to " + from + "/src", from, "D:/g"),
    "go to D:/g/src");
});

test("remove: leaves no empty directory behind", { skip: !hasGit }, () => {
  // Windows can complete `worktree remove` and still leave the directory, which
  // is enough to block the next run of that ghost id.
  const repo = newRepo();
  const wt = W.create(repo, "g-residue");
  W.remove(wt, { keepBranch: false });
  assert.ok(!fs.existsSync(wt.dir), "an empty directory was left at " + wt.dir);
});
