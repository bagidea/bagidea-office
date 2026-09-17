# 📦 The official plugin library

*New in v1.5.0.*

Eight plugins ship **with** the office, built on the v1.4 hooks — each one a
real use of the machine the last releases built. A fresh install still starts
empty (that is deliberate); these wait one click away in 🧩 → **📦 OFFICIAL
LIBRARY**, or `bagidea plugin install <id>`.

| plugin | for | what it does |
|---|---|---|
| 📣 **campaign-board** | marketing, social, founders | a marketing calendar the office runs: posts as cards with a channel and a date, copy drafted by an agent in your brand voice, an **approval** before anything is published, publishing through the tools your agents have (X, Bluesky, LinkedIn, a blog, a newsletter) |
| 📰 **content-pipeline** | newsletters, social | RSS or a URL in → article fetched → summarized → draft in your voice → you approve → your channel. Adds an **rss trigger kind** and a **fetch-article node** to the Workflow Builder |
| 🐙 **github-triage** | maintainers, dev shops | issues in (webhook) → labelled, answered, assigned — every reply waits for your approval; posts with the `gh` CLI |
| 📬 **inbox-agent** | support, sales | email in (on a schedule) → classified → replies drafted → you approve → sent, through whatever mail tool the agent has (Gmail from the Tools Hub) |
| 📊 **weekly-report** | management | every Monday morning: cards done, spend, workflow runs, upcoming events, gathered from the office's own records, written by the Director, delivered to your channel and kept as a file |
| 🗂 **client-folders** | agencies, freelancers | a folder per client; whatever lands in it, the agent you chose handles it and tells you; every file is a card on the board |
| 🧪 **skill-regression** | every office that lets skills self-correct | test cases per skill — a task and what the answer must (or must not) match. When the office tries to correct one of its own skills, every case runs against the new text first; a correction that breaks a case is **refused**, and you are told |
| 🧠 **decision-log** | every team | "we decided X because Y" with supersede chains — and a **memory provider** that puts the active decisions in front of the agents you opt in, on every turn |

Each has a panel (🧩 → click it), agent commands (`POST /plugin/<id>/cmd`),
and where it makes sense a ready-made workflow you can open and edit in the
Workflow Builder. Removing one is the normal 🗑; its data stays in
`plugins/<id>/data` until you delete the folder.

## Two worth starting with

**GitHub Triage.** Panel → *owner/repo* + a secret → **Wire it up**. It
installs the workflow, creates the webhook trigger, and shows the URL. Run a
tunnel (`cloudflared tunnel --url http://127.0.0.1:8787`), paste tunnel + path
into the repository's webhook settings (event: *Issues*). From then on, a new
issue becomes a labelled, answered card — after you approve the reply in
📥 APPROVALS or from your phone. Try one by hand first: *owner/repo#123* →
**Triage one now**.

**Campaign Board.** Set the brand voice once. Plan a post: date, channel,
angle. **Draft** — an agent writes it. **Ask approval** — it reaches your
phone. **Publish** — the agent posts it with the tool it has for that channel
(grant Bluesky, or any other, in the Tools Hub). Every post is a card on the
office board, due on its date, so the whole team sees the calendar.

## From the terminal

```
bagidea plugin library                # what ships, what is installed
bagidea plugin install decision-log   # one click, by id
bagidea plugin remove decision-log
```

## Writing your own

The library plugins are ordinary plugins — read any of them as a worked
example of the hooks: `daemon/plugin-library/<id>/index.js`. The guide is
[plugins → hooks](plugins.md#hooks). To share yours, the
[Plugin Hub](plugin-hub.md) is one PR away.
