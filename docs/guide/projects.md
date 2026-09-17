# Projects — agents working in real folders

A project = a name + a real folder on the machine. The agent that takes the work runs its claude session
**inside** that folder — and you can always press ▶ to step in and continue from the existing session

![The OFFICE OPS → PROJECTS panel](../img/projects.png)

## PLACES — short location names

🗂 OFFICE OPS → PROJECTS, at the bottom: map a short name → a parent folder, e.g.

```
"classroom"  →  D:\Learning
"company work"  →  D:\Work
```

After that both you and the AI can use the name directly: *"Create project X in the classroom"*

## Create / register a project

**Shortcut (recommended):** tell the Director in chat

```
Create a project called Calculator in the classroom, then have Flamingo build a calculator web app, and tell me when it's done
```

The system will: create + register the project → assign the work scoped to that project → the team member starts a session
*inside* `D:\Learning\Calculator` from the very first message → the project row shows
**🤖 Working** → and when it's done, the report flows back up the chain to you

**Via the UI:** type a name + pick a place (or ⌨ set the path yourself / 📁 pick an existing folder
with the built-in folder picker) → **Create / Register**

## 🛡 Registering a folder someone else wrote

A folder can carry its own `.claude/settings.json`. That file is **executable
configuration**: it can declare a command hook (e.g. `SessionStart`) that runs the
moment a session opens in that folder — before the model says a word, so the
Security Center never sees it.

Because headless sessions can't show Claude Code's own "do you trust this folder?"
dialog (they would stall on it forever), the office pre-trusts every project
directory. Registering a folder is bookkeeping, though — it must not silently mean
*"yes, run whatever code this repo ships"*. So:

- A project with **no hooks of its own** — nearly all of them — is trusted silently,
  exactly as before. Nothing changes.
- A project that **does** ship hooks raises a card in the 🛡 Security Center listing
  the literal commands it would run, and **work inside it waits** until you answer.
  Approve and the parked task resumes by itself — you don't re-type it.
- Approval is bound to that **exact** setup. Edit the settings file, or the script a
  hook calls, and you're asked again. A hook whose script resolves *outside* the
  project is flagged on the card.
- No office window open? The same decision is in the terminal: `bagidea trust`
  lists what's waiting, `bagidea trust allow "<project>"` releases it. A block is
  also pushed to your [channels](channels.md).

> This covers repo-supplied **hooks** specifically. `permissions` rules in a project
> settings file are not gated — those still run through the office's own approval
> broker — and project `.mcp.json` servers are approved separately by Claude Code.

## Buttons in a project row

Each row makes it clear who's in the project: 🖥 **you're working in it** (green) · 🫥 yours running in the background ·
🤖 **an agent is working** (blue + glowing left edge)

| Button | What it does |
|---|---|
| ▶ | Opens the project's *single window* — if one already exists (even hidden) it brings that one back, no duplicate |
| ⏹ Stop agent | Appears in place of ▶ when **an agent is working** — first press shows "Confirm stop?", press again = stop the agent's work so you can take over |
| 🫥 | Hide the window — claude keeps working in the background (like tmux) |
| ⏹ | Actually end that window's work |
| 🖥 | A blank terminal in the folder (doesn't count as "opening the project") |
| 📂 | Open the folder in Explorer |
| ✕ | Remove it from the list (files stay intact) — **also closes the project's window for you** |
| 🗑 | Actually delete the folder from disk (only for projects the app created itself) — closes any lingering window/server first |

## One person per project (collision lock)

A project can have one "worker" at a time, so you and an agent don't edit files at cross purposes:

- **An agent is working → you can't open it yet.** The button becomes **⏹ Stop agent**; confirm to stop their work first,
  then press ▶ to step in (their existing session stays fully intact)
- **You have the project open → an agent can't enter.** If the Director assigns work into a project you have open,
  the system reports back that "the owner has it open," and he re-plans — close your window first before he can get in

## ▶ Smart by situation

- **Nobody's working** → opens Windows Terminal straight into the latest session
  (`claude --resume <latest>` — Thai font renders nicely per your default profile)
- Closing the window (X) = ends just the window — the session stays intact, press ▶ to pick up where you left off.
  The status in the list updates itself within ~5 seconds

## Per-project memory (MEMORY.md)

After an agent finishes real work in a project, the office **automatically distills the project's key facts**
(from a post-work reflection) and saves them as short `- ...` lines to the file

```
workspace/projects/<project>/MEMORY.md
```

- This file belongs to the **office, not your real repo** — the project folder on disk
  stays clean at all times
- On later sessions, when the context concerns this project, the system **pulls only the memory relevant
  to the task at hand** and injects it for the agent (not the whole blob) — so the agent "remembers" the project
  without burning tokens
- **Editable by hand:** open this file and add/remove/edit lines as you like; it takes effect on the next round

## Rules agents are taught

- Do a project's work *inside* the project only (the system routes this automatically)
- Never delete/remove a project (removal via the API is a human-only right through the UI)
- Always test in the background first (curl / headless) — don't pop a window in your face
- **A test server you started must be shut down before reporting the work done** — don't leave processes lingering
