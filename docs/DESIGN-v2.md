# BagIdea Office v2.0 — design

*Status: proposal, 2026-09-12. Written before any code, the way the v1.0 plan was.*

---

## 0. The one sentence

**v1 is an office that waits for you. v2 is an office that runs while you're away — and can be trusted to.**

Everything below serves that sentence. The features people are asking for
individually (a usable Workflow Builder, tasks and a calendar that mean
something, notifications you actually notice, more plugins, Codex) are not a
list. They are the parts of one machine, and they only work when the others are
there too: a workflow that can run unattended needs a budget so it can't run
away, an inbox so it can ask, and a notification you'll see when it does.

## 1. What the field told us

In the two weeks since v1.0 every signal pointed the same way.

| Signal | What it says |
|---|---|
| An engineer set up two 5060Ti boxes for a **customer** to run local LLMs | The office is being deployed on other people's machines, running overnight, unwatched |
| [#46](https://github.com/bagidea/bagidea-office/issues/46): a thread burned **9.5M tokens** before anyone looked | There is no spend guardrail. The only thing that caught it was a human reading a meter |
| [#48](https://github.com/bagidea/bagidea-office/issues/48) / [#50](https://github.com/bagidea/bagidea-office/issues/50): a plugin author built an **approval queue** out of disabled jobs | People want "do this, but wait for my sign-off" and the office has no primitive for it, so they hack one |
| AUTO mode is the most-used thing v0.9.48 added | People want it to keep going |
| The CEO: *"sometimes I barely know there's a notification"* | When the wallpaper is covered, the office is silent |
| The CEO: *"the Workflow Builder should be usable for real"* | `/workflows/run` turns the graph into prose and hands it to the Director. It is a drawing, not an engine |

## 2. Where things actually are (from the code, not the docs)

Read this before arguing about scope. Each line was checked on 2026-09-12.

**Workflow Builder.** Nodes are `trigger / fetch / action / decision / output`.
The only trigger is *"when told to start."* Running a workflow
(`POST /workflows/run`) serializes it to text and sends it to the Director as an
order. Parallel branches become `SUB:` lines. There is no per-node execution, no
state, no run history, no retries, and no way for a node to wait for a person.

**Triggers.** None inbound except chat channels and cron jobs. The `POST /event`
route accepts arbitrary OEP events but nothing routes them anywhere.

**Notifications.** In-world only: the Director walks over for a `reminder`,
messages appear in chat, and `notifyChannels()` relays milestones to Telegram
and friends (default on, unfiltered, one string). **No OS toast, no tray badge,
no sound, no notification centre, no rules.** The shell has a tray icon and a
menu, and nothing else.

**Spend.** Per-request *context-token* budgets exist (`CTX_BUDGET`). There is no
money budget anywhere — not per day, per agent, per project, or per office.

**Approvals.** Five separate things wait for a human, in five separate places:
tool permissions (Security Center), project trust, project proposals, AUTO's
`STATUS: BLOCKED`, and jobs left disabled. No shared queue, no shared history,
no API a plugin can use.

**Tasks.** Work lives in three files that don't know about each other:
`jobs.json` (now / at / every), per-meeting `*.actions.json` (action items, per
ADR-0001), and `proposals.json`. No priorities, no dependencies, no due-date
reminders, no board.

**Calendar.** `{ id, title, at, remindMin, notified }`. One-shot reminders. No
recurrence, no link to a job or a project or an agent, no import/export.

**Plugins.** `ctx = { broadcast, feed, reg, saveReg, workspace, daemonDir,
dataDir, pluginDir, manifest, log, runClaude }` plus routes, a panel and agent
commands. A plugin cannot: receive an event, send a notification through the
office's rules, ask for an approval, schedule anything, or contribute to a
prompt. 24 plugins exist on disk (mostly team-built); 6 are in the Hub.

**Codex.** Not integrated. But `codex` is on this machine (v0.140.0; npm
0.154.0), and its CLI surface is exactly what an integration needs:
`codex exec` is non-interactive with `--json` event output, `-C <dir>`, a
sandbox switch, `--ephemeral`, and `--oss --local-provider ollama`;
`codex exec review` reviews a repo; and `codex mcp-server` runs Codex as an MCP
server over stdio.

## 3. The plan

Ten pieces, in three tiers. The tier is about dependency, not importance.

### Tier 1 — the machine (each depends on the others)

#### A. A real workflow engine

Replace *"serialize to prose and hope"* with an engine that executes nodes.

**Node vocabulary** (the current five, plus the ones that make it usable):

| Node | Does |
|---|---|
| `trigger` | starts the run — manual, schedule, or any trigger from **B** |
| `agent` | hand a task to a named agent (today's `action`), with the agent's real tools |
| `codex` | hand a coding task to Codex (see **G**) |
| `fetch` | HTTP GET/POST with headers and a body; result becomes data |
| `decision` | branch on a condition — an expression over data, or an LLM judgement with a rubric |
| `parallel` / `join` | fan out and wait (today's SUB: lines, but tracked) |
| `approval` | **stop and wait for a person** — lands in the inbox (**E**), resumes on approve |
| `notify` | send through the notification rules (**C**), not raw chat |
| `delay` | wait N minutes / until a time |
| `loop` | over a list, with a cap |
| `output` | write a file, post to a channel, create a task, update a calendar entry |

**Execution.** Each run is a record: `{ id, workflowId, trigger, startedAt,
nodes: { [id]: { state, startedAt, endedAt, output, cost } } }`, persisted as
it goes, so a daemon restart resumes rather than forgets. State machine per
node: `pending → running → done | failed | waiting (approval) | skipped`.
Failed nodes retry per a node-level policy (default: once). A run has a total
budget (**D**) and stops when it is exhausted.

**Data.** Nodes pass a JSON object down the edges. `{{node.field}}` templating
in any text field. Small and explicit — no scripting language.

**History.** `GET /workflows/runs` with per-node timing and cost. The builder
gets a **Runs** tab: click a run, see each node light up, read its output. This
is the difference between a tool and a toy: you can see what happened.

**Builder changes.** Node palette grows; each node gets a config drawer;
a run is watchable live (nodes change colour as they execute, via the same
WS events the world uses). The existing **Analyze** and **Draft with
Director** stay.

**Compatibility.** Saved v1 workflows load unchanged; their `action` nodes
map to `agent`. `POST /workflows/skill` keeps working.

#### B. Triggers — the office reacts to the world

A trigger is a source of runs. Each one is a small module with one job.

| Trigger | Config | Fires when |
|---|---|---|
| **webhook** | a generated URL + secret | anything POSTs to it (GitHub, Stripe, Zapier, a shell script) |
| **github** | repo + events | an issue opens, a PR is opened/reviewed, a push lands (signed webhook, verified) |
| **schedule** | cron-ish, like jobs today | on time |
| **email** | IMAP host + folder + filter | a matching mail arrives (subject/sender/attachment) |
| **file** | a folder + glob | a file appears or changes |
| **channel** | a keyword or a slash-command | someone says it on Telegram/Discord/LINE/… |
| **event** | an OEP event type | anything in the office (`task.completed`, `proposal.created`, a plugin's own event) |
| **rss** | a feed URL | a new item |

The daemon only ever *listens on 127.0.0.1*. Inbound webhooks therefore need a
path in: the built-in **tunnel** step in setup (we already document ngrok /
cloudflared for LINE), or an optional listener bind — off by default, with the
warning it deserves.

Every trigger payload is normalized to `{ source, event, data, at }` before it
reaches a workflow, so the same workflow can be fed by GitHub today and by
email tomorrow.

**This is what turns the office from "ordered" to "on duty."** *"New issue →
Marcus triages and labels it within five minutes"* and *"a client drops a file
in the shared folder → Priya converts it and puts it back"* are the two demos.

#### C. Notifications you actually notice

Today a notification is a pixel character walking across a wallpaper that may
be covered by a browser. Layered fix, cheapest first:

1. **Notification centre in the overlay** — a 🔔 with an unread count, a list,
   mark-read, jump-to-source. The single place everything lands.
2. **Tray badge** — the tray icon changes state when there are unread items;
   clicking it opens the centre. Shell change (`tray_icon` already there).
3. **OS toast** — Windows toast, macOS `UNUserNotification`, Linux
   `notify-send`. Click opens the item. Shell change, per platform.
4. **Sound** — one short cue, respecting the existing sound toggle.
5. **Channels** — what `notifyChannels()` does now, but through the rules.

**Rules** (⚙ → 🔔 NOTIFICATIONS, ALL-CAPS English lead term): per *kind*
(approval needed · work finished · budget warning · workflow failed · reminder ·
mention · proposal), choose *where* (centre / toast / channel / sound) and
*when* (always / not in quiet hours / only if I'm away). **Quiet hours** with a
timezone. **"Away" detection** from input idle time — a toast is pointless when
you're typing in the chat, and essential when you're in another app.

**One API for everything:** `notify({ kind, title, body, link, agent })`.
Plugins get it (**H**). Nothing should call `broadcast({type:"chat.message"})`
to get attention any more.

#### D. Budgets — money, not tokens

| Scope | Setting | Behaviour |
|---|---|---|
| Office | daily cap (USD) | warn at 80 %, **hard stop** at 100 % — new turns refuse, running turns finish |
| Agent | daily cap | same, per agent |
| Project | total cap | same, per project |
| Workflow run | cap | the run stops and the `approval` node's owner is told |

Cost is already estimated per turn (`brainBump`, STATS). This adds the ledger,
the caps, and the stop. **Morning digest** (through **C**): *"Last night:
$4.20, 31 turns, 2 workflows ran, 1 waiting for you."* Provider-priced where
known, estimated where not, and labelled which.

`STATS` gains a spend-over-time view. `bagidea budget` for the terminal.

#### E. One approvals inbox

Everything that waits for a human goes through one queue:

```
{ id, kind, agent, title, detail, options, created, expires, decided, by, note }
```

`kind` ∈ tool-permission · project-trust · proposal · blocked (AUTO) ·
workflow-approval · job · plugin (**H**).

- **One panel** (🛡 → APPROVALS) replacing the scattered UIs, with history.
- **Channel round-trip**: the item is pushed with reply buttons where the
  channel has them (Telegram inline keyboard, Discord components) and a
  numbered reply where it doesn't; the answer lands back in the queue.
  Approve from a phone, with a note.
- **API**: `POST /approvals`, `GET /approvals`, `POST /approvals/respond`. This
  is what the author of #48/#50 was building by hand.
- **Policies**: "always allow X for agent Y" (today's ✓✓ forever) becomes a
  rule you can see and revoke.

Security Center keeps its spatial gimmick — the agent still walks over — but
the card it raises is an approvals item.

### Tier 2 — the surfaces (each stands alone, each is better with Tier 1)

#### F. Tasks and Calendar, for real

**One work-item model** behind jobs, action items and workflow steps:

```
{ id, title, kind, owner, project, due, priority, status,
  source: { kind, ref }, dependsOn: [], recurrence, created, updated }
```

- 📋 **Board** view (todo / doing / waiting / done) and a list view with
  filters; drag between columns; agents move their own cards as they work.
- **Due dates** feed the notification rules; **dependencies** hold a task until
  its blockers close; **priority** orders an agent's queue.
- Agents create and update tasks through a real API (`POST /tasks`), not by
  parsing prose. The Director's delegation creates a card per `DELEGATE:`.
- **Calendar** gains recurrence (RRULE subset), all-day events, links to a
  task/project/agent, and **ICS** import/export so it can live alongside a real
  calendar. Reminders route through **C**. An agent can book a follow-up.
- `bagidea tasks`, `bagidea task add|done`, `bagidea cal`.

#### G. Codex — a colleague you can call in, not a brain transplant

Two levels, and the first is nearly free.

**Level 1 — Tools Hub entry.** Add `codex` (`codex mcp-server`) to the catalog
under Work & data. One click, per-agent grant, uses the MCP path that already
exists. Any agent so granted can hand Codex a sub-task from inside its own
session. Needs: Codex installed and logged in. Risk tag: *runs a second agent*.
Ships in the first release.

**Level 2 — a `codex` system tool and workflow node.** The office drives Codex
itself, so it can watch, budget and record it:

- `POST /codex/exec { task, project, sandbox?, model? }` spawns
  `codex exec --json -C <project> -s workspace-write --ephemeral` in the
  project (or its ghost worktree, when **GHOST ISOLATION** is on — the isolation
  we built applies unchanged), streams the JSONL into a live **mission row**
  (a 🧑‍💻 Codex figure at the agent's desk), and returns the last message plus a
  diff summary. Cost is recorded against the calling agent's budget.
- `POST /codex/review { project }` runs `codex exec review` — a **second
  opinion** the verify loop can use: Claude does the work, Codex reviews it,
  or the reverse. The two disagree more usefully than either agrees with
  itself.
- Local models: `--oss --local-provider ollama` is a config toggle, for the
  offices that never send code anywhere.
- Agents get it as a system tool (like `/gen/image`) and workflows get it as
  the `codex` node. The Director's delegation grammar gains
  `DELEGATE: codex @ <project> :: <task>`.

It is never the office's brain. Persona, memory, skills, permissions and the
world all stay on the agent that *called* Codex. Codex is a tool that happens
to be an agent.

#### H. Plugins and tools — more of them, and more they can do

**New plugin hooks** (additive; every existing plugin keeps working):

| Hook | Lets a plugin |
|---|---|
| `onEvent(type, evt)` | react to office events (**B**'s `event` trigger for plugins) |
| `ctx.notify(item)` | send through the notification rules (**C**) |
| `ctx.approvals.ask(item)` → promise | wait for a human (**E**) — what #48/#50 wanted |
| `ctx.tasks` / `ctx.calendar` | create and update work items (**F**) |
| `ctx.schedule(job)` | book a job without hand-rolling `POST /jobs` |
| `ctx.triggers.register(kind, handler)` | contribute a **new trigger type** (**B**) |
| `ctx.workflow.node(kind, impl)` | contribute a **new workflow node** (**A**) |
| `ctx.memory.provider(fn)` | contribute lines at prompt-assembly time — the narrow hook agreed in #42: core owns the timeout and the ~1500-char budget, a throw yields zero lines, opt-in per agent |

**New plugins**, built against those hooks, each a real use of the office —
these are the ones that make *"I use it for marketing / planning / automation"*
true:

| Plugin | For |
|---|---|
| 📣 **Campaign Board** | a marketing calendar: posts as tasks with channel + date, drafts by an agent, an `approval` before anything is published, publish via the channel plugins |
| 📰 **Content Pipeline** | rss/url in → summarize → draft → review → publish, as a template workflow |
| 🐙 **GitHub Triage** | issues in (trigger) → label, reply, assign, open a PR for the easy ones — with an approval node in front of anything outward |
| 📬 **Inbox Agent** | email in (trigger) → classify → draft a reply → approval → send |
| 📊 **Weekly Report** | schedule → gather (tasks done, spend, workflows, meetings) → write → deliver to a channel |
| 🗂 **Client Folders** | file trigger on a folder per client → the right agent handles what lands there |
| 🧪 **Skill Regression** | promote `agent-workbench`: test cases per skill, run before a self-correction is accepted, block it if a case fails |
| 🧠 **Decision Log** | the #42 shape: `we decided X because Y` entries, superseded chains, injected at prompt time through the memory provider hook |

Plus: promote the strongest of the 24 on-disk team plugins to the Hub
(`daily-standup`, `cost-radar`, `proposal-board`, `research-board`,
`scout`, `office-mood`) after a review pass each.

**New tool catalog entries** — only ones that serve the above and verify
against the registry: `codex` (**G**), a mail sender, a calendar (CalDAV/Google
Calendar MCP), Stripe, Airtable, Trello/Asana, YouTube Data, and X/Bluesky
posting for the Campaign Board. Every entry checked the way v1.0.0's were.

### Tier 3 — the multipliers

#### I. Team templates

`bagidea hire --team dev-shop` / a **Templates** tab in ⚙ → AGENTS: a
pre-built team (names, roles, personas, skills, tools, brains, voices) in one
click — *dev shop*, *research lab*, *content studio*, *customer support*,
*solo assistant*. Built on `export`/`import`; a template is an export bundle
without the memory. This is what the person installing on customer machines
needs on day one.

#### J. Skill regression and the memory hook

Both described under **H**; called out because they are the two things that
make *self-improvement* safe. A skill that corrects itself can correct itself
wrong; a memory that compounds can compound a mistake. Tests and provenance are
the answer to both.

## 4. Order of work, and what ships when

Each phase is a release. Each is useful on its own. Nothing is held for v2.0.

| Release | Ships | Why this order |
|---|---|---|
| **v1.1 — "You'll know"** | **C** notification centre + rules + channels through rules · **E** approvals inbox + API · **G1** Codex in the Tools Hub | The two things every later feature needs, plus a free win. No shell change yet |
| **v1.2 — "On a budget"** | **D** budgets + digest · OS toast + tray badge (**C**, shell) · `bagidea budget` | Shell tag. Safe to run unattended after this |
| **v1.3 — "It runs"** | **A** workflow engine + runs history + approval/notify/delay/parallel nodes · **B** schedule + webhook + event + file triggers | The core machine. GitHub/email/rss triggers can follow in 1.3.x |
| **v1.4 — "It works"** | **F** tasks + calendar · **G2** Codex system tool + review + node · **H** plugin hooks | Surfaces on top of the engine |
| **v1.5 — "It's useful"** | **H** the eight plugins + promoted team plugins + new tool entries · **I** team templates | The demos. Each plugin is also a test of the hooks |
| **v2.0** | **J** skill regression + memory hook · the docs and website rewrite for all of it, in 14 languages | The self-improvement guard-rails, then the announcement |

Roughly two to three weeks per phase at the pace v1.0 was built. Phases can
overlap where they don't share files.

## 5. Cross-cutting rules (non-negotiable)

- **14 languages, same commit.** Every new UI surface — notification centre,
  approvals panel, board, builder palette, budget settings — leads with an
  ALL-CAPS English term, ships its strings in all 14 languages in the same
  change, and is guarded by `site-i18n` / catalog-style tests. Prompt
  scaffolding stays English; the new engine's prompts are English from the
  first line (see #49).
- **Off until you turn it on.** Triggers, budgets, OS toasts, Codex — every one
  defaults off or to today's behaviour. An office that updates and touches
  nothing behaves exactly as v1.0.5.
- **Refuse, don't downgrade.** A trigger that can't be verified, a budget that
  can't be read, a Codex that isn't installed — fail with a message, never
  silently do less.
- **Shell changes need a tag.** Tray badge and OS toast change the binary
  (v1.2). Everything else is daemon/overlay and rides `bagidea update`.
- **Tests that fail on the old code.** Every phase lands with tests verified
  against the pre-change tree, as the last five releases did.
- **Nothing new in the CEO room.** The world is not touched by this plan.

## 6. What this plan deliberately does not do

- **More brains or more tools for their own sake.** 19 providers and 43 tools
  is enough; new tool entries must serve a plugin above.
- **A scripting language in workflows.** `{{templating}}` and `decision` nodes,
  not JavaScript in a text box.
- **Multi-office fleet management.** No signal yet.
- **A mobile app.** Channels + the approvals round-trip give a phone
  everything it needs.
- **Replacing Claude Code as the runtime, or Codex as a brain.** Codex is a
  tool. The runtime stays.
- **Touching the world renderer.**

## 7. Open questions for the CEO

1. **Inbound webhooks** need a route into a machine that listens on
   `127.0.0.1`. Tunnel by default (documented, zero attack surface), or an
   optional listener bind with a big warning? *Recommendation: tunnel.*
2. **Budgets — estimate or refuse?** For providers that don't report cost,
   estimate and label it, or refuse to run without a price? *Recommendation:
   estimate, labelled.*
3. **Codex Level 2 — sandbox default.** `workspace-write` (can edit the
   project) or `read-only` (advises only) when an agent calls it?
   *Recommendation: `workspace-write` inside a ghost worktree when isolation is
   on, `read-only` when it isn't.*
4. **Which two demos** get built first for the launch — GitHub Triage and
   Campaign Board are my pick.
5. **Version numbering.** Five feature releases then 2.0 (above), or call the
   engine release 2.0 and the rest 2.x?

---

*Everything in §2 is what the code does today. If any line there is wrong, the
plan built on it is wrong too — check that first.*
