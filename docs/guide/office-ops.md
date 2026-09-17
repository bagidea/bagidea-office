# Office Ops — scheduled tasks, calendar, notes, org chart

Open it from the 🗂 button in the header — it has tabs **PROJECTS · TASKS · CALENDAR · NOTES · ORG · STATS**

![Org chart (ORG)](../img/org.png)

## 📋 TASKS — schedule work ahead / recurring jobs

Pick an agent + type the task (or press 🎤 to speak it) + choose a time:

| Mode | Behavior |
|---|---|
| Run now | Queued to run immediately (shows in the NOW WORKING bar) |
| Scheduled | Runs once when the time comes — can tick "every day" |
| Every N minutes | A recurring job, minimum 5 minutes (e.g. check news/prices every hour) |

- Smart queue: a single agent never runs jobs that collide, plus a system-wide cap on concurrent jobs
  keeps the machine from bogging down
- Each job has its own thread — every run is reviewable in history 🧵
- Pause temporarily / delete from the list

**A scheduled job is a real order.** When it fires, the assignee is told to do the work in that
turn — not to reply with a plan and wait for you. Put the job on the **Director** and it runs like
an order you typed yourself: he hands the pieces out to the team and their results report back to
him. With 🤖 **AUTO** on ([keep-going mode](agents.md)), a job that ends with work still pending
opens its own next turn instead of sitting idle until you return.

> 💬 **You don't have to open this tab.** Just tell the Director in plain language —
> *"brief me every morning at 8"*, *"check the prices again in an hour"*, *"remind the team every 30 minutes"* —
> and the office **books the job in this scheduler for you** (it runs whether or not your chat session is still
> open). List them anytime with `bagidea jobs`. Agents use the office's own scheduler for this, not a
> session-bound timer that would die when the run ends.

## 📅 CALENDAR — calendar + reminders with heart

Add an appointment: name + date/time + how many minutes before to remind

When the reminder fires, **the Director walks over to your desk** on the wallpaper with a 🔔
and writes the reminder in chat — not a dry notification

## 📝 NOTES — the central note board

Notes live in two places at once, always:

- In the UI (add/delete/dictate with the mic)
- In the file `workspace/notes.md` — **agents can read it and append to it themselves**
  (adding a `- message` line to leave you a note — the system syncs both ways)

Use it as the office's shared memory: rules, links, things you want the team to know

## 🏢 ORG — the org chart

The automatic org tree: CEO → Director → tier 2 → tier 3
(set each person's tier in the agent edit screen) — click anyone to open their chat

## ⚙ Settings — the office's rhythm of life (AGENTS tab)

Central settings that control how "alive" the office feels — all under ⚙ → AGENTS:

| Setting | What it does | Default |
|---|---|---|
| 🔊 Sound effects | Ambient sound in the world | On |
| 🗣 Agent voices | Toggle agent speech across the whole office (needs a Gemini key) | On |
| 🪟 Start with Windows | Open the office automatically at boot | Off |
| 💓 DIRECTOR HEARTBEAT | How often the Director reviews the big picture and only flags what you should know | Every 60 min |
| ☕ SOCIAL | Idle agents gather to chat / brainstorm | Every 60 min |
| 💡 PROPOSALS | Minimum gap between "project proposals" sent to you (prevents proposal spam) | At least every 120 min |
| 🎤 PUSH-TO-TALK HOTKEY | The key to give orders by voice | Right Ctrl |

## 💓 Director Heartbeat

DIRECTOR HEARTBEAT: every 15/30/60 minutes the Director quietly checks the calendar + pending work +
note board — and **pings you only when there's something you should know** (an appointment coming up, work stalled,
an important note). Everything normal = no interruption

## ☕ Office socializing + proposal frequency (Social & Proposals)

The office has a "life" of its own — when there's no pending work, agents walk over to gather and chat,
brainstorm, and ideas that crystallize turn into **project proposals** to you

**What triggers it:** the 30-second scheduler only attempts a SOCIAL beat when the
office is **genuinely idle** (no agent running a job + no discussion in progress) and there are
at least 2 staff — if there's work going on, everything stays quiet

- Sometimes it's 2 people bantering, canned (uses zero tokens)
- Sometimes it's a real 3–4 person circle brainstorming plugins/projects — and these circles are
  the ones that usually end with a **proposal** to you

**Two settings control the rhythm** (under ⚙ → **AGENTS** tab):

| Setting | What it does | Default |
|---|---|---|
| ☕ SOCIAL | Minimum gap between each social beat (`socialMin`) | 60 min — set 0 = off |
| 💡 PROPOSALS | Minimum gap per "proposal sent to you" (`proposalMin`), to prevent spam | 120 min — set 0 = no limit |

> Agents can still chat and brainstorm freely at all times — PROPOSALS just dials down the number of
> "proposals that reach you" so you aren't flooded

**Deciding on a proposal:** press ✓ to approve (a real project is created in the playground folder +
the Director staffs a team) or ✗ to reject — you can attach a note explaining your reasoning either way

> 💡 **Tip:** the note you attach when approving/rejecting is **sent back to the team** —
> it's how you tell them what kinds of proposals you do/don't like, so next time they'll
> propose things more to your taste

## ⏹ Cancel a running task

Every task in progress shows in the **🔵 NOW WORKING** bar under the header — click
"▼ See all" to expand the list. Each row has a **⏹** button on the right

Pressing ⏹ = stop that task mid-run immediately (the system kills that task's claude process
and removes it from the bar) — use it when a task hangs too long or you gave the wrong order

> A task running in a **project** window is a different button: open that project and
> press "⏹ Stop agent" (confirm again) to stop the agent and step in yourself
