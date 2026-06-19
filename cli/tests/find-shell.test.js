// cli/tests/find-shell.test.js — unit tests for findShellExe()
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { findShellExe } = require("../find-shell");

// Create a temp dir that mimics the project structure
function makeTempProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-test-"));
  const releaseDir = path.join(tmp, "shell", "target", "release");
  const debugDir = path.join(tmp, "shell", "target", "debug");
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(debugDir, { recursive: true });
  return { tmp, releaseDir, debugDir };
}

function cleanup(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- macOS ---

test("macOS: finds bagidea-office-shell (no .exe) in release", () => {
  const { tmp, releaseDir } = makeTempProject();
  const binary = path.join(releaseDir, "bagidea-office-shell");
  fs.writeFileSync(binary, "fake binary");

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, binary);

  cleanup(tmp);
});

test("macOS: does NOT find bagidea-office-shell.exe", () => {
  const { tmp, releaseDir } = makeTempProject();
  // Only .exe exists — should NOT be found on macOS
  fs.writeFileSync(path.join(releaseDir, "bagidea-office-shell.exe"), "fake");

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, null);

  cleanup(tmp);
});

test("macOS: falls back to debug build", () => {
  const { tmp, debugDir } = makeTempProject();
  const binary = path.join(debugDir, "bagidea-office-shell");
  fs.writeFileSync(binary, "fake binary");

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, binary);

  cleanup(tmp);
});

test("macOS: prefers release over debug", () => {
  const { tmp, releaseDir, debugDir } = makeTempProject();
  const rel = path.join(releaseDir, "bagidea-office-shell");
  const dbg = path.join(debugDir, "bagidea-office-shell");
  fs.writeFileSync(rel, "release");
  fs.writeFileSync(dbg, "debug");

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, rel);

  cleanup(tmp);
});

// --- Linux ---

test("linux: finds bagidea-office-shell (no .exe) in release", () => {
  const { tmp, releaseDir } = makeTempProject();
  const binary = path.join(releaseDir, "bagidea-office-shell");
  fs.writeFileSync(binary, "fake binary");

  const result = findShellExe(tmp, "linux");
  assert.equal(result, binary);

  cleanup(tmp);
});

// --- Windows ---

test("win32: finds bagidea-office-shell.exe in release", () => {
  const { tmp, releaseDir } = makeTempProject();
  const binary = path.join(releaseDir, "bagidea-office-shell.exe");
  fs.writeFileSync(binary, "fake binary");

  const result = findShellExe(tmp, "win32");
  assert.equal(result, binary);

  cleanup(tmp);
});

test("win32: does NOT find bagidea-office-shell without .exe", () => {
  const { tmp, releaseDir } = makeTempProject();
  // Only non-.exe exists — should NOT be found on Windows
  fs.writeFileSync(path.join(releaseDir, "bagidea-office-shell"), "fake");

  const result = findShellExe(tmp, "win32");
  assert.equal(result, null);

  cleanup(tmp);
});

test("win32: falls back to debug build", () => {
  const { tmp, debugDir } = makeTempProject();
  const binary = path.join(debugDir, "bagidea-office-shell.exe");
  fs.writeFileSync(binary, "fake binary");

  const result = findShellExe(tmp, "win32");
  assert.equal(result, binary);

  cleanup(tmp);
});

// --- Edge cases ---

test("returns null when no binary exists", () => {
  const { tmp } = makeTempProject();
  // release and debug dirs exist but are empty

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, null);

  cleanup(tmp);
});

test("returns null when shell/target dirs don't exist at all", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-test-empty-"));
  // No shell/ directory at all

  const result = findShellExe(tmp, "darwin");
  assert.equal(result, null);

  cleanup(tmp);
});
