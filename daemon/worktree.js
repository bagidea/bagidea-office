// BagIdea Office — per-ghost git worktrees.
//
// When an agent forks into ghost clones, every clone has been working in the
// SAME directory. Two of them editing one file is not a race the office can win
// by being careful; it is a race it can only avoid by not putting them there.
//
// A git worktree is the cheap fix: same repository, same history, a separate
// checkout on its own branch. Each ghost gets one, works in it, and what it did
// arrives as a branch the owner can look at and merge — instead of as edits that
// silently overwrote a sibling's.
//
// Rules this module holds to:
//   • Never touch the owner's checkout. No commits on their branch, no stash,
//     no index changes. Everything happens in the worktree.
//   • A ghost that changed nothing leaves nothing behind. Worktree and branch
//     both go; an office that litters branches is one people turn off.
//   • A ghost that DID change something never has its work thrown away, even
//     when it failed. The branch survives, and the caller is told its name.
//   • Anything unexpected returns null and the caller falls back to the shared
//     directory — worktrees are an improvement, not a dependency.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const RUN = { encoding: "utf8", timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] };

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], RUN).trim();
}
function gitQuiet(dir, args) {
  try { return git(dir, args); } catch { return null; }
}

// The repository root a directory belongs to, or null. Also returns null inside
// a bare repo or a directory that merely has a .git file we cannot resolve.
function repoRoot(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const top = git(dir, ["rev-parse", "--show-toplevel"]);
    return top ? path.resolve(top) : null;
  } catch { return null; }
}

// Worktrees live beside the office, not inside the owner's project: a stray
// directory in their repo is the kind of mess that gets a feature switched off.
function worktreeHome() {
  return path.join(os.tmpdir(), "bagidea-office-ghosts");
}

// The id becomes both a directory name and a git branch name, and git's rules
// are the stricter of the two: no "..", no leading "-", no trailing ".lock". A
// dot buys nothing here, so it does not survive at all.
const safe = (s) => (String(s || "").replace(/[^A-Za-z0-9_-]/g, "-")
  .replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)) || "ghost";

// Give this ghost its own checkout. Returns { dir, branch, repo } or null when
// the directory is not a repo, git is missing, or anything else goes wrong.
function create(cwd, ghostId) {
  const repo = repoRoot(cwd);
  if (!repo) return null;
  const id = safe(ghostId) || "ghost";
  const branch = "office/ghost-" + id;
  const dir = path.join(worktreeHome(), id);
  try {
    fs.mkdirSync(worktreeHome(), { recursive: true });
    // A leftover from a killed run would make `worktree add` fail; clear it
    // first so one crashed ghost does not block the id forever.
    if (fs.existsSync(dir)) remove({ dir, branch, repo }, { keepBranch: false });
    gitQuiet(repo, ["worktree", "prune"]);
    gitQuiet(repo, ["branch", "-D", branch]);
    git(repo, ["worktree", "add", "--detach", dir, "HEAD"]);
    git(dir, ["switch", "-c", branch]);
    return { dir, branch, repo };
  } catch (e) {
    // Most likely: git older than worktree support, a repo with no commits yet,
    // or no permission to write the temp dir. The caller shares the directory
    // like it always did.
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    return null;
  }
}

// What this ghost actually did. Counts BOTH committed and uncommitted work, so
// a ghost that never ran `git commit` still reports its changes.
function changes(wt) {
  if (!wt) return { changed: false, files: 0, stat: "" };
  const dirty = gitQuiet(wt.dir, ["status", "--porcelain"]) || "";
  const ahead = gitQuiet(wt.dir, ["log", "--oneline", "HEAD", "--not", "--remotes", "--max-count=50"]);
  const files = dirty ? dirty.split("\n").filter(Boolean).length : 0;
  const committed = gitQuiet(wt.dir, ["diff", "--stat", "HEAD~1", "HEAD"]);
  return {
    changed: files > 0 || !!(ahead && ahead.trim() && committed),
    files,
    stat: (gitQuiet(wt.dir, ["diff", "--stat"]) || "").split("\n").slice(-1)[0] || "",
  };
}

