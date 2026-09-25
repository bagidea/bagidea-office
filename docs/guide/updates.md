# Updating the program & installer

## Update notification system (version-based)

The program has a **`VERSION`** file (e.g. `0.3.1`). It checks itself every 6 hours
(and ~90 seconds after launch) whether the version on `main` is newer than yours —
**only when a new version is actually released (the VERSION file is bumped)** does it
prompt you. Small changes (docs, website, work on the dev branch) **won't** bother
users — see the [release plan](#release-plan-dev--main).

When there's a new version:

- A bar **🔄 New version vX.Y.Z available — click to update** appears above the chat
- It's also announced in the 📡 feed
- Check it yourself: `bagidea version` (shows your current version + tells you if a new one exists)

Click the bar (or run `bagidea update`) and the system will:

1. Close the whole suite
2. `git pull` the latest code
3. Recompile the shell *only when* the shell code changed (no Rust on the machine
   means it keeps using the existing exe, with guidance)
4. Reopen the program by itself

> Your data (agent team, threads, projects, notes, key vault) lives in files that
> git doesn't touch (`registry.json`, `sessions.json`, `projects.json`, …) —
> it's never lost no matter how many times you update.

## Auto-start at login (auto-start)

You can set the office to open itself when you boot — supported on all 3 OSes
(Windows = HKCU Run key, macOS = LaunchAgent, Linux = the XDG file
`~/.config/autostart/bagidea-office.desktop`):

- **Settings** ⚙ → AGENTS → the **🪟 Start at login** switch
- **CLI:** `bagidea startup on` / `bagidea startup off` (no argument = show status)
- **Tray:** right-click the icon → **Start at login**

> **Updating on macOS/Linux:** `bagidea update` works the same way (Linux calls
> `installer/update-linux.sh` = git pull + recompile the shell if needed + restart).

## Release plan (dev → main)

The notification system is tied to the `VERSION` file on `main` so users only get
things that are truly ready:

1. Work lands on **`main`** behind CI (three OSes, two Node versions) — a plain commit on `main` does **not** reach users, because the updater only looks at `VERSION`
2. A release = a `VERSION` bump + tag once CI is green; `dev` is kept in sync with `main` for anyone who branched from it
3. Release a new version = **bump `VERSION`** (semver) on `main` and push
   → users' machines see it's newer and the 🔄 bar appears

> In short: you can merge into main without triggering a notification, as long as
> you haven't bumped `VERSION` — the notification fires "only when we intend to
> release a new version" (see `RELEASING.md`).

## Installer (for a new machine)

```powershell
irm https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install.ps1 | iex
```

| Step | What it does |
|---|---|
| 1-4 | Install Git / Node LTS / Rust / **VS C++ Build Tools** (via winget — skips what's already there) |
| 5-6 | Download Godot 4.6.3 + set `BAGIDEA_GODOT` · install the Claude Code CLI |
| 7 | clone the program → `%LOCALAPPDATA%\BagIdeaOffice\app` (already there = pull) |
| 8 | compile the shell (first time ~2-3 minutes) + brand the icon |
| 9-11 | fix hook paths · wire the `bagidea` command into PATH · create a Start Menu shortcut |

> Install didn't go through? See [Installation problems](troubleshooting.md)

You can always re-run it — it doubles as a built-in "repair install".

**After the first install:** open a new terminal → `claude` (log into your Claude
account once) → `bagidea start` 🎉

## Uninstalling

```powershell
bagidea uninstall              # remove everything (confirms first)
bagidea uninstall --keep-data  # back up data (agents/projects/keys) before removing
```

Removes only BagIdea Office's own files: stops the program, removes `bagidea` from PATH,
deletes the Start Menu shortcut, turns off start-with-Windows, and deletes the folder
`%LOCALAPPDATA%\BagIdeaOffice` — it **doesn't touch** Git / Node / Rust / Claude
(tools shared with other programs; remove them yourself with winget if you want).
`--keep-data` backs up `registry/sessions/projects/...` + `workspace` to
`%USERPROFILE%\BagIdeaOffice-data-backup` first, in case you want to reinstall later
(open a new terminal after uninstalling so PATH updates).
