# Agents & Skills — Build Your Team

![Chat window with an agent](../img/overlay.png)

## The starting team

A fresh office has 2 people: **you (CEO 👑)** and **Shino** — the Director (your right hand),
already fully configured: a playful young guy who's serious about work, focused mainly on **delegating and
managing the team** (he has few hands-on tools, but excels at directing), with the `office-ops` + `plugin-builder`
+ `project-kickoff` skills, a 🌿 nature aura, and a 🎈 playful young voice. From there you hire more of the team
as work demands — Shino will distribute the work himself based on each person's strengths

Everyone is arranged into an automatic org chart (🗂 → ORG): CEO → Director → tier 2 → tier 3

![Automatic org chart](../img/org.png)

## Hire a new employee

⚙ Settings → AGENTS → **＋ Hire a new agent**

| Field | Meaning |
|---|---|
| Name + Title | Shown on their name tag in the world and in chat |
| Avatar (12 faces) + Aura | Their look + the magic ring beneath their feet (pick an element) |
| 🏢 Org tier (tier 1-3) | Position in the org chart (🗂 → ORG) |
| Prompt + Persona v2 | Their identity: expertise / personality / language / working rules |
| Skills / Tools | Special abilities + the tools they're allowed |

Don't feel like writing a persona yourself? Type a short one-line brief and press
**✨ Draft** — the Persona Copilot drafts every field for you (prompt, expertise, personality,
language, working rules) **and picks the skills + tools that fit the role** (only from what
actually exists — managers get fewer tools, hands-on roles get more). You can edit it afterward

> Long agent list? Every tab has a 🔍 search box — type to filter instantly
> (sorted CEO first → Director → the rest in order). An office holds up to **18 people**
> (not counting the CEO) — below the list a counter shows **N / 18 agents**, how many you've hired.
> When it's full, the hire button disables (parallel work can use ghost-forking 👻 instead, unlimited)

## Tools and the Security Center