// Keep whatever the ghost did, as a commit on its own branch. Uncommitted work
// is committed here rather than discarded — a ghost that edited files and did
// not commit still meant to change something.
function keep(wt, message) {
  if (!wt) return null;
  try {
    const dirty = gitQuiet(wt.dir, ["status", "--porcelain"]) || "";
    if (dirty.trim()) {
      git(wt.dir, ["add", "-A"]);
      // -c so this never depends on the owner having configured a git identity,
      // and never writes one into their config.
      execFileSync("git", ["-C", wt.dir,
        "-c", "user.name=BagIdea Office", "-c", "user.email=office@bagidea.local",
        "commit", "-m", String(message || "ghost work").slice(0, 200), "--no-verify"], RUN);
    }
    return wt.branch;
  } catch { return null; }
}

// opts.keepBranch: false deletes the branch too (nothing was done in it).
function remove(wt, opts = {}) {
  if (!wt) return;
  try { execFileSync("git", ["-C", wt.repo, "worktree", "remove", "--force", wt.dir], RUN); } catch {}
  // Always, not only on failure. On Windows `worktree remove` empties the
  // directory and deregisters it, then cannot delete the directory itself while
  // the ghost's process still has it as a working directory — which it does,
  // for a moment, at exactly the time we get here. One deferred retry clears it;
  // if even that loses the race the leftover is empty and harmless, and both
  // create() and the boot sweep reclaim it.
  try { fs.rmSync(wt.dir, { recursive: true, force: true }); }
  catch {
    const t = setTimeout(() => {
      try { fs.rmSync(wt.dir, { recursive: true, force: true }); } catch {}
    }, 4000);
    if (t.unref) t.unref();          // never hold the daemon open for this
  }
  gitQuiet(wt.repo, ["worktree", "prune"]);
  if (opts.keepBranch === false) gitQuiet(wt.repo, ["branch", "-D", wt.branch]);
}

// Point a ghost's instructions at its OWN checkout.
//
// This is the part that decides whether isolation is real. A parent handing out
// jobs writes them the obvious way — "in C:\work\game, edit shared.txt" — and a
// ghost given an absolute path uses it, walking straight out of the worktree and
// back into the directory its siblings are in. Measured, not guessed: the first
// end-to-end run had two ghosts overwrite each other's work while sitting in
// perfectly good private checkouts.
//
// Both separators, and case-insensitively on Windows, because the path may have
// been echoed back in either shape.
function rewritePaths(text, fromDir, toDir) {
  if (!text || !fromDir || !toDir) return text;
  const variants = new Set([fromDir, fromDir.replace(/\//g, "\\"), fromDir.replace(/\\/g, "/")]);
  let out = String(text);
  for (const v of variants) {
    if (!v) continue;
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, process.platform === "win32" ? "gi" : "g"), toDir);
  }
  return out;
}

// Called when a ghost finishes. Returns a short line for the ghost's result, or
// "" when there is nothing worth saying.
function settle(wt, label) {
  if (!wt) return "";
  const c = changes(wt);
  if (!c.changed) { remove(wt, { keepBranch: false }); return ""; }
  const branch = keep(wt, label);
  remove(wt, { keepBranch: true });
  return branch
    ? `\n\n[worktree] changes are on branch ${branch} (${c.files} file(s)) — review and merge`
    : "";
}

// Housekeeping: anything left by a run that died before it could settle. Only
// touches directories under our own temp home, and never a live one.
function sweep(liveDirs = new Set()) {
  let home;
  try { home = worktreeHome(); if (!fs.existsSync(home)) return 0; } catch { return 0; }
  let n = 0;
  for (const name of fs.readdirSync(home)) {
    const dir = path.join(home, name);
    if (liveDirs.has(dir)) continue;
    const repo = repoRoot(dir);
    if (repo) { try { execFileSync("git", ["-C", repo, "worktree", "remove", "--force", dir], RUN); n++; continue; } catch {} }
    try { fs.rmSync(dir, { recursive: true, force: true }); n++; } catch {}
  }
  return n;
}

module.exports = { repoRoot, create, changes, keep, remove, settle, sweep,
  rewritePaths, worktreeHome };
