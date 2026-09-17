#!/usr/bin/env node
"use strict";
/*
 * BagIdea Office — npm bootstrapper.
 *
 * BagIdea Office isn't a pure-JS CLI: it's a Node daemon + a compiled Rust shell
 * + a Godot wallpaper + Claude Code. So this thin npm package doesn't ship the
 * app — it runs the official platform installer, which clones the repo, builds
 * the shell, fetches Godot and wires everything up.
 *
 *   npx bagidea-office          install (or update) for your OS
 *   npm i -g bagidea-office && bagidea-office
 *
 * After install you use the real `bagidea` command (start / stop / update / …).
 */
const { spawnSync } = require("child_process");
const os = require("os");
const pkg = require("./package.json");

const REPO = "https://github.com/bagidea/bagidea-office";
const RAW = "https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer";

const arg = (process.argv[2] || "").toLowerCase();

if (arg === "-v" || arg === "--version") {
  console.log(pkg.version);
  process.exit(0);
}

if (arg === "-h" || arg === "--help") {
  console.log(`
🏢  BagIdea Office — your desktop wallpaper goes to work.

  A living HD-2D office where every AI agent is a real Claude Code session:
  agents walk to their desks, ask permission, hold meetings and do real work,
  rendered behind your desktop icons. Open source. 14 languages.

Usage
  npx bagidea-office           install (or update) BagIdea Office for your OS
  npx bagidea-office --help     show this help
  npx bagidea-office --version  show the installer version

This downloads and runs the official installer for your platform:
  Windows   installer/install.ps1   (via PowerShell)
  macOS     installer/install-mac.sh
  Linux     installer/install-linux.sh

You'll need Claude Code (https://claude.com/claude-code). After install, manage
the office with the 'bagidea' command (start / stop / restart / update).

Repo: ${REPO}
`);
  process.exit(0);
}

const platform = os.platform();

console.log("\n🏢  BagIdea Office installer — your wallpaper goes to work.\n");

let cmd, args;
if (platform === "win32") {
  cmd = "powershell";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${RAW}/install.ps1 | iex`];
} else if (platform === "darwin") {
  cmd = "bash";
  // --proto '=https' --tlsv1.2: refuse any non-HTTPS redirect and reject pre-TLS-1.2,
  // so the installer script can't be fetched over a downgraded/plaintext channel.
  args = ["-c", `curl --proto '=https' --tlsv1.2 -fsSL ${RAW}/install-mac.sh | bash`];
} else if (platform === "linux") {
  cmd = "bash";
  args = ["-c", `curl --proto '=https' --tlsv1.2 -fsSL ${RAW}/install-linux.sh | bash`];
} else {
  console.error(`Unsupported platform: ${platform}.\nSee ${REPO} for manual install instructions.`);
  process.exit(1);
}

console.log(`→ Running the ${platform} installer (downloads a prebuilt app + Godot — no build on a normal install; can take a few minutes)…\n`);

const r = spawnSync(cmd, args, { stdio: "inherit" });

if (r.error) {
  console.error(`\n✗ Could not launch the installer: ${r.error.message}`);
  console.error(`  Run it manually — see ${REPO}#install`);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