- **Tools you tick = permanently allowed** — the agent uses them silently, with no prompt card (there's a log in the feed)
  and **without walking away from the desk** (it briefly pauses to confirm it really needs to go ask first)
- Tools you *didn't* grant → the character walks into the Security Center and a request card pops up
  with the exact command it will run: **✓ Allow** (this time) / **✓✓ Always** (remember + add to the
  agent's tools) / **✗ Deny**
- No answer within 50 seconds = auto-deny (the agent re-plans on its own)
- You can act on it from feed mode too — the card has all the buttons built in

## 🤖 Keep going without you (AUTO mode)

The default office is polite: an agent that hits a fork in the road stops, asks your
opinion, and the job sits there until you come back and answer. Turn on **AUTO** and it
doesn't — the team decides for itself and keeps working until the job is actually finished.

**⚙ → TOOLS → "🤖 Keep going (AUTO)"**, or `bagidea auto on`. Off by default.

**How it works:** an agent is a one-shot headless session, so nothing can nudge it
mid-run — the only way to keep work moving is to start the next turn. With AUTO on, every
owner-facing turn ends with a one-line status the office reads:

- **CONTINUE** — there's more to do, so the office **immediately opens the next turn** on the
  same thread. Each round is announced in chat as a `🤖 AUTO` line, so it's never silent.
- **DONE** — finished and verified. Nothing happens; the report is yours to read.
- **BLOCKED** — genuinely stuck, and this still stops the work: a credential or permission it
  can't get for itself, or an action that can't be taken back (push, deploy, deleting things,
  sending something outward, spending money). A block is also pushed to your
  [channels](channels.md), so you find out wherever you are.

**Bounded on purpose:** at most **8 self-driven rounds per job** (`OFFICE_AUTOPILOT_MAX`).
On the 9th the office stops and says so, rather than looping forever on a task it has
misunderstood. If a turn hands work to a teammate, AUTO stays out of the way — that work is
already in flight and the report-back drives what comes next.

**Scheduled work rides it too.** A job booked in [Office Ops](office-ops.md) is run like an
order you typed yourself, so with AUTO on a standing order that ends with work still pending
opens its own next turn instead of waiting for you to come back.

**It does not widen what agents may do.** AUTO removes the wait for an *opinion*; tool
permissions are a separate switch (**🔓 auto-approve**, same tab). Left on its own with
auto-approve off, an agent can still stall on a permission card — turn both on for genuinely
unattended runs, and read the feed afterwards.

## Skills — the ability library

⚙ → SKILLS: every office ships with **15 builtin skill packs** — assign them to anyone in the edit screen:

| Skill | What it gives the agent |
|---|---|
| **deep-research** | multi-source web research + synthesis |
| **web-automation** | drive a real browser (see [web-automation.md](web-automation.md)) |
| **office-control** | run the office itself (hire, schedule, delegate…) |
| **office-ops** | scheduled tasks, calendar, notes, org |
| **plugin-builder** | scaffold, build, deploy & install a plugin |
| **code-review** | review a diff / repo for bugs & quality |
| **doc-writer** | write clear docs, READMEs, guides *(default)* |
| **debug-detective** | root-cause a failure methodically |
| **data-wrangler** | clean, join, reshape data |
| **project-kickoff** | turn an idea into a scaffolded project |
| **diagram-maker** | author diagrams (Mermaid, etc.) |
| **archive-search** | recall from the office's memory *(default)* |
| **build-workflow** | design a Workflow Builder flow |
| **file-media-toolkit** | read/convert PDF·xlsx·docx·pptx, build slides, transcribe video, edit images *(default — see [ai-features.md](ai-features.md))* |
| **schedule-via-office-job** | book timed / recurring work in the office scheduler *(default)* |

The four marked *(default)* are carried by **every** agent automatically. You can also write
your own skills (e.g. "how to deploy the company website") and assign them to any agent —
they'll travel with every new session of that agent

**Auto-learn** (can be toggled on/off): after finishing a real task that used several tools, the system asks itself
whether the task could be distilled into a reusable skill — if so, a new skill is saved, assigned to the person who
did it, and announced 📚 in the office (you'll see gold light burst above their head)

**Self-correction**: the same reflection can now go back and *fix* a skill, not
only write new ones. A skill whose steps are subtly wrong used to stay wrong
forever and get handed to more agents over time — confidently wrong, in writing.

The strongest signal for this is a task that **failed**: whatever the skill told
the agent to do did not work. So a failed run now reflects too, for revision
only — it has no success to generalise from. When a skill is revised the office
announces it with the reason, and the previous version is kept so you can undo it.

Two rules bound it, and they are not negotiable:

- **Built-in skills are never touched.** They are the same in every office; a
  model rewriting one would fork the product's behaviour on one machine.
- **Once you have edited a skill, it is yours.** Your writing is not the model's
  draft, so the office stops revising it from that point on.

## MCP Servers — unlimited new abilities

The quickest route is the **🧰 Tools Hub** (⋯ menu), a browsable catalog of
**43 entries** with an Add button on each, grouped by what they are for — browser,
memory & thinking, **creative & game dev** (Blender, Godot, Unity, Unreal, Roblox
Studio), search, work & data. The catalog is fetched live, so a package that gets
renamed or deprecated is corrected without waiting for an office release.
→ Full guide: [**tools-hub.md**](tools-hub.md).

To add one by hand: ⚙ → TOOLS → MCP SERVERS, enter a name + run command, e.g.

| Name | Command |
|---|---|
| `playwright` | `npx -y @playwright/mcp` (drives a real browser) |
| `blender` | `uvx blender-mcp` (models and renders in a running Blender) |
| `linear` | `https://mcp.linear.app/mcp` |

then tick `mcp:playwright` in the agent's edit screen — that server's entire tool
set becomes available to the agent (through the permission system, like any
normal tool)

A server is either **a program to launch** or **a hosted endpoint**. Paste
either into the same box: an `https://` URL is connected over HTTP, anything
else is run as a command with its arguments. Nothing extra to choose.

> A note on tokens: prefer a server that reads its credential from the
> environment (⚙ → 🔗 CONNECT) over one that wants it inside the command. The
> command string is stored in the office registry; the environment is not.

## 📦 Where agents run

By default every agent runs on the machine the office is on. That is fine while
you are watching, and less fine when a team of them is working overnight on a
repo you care about. ⚙ → TOOLS → **📦 RUN LOCATION** lets you
define somewhere else and point the whole office — or one agent — at it.

| Kind | You give it | What you get |
|---|---|---|
| `local` | nothing | what the office always did |
| `docker` | an image, e.g. `node:22-bookworm` | a throwaway container per run |
| `ssh` | a host + the office path on it | the run happens on another machine |

A container gets exactly two mounts: the office root at `/office` **read-only**,
and the working directory at `/work`. Nothing else on the disk exists as far as
that agent is concerned. API keys are passed by *name*, so the values travel in
Docker's own environment and never appear in a process listing.

Two things are worth knowing before you switch:

- **The image must have the `claude` CLI on its PATH.** The office does not
  install it for you; a bare `node:22` image will start and then fail to find it.
- **A backend that cannot be built is refused, not downgraded.** If the arguments
  for a run cannot be translated into paths that side would see — most often the
  `--settings` file, which is what installs the permission broker — the run fails
  and says so. An agent you put in a box does not quietly come back out of it.

The `ssh` backend needs `officeDir`: the path to an office checkout **on that
machine**. Without one there is no settings file to point at, so it is rejected
when you define it rather than at 3am on somebody's task.

Set it per agent in the agent editor (**📦 RUN LOCATION**); leave that blank and the
agent follows the office default. Ghost clones always run wherever their parent
runs.

### 👻 Ghosts that don't overwrite each other

Ghost clones have always worked in the same directory as each other. Two of them
editing one file is not a race careful prompting wins — it is a race the office
should not have started. ⚙ → TOOLS → **👻 GHOST ISOLATION** gives each ghost its
own `git worktree`: the same repository, checked out separately, on its own
branch.

What changes when it is on:

- Ghosts working on a **registered project that is a git repo** each get a
  private checkout. Two ghosts writing the same file now both succeed.
- Their work comes back as branches — `office/ghost-<id>` — with the branch name
  in the ghost's result, for you to review and merge.
- A ghost that changed nothing leaves nothing: no directory, no branch.
- Your working copy is never touched. Not even to stash.

It is **off by default**, and deliberately so: it moves where a ghost's edits
land. With it off they appear in your working tree as they always have; with it
on they arrive as branches. That is a good trade for parallel code work and a
bad surprise if nobody told you, so the office asks first.

It applies to project work only. The plain workspace lives inside the office's
own repository, and isolating there would put a ghost's notes on an office
branch instead of in the workspace.

## What agents do on their own, without being taught

- **Forking** (sub-agents): work that can run in parallel is split into 2-4 clones running at once (see 👻 below)
- **Read/write the central note board** (`workspace/notes.md`) to leave you messages
- **Know every registered project** — mention one by name in chat and they go work inside the real folder
- **Use the API keys** you stored in 🔗 CONNECT (auto-injected into the env)
- When idle, they watch TV, play football, hang out with the cat, or nap in the dorm 😴

## 👻 Forking (Ghost clones) — working in parallel

Agents in this office **fork as a matter of course** — if a task breaks into independent parts that can run at once,
they won't do them one at a time and waste your time. Instead they split into **2-4 translucent spirit clones**
working in parallel right away. Common cases: gathering news / researching multiple topics or sources, reviewing/fixing
multiple files, comparing several options, scraping multiple sites, testing multiple cases

**You can watch it happen for real** on screen: the translucent clones **float up a glass staircase to the "Ghost Deck"**
(a floating platform in the top-right), take their own desks, with status tags showing what they're doing, then when
they finish they **drift back and merge into their owner**. In the 🧵 thread menu, each clone has its own session
tagged 👻 that you can open and read

> You can let them fork on their own, or **tell them directly**, e.g.
> "Fork off to find news on A, B, C at the same time" — they'll split the subtasks as instructed

Once every clone reports back, the owner **merges everything into a single answer** for you — you get one consolidated
result distilled from all the parallel work, not a scattering of separate answers
(forking doesn't count against the 18-person quota — unlimited)

## 🗣 Team meetings/discussions (Discussions)

Want several agents to **debate a problem among themselves** instead of asking each one separately? Open a discussion

**Open one:** press **⋯** (the More menu in the header) → **🗣 Agent discussion**
to bring up the **AGENT DISCUSSION** window, then fill in 3 things:

| Field | What to enter |
|---|---|
| **TOPIC** | The topic for the team to debate, e.g. "Plan the new onboarding feature" |
| **PARTICIPANTS** | Tick **2-4 people** from the team (the CEO is you, and doesn't join the AI discussion) |
| **ROUNDS** | How many rounds to loop: **1 quick · 2 standard · 3 deep** |

then press **🗣 Start discussion** (you need a topic + at least 2 people selected)

**Watch them meet:** the selected people **walk over and gather in the meeting room**, then **speak one at a time,
round by round** — each builds on the previous person's view, with the conversation posted as whiteboard minutes
you can read live. If an idea that "should really be built" comes up during the talk, an agent may submit a **PROPOSAL**
for you to approve/reject. Multiple discussions can run at once (different teams)

**History:** every meeting is saved as a group session — open it in the 🧵 thread menu
under **"🗣 Meetings"** (read-only), and it's also saved as a Markdown file in
`workspace/meetings/` so other agents can grep it for reuse

## 🔍 Verify delegated work before it reaches you (optional)

By default, when the Director hands a task to a teammate, their result is reported straight
back. Turn on **Verify** and the office adds a **quality gate**: before a delegate's result
returns to the Director, a **strict reviewer pass** double-checks it.

**How it works:**

- The reviewer runs **as the same agent** (so it has the project's tools and working folder)
  but on a **fresh thread** — it inspects the actual files/project with fresh eyes, not just
  the agent's own summary, and judges whether the task is **genuinely and fully done**.
- **APPROVED** → the result ships to the Director unchanged.
- **ISSUES found** → the reviewer hands the work back to the assignee **once** (on their own
  thread) to fix, then the revised result is reported. It's **bounded** — one fix-back loop,
  never recurses, and if the review itself fails it ships the original result rather than block.

**Turn it on:** **⚙ → AGENTS → "Verify work before it reaches the CEO"**. It's **off by
default** because it costs an extra pass — slower and more tokens. Switch it on for work where
correctness matters more than speed (see [Cost & vision](cost-and-vision.md) for the trade-off).
