// cli/find-shell.js — locate the native shell binary across platforms.
// Extracted so it can be unit-tested without spawning the full CLI.

const fs = require("fs");
const path = require("path");

/**
 * Find the compiled shell binary.
 * Tries release first, then debug as fallback.
 *
 * @param {string} root     — project root (where shell/ lives)
 * @param {string} [platform] — process.platform override (for testing)
 * @returns {string|null} absolute path to the binary, or null
 */
function findShellExe(root, platform) {
  const p = platform || process.platform;
  const isWindows = p === "win32";
  const name = isWindows ? "bagidea-office-shell.exe" : "bagidea-office-shell";
  const candidates = [
    path.join(root, "shell", "target", "release", name),
    path.join(root, "shell", "target", "debug", name),
  ];
  for (const exe of candidates) {
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

module.exports = { findShellExe };
