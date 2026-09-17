# bagidea CLI — Run the office from your terminal

![bagidea --help](../img/cli.png)

The installer wires the `bagidea` command into your PATH (manual install: use the
`bagidea.cmd` at the root of the repo, or add the repo folder to your PATH).

## All commands

```
Program
  bagidea start                 Open the office (if not already running)
  bagidea stop                  Shut everything down
  bagidea restart               Stop and start again (reload code/scenes/plugins)
  bagidea status                System overview + agents + projects + keys
  bagidea stats                 📊 7-day work stats + costs + charts
  bagidea update                Update + restart
  bagidea version               Current version + notice if an update is available
  bagidea startup [on|off]      Launch the office with Windows (view/set)
  bagidea uninstall [--keep-data]  Uninstall (PATH, shortcut, autostart, files)
  bagidea --help                This page

Talk to the office
  bagidea ask "<message>"       Issue a task as CEO and wait for the final answer
  bagidea chat <agent> "<msg>"  Send a task to a specific agent (no wait)
  bagidea feed                  Watch live events (Ctrl+C to exit)
  bagidea note "<message>"      Pin a note on the central board

Team and work
  bagidea agents                List of staff + voices + tools
  bagidea brains                Per-agent model + provider connect + context status
  bagidea projects              List of projects + who is working on them
  bagidea open "<project>"      Open a project window (= ▶)
  bagidea jobs                  Scheduled / recurring agent jobs
  bagidea editor                Open the 3D Office Editor
  bagidea memory <agent>        Read an agent's memory notebook
  bagidea office                Read OFFICE.md (shared info)

Proposals from the team
  bagidea proposals             Project proposals awaiting approval
  bagidea proposal show <id>    Read the full details
  bagidea proposal approve <id> [message]   Approve (+ message to the team)
  bagidea proposal reject <id> [message]    Reject (+ reason)

Plugins
  bagidea plugins               List of installed plugins
  bagidea plugin install <url>  Install from GitHub
  bagidea plugin remove <id>    Remove (built-in plugins cannot be removed)

AI features (use main API keys)
  bagidea lang [code]               View/set the office language (14 languages)
  bagidea say "<message>" [preset]  Have a TTS voice speak (default sunny)
  bagidea voices                    List of voice presets
  bagidea image "<prompt>"          Generate an AI image → returns a path
  bagidea keys                      View configured keys (values not shown)
  bagidea key set <NAME> <value>    Store an API key in the vault (env-injected)
  bagidea key rm <NAME> | test [NAME]   Remove a key / test one works
  bagidea channels                  Status of Telegram · Discord · LINE · Slack · WhatsApp · Messenger

Move to a new machine
  bagidea export [file]         Pack agents · skills · memory · projects · plugins → one .tgz
  bagidea import <file>         Restore an exported office here (asks before overwriting)

Working unattended
  bagidea auto [on|off]         🤖 Keep-going mode — the team decides for itself and opens
                                its own next turn instead of stopping mid-job to ask you.
                                Up to 8 self-driven rounds per job; it still stops for
                                missing access and for anything irreversible.

Security
  bagidea trust                 🛡 Projects whose own .claude hooks are waiting on
                                your word (work inside them is parked until then)
  bagidea trust allow "<project>"   Let that project's hooks run · trust deny "<p>"

Cost control
  bagidea eco [on|off]          🌱 Eco mode — cut idle token burn: background rhythms
                                stretch (heartbeat ≥3h, social ≥6h, pitches ≥6h) and the
                                delegated-work QA double-pass is skipped. Your direct
                                orders are never slowed.

Inbox
  bagidea inbox                 What's waiting for you (numbered) + what's unread
  bagidea approve <n|id> [note] Answer an item with its first option
  bagidea deny <n|id> [note]    …with its last option
  bagidea answer <n|id> <option> [note]   …with a specific option (continue, enable, always…)
  bagidea notify [test]         Unread notifications · `test` sends one through your rules
  bagidea budget                Today's spend vs your caps (office · agent · project)
  bagidea budget set office 5   Cap the office at $5/day · set agent <id> 2 · set project <id> 40 · off
  bagidea budget digest [on|off|HH:MM]   The morning digest (no argument = send it now)

Work
  bagidea tasks [todo|doing|waiting|done]   The task board — every open card, or one column
  bagidea task add "<title>" [--owner id] [--due YYYY-MM-DD] [--p 1-4] [--project name]
  bagidea task done <n|id>      Move a card to done · task move <n|id> <status>
  bagidea cal                   The next 30 days (recurrence expanded)
  bagidea cal add "<title>" <YYYY-MM-DDTHH:MM> [--every day|week|month] [--remind <min>]
  bagidea cal ics > office.ics  Export the calendar
  bagidea codex                 Codex status + recent runs
  bagidea codex "<task>" --project <name>   Hand Codex a task (returns when it finishes)
  bagidea codex review [project]            A second-opinion review of the uncommitted changes
  bagidea teams                 Team templates, and who is already hired
  bagidea hire --team dev-shop  Hire a whole template team (existing agents are never overwritten)
  bagidea plugin library        The official plugins that ship with the office
  bagidea plugin install <id>   Install one by id (a git URL still works)

Maintenance
  bagidea doctor                Diagnose why the office won't load — port, proxy,
                                firewall, execution policy, missing claude CLI.
                                Runs without the daemon; prints the fix it finds.
  bagidea fixmic                Reset a stuck Windows mic panel
```

## Moving your office to a new machine

`bagidea export` writes `bagidea-office-backup-YYYY-MM-DD.tgz` with everything that
makes your office *yours*: the team (agents, roles, skills, brains, API keys), agent
memory, meetings, projects, uploads and installed plugins. Junk (node_modules,
temp/staging dirs) is left out automatically.

On the new machine: install BagIdea Office normally, copy the file over, then
`bagidea import <file>` — it shows what's inside, asks for a `yes`, backs up the
existing registry, restores everything and restarts the office. Same team, new desk.

> ⚠ The export file contains your **API keys** — treat it like a password: keep it
> private and delete it after the import succeeds.

## Real-world examples

```powershell
# Boot up your machine and open the office straight from the terminal
bagidea start

# Ask anything — the command blocks until the answer is complete (great for scripts)
bagidea ask "Summarize the work the team did last night for me"

# Issue a long task without waiting, then open a screen to watch events
bagidea chat pixel "Refactor all the CSS in the Calculator project"
bagidea feed

# Check who is doing what
bagidea status
```

## Using it with scripts/automation

- `ask` returns plain text on stdout — pipe it straight on:
  ```powershell
  bagidea ask "Write a commit message from this git diff: $(git diff --stat)" | clip
  ```
- Every command talks to the daemon at `http://127.0.0.1:8787` — the same
  endpoint the UI uses (see the HTTP API table in the README); you can write
  your own integrations directly against it.
- `feed` reads from `daemon/journal.jsonl` — the permanent log of the whole office.
