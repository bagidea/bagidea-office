# 💸 Budgets — money, not tokens

*New in v1.2.0.*

Until now the only limit on what the office could spend was a per-request
*context* budget. Nothing stopped a thread that ran to 9.5M tokens
([#46](https://github.com/bagidea/bagidea-office/issues/46)) except a person
reading a meter — and an office that runs while you're away has no person.

This is the brake. Set it in **⚙ → 💸 BUDGET** or with `bagidea budget`.

---

## Three caps

| Scope | Unit | Setting |
|---|---|---|
| **The office** | USD per calendar day | 💸 DAILY BUDGET |
| **An agent** | USD per calendar day | 👤 PER-AGENT CAPS |
| **A project** | USD, lifetime | 📁 PER-PROJECT CAPS |

`0` means no cap. Caps are independent: an agent can be capped while the
office isn't, and a project cap holds across days.

## What happens at the cap

- **At 80 %** — one warning per day per scope, through your
  [notification rules](inbox.md) (kind: 💸 budget — everywhere, always, by
  default). Not repeated on every turn.
- **At 100 % — the office stops taking new turns** for that scope. A turn
  that would start is refused with a message in chat saying which cap, how much,
  and what to do. **Running turns are never cut off**; they finish. A daily cap
  releases at midnight; a project cap when you raise it.

The gate sits at the very start of a turn, before a session is touched or an
event is broadcast, so nothing half-starts.

## What counts, and how honest the number is

| Source | Counted as |
|---|---|
| Claude (any Claude model) | the **real bill** — Claude Code reports `total_cost_usd` per turn |
| Swapped-in brains (GLM, DeepSeek, Qwen, OpenAI, Gemini, …) | an **estimate** from token counts × a public per-million price |
| Voice, image, video tools | an **estimate** per use |

Where any estimate is included the total is labelled **≈** — in the panel, in
STATS, in `bagidea budget`, and in every warning. An unknown price is never
silently treated as zero.

Costs are attributed to the agent that ran the turn (a ghost clone counts
toward its parent) and to the project the turn ran in, which is what makes the
per-agent and per-project caps possible.

## 🌅 Morning digest

Switch it on in the same tab and pick a time. Once a morning you get one
notification:

```
🌅 Yesterday (2026-09-11): $4.20 ≈ · 31 turns · 29 done · 2 failed
Top spend: marcus $3.00 · priya $1.20
📥 2 waiting for you
```

It goes through the rules as kind ℹ️ system, so by default it lands in the
sidebar's 🔔 list; route it to your phone in **⚙ → 🔔 NOTIFY** if you want it
there. **Send now** in the tab (or `bagidea budget digest`) shows what it would
say today.

## From the terminal

```
bagidea budget                          today's spend vs caps · warnings · stopped
bagidea budget set office 5             cap the office at $5/day
bagidea budget set agent marcus 2       cap one agent at $2/day
bagidea budget set project shop 40      cap a project at $40, lifetime
bagidea budget off                      remove the office cap
bagidea budget digest [on|off|07:30]    the morning digest
bagidea budget digest                   send it now
```

## For plugins and scripts

```
GET  /budget           today's picture: office / agents / projects, caps, spend, ≈ flag
POST /budget           { office:{daily}, agents:{id:{daily}}, projects:{id:{total}}, digest:{enabled,time} }  — human UI only
POST /budget/digest    send the digest now → { text }
GET  /stats            now carries `budget` too
```

A refused turn is announced as a `budget.refused` event on the office stream.

## See also

- [The inbox](inbox.md) — where the warnings land and how to route them
- [Cost & vision](cost-and-vision.md) — spending less per token in the first place
- [Models & providers](models.md) — the prices behind the estimates
