# 🔔 Notifications and 📥 Approvals — the inbox

*New in v1.1.0.*

Two things used to be true of this office. When it needed you, it asked in one
of five different places. And when it wanted to tell you something, it told a
pixel character on a wallpaper that was probably behind your browser.

Both are gone. Everything that waits on a person now lands in **one queue**,
and everything the office wants you to know goes through **rules you set** —
to the sidebar, to a pop-up, to your phone, or with a sound, and only when you
want it to.

Open the sidebar (**🛡** in the chat window's title bar) to see both. While anything is
waiting, the **tray icon carries a red dot** and its tooltip says how many — visible
with every window closed.

---

## 📥 APPROVALS — one queue for everything that waits on you

| Kind | What put it there |
|---|---|
| **Tool permission** | an agent wants a tool you didn't grant (the Security Center card — still there, and now also here and on your phone) |
| **Project trust** | a registered folder ships its own `.claude` hooks |
| **Proposal** | the team pitched a project |
| **Blocked** | an agent in 🤖 AUTO mode hit `STATUS: BLOCKED` and needs a decision |
| **Job** | a job was created switched off and is waiting to be run |
| **Workflow** | a workflow's approval node *(v1.3)* |
| **Plugin** | a plugin asked you something through the API |

Each item has a title, the detail, a note box, and the buttons that make sense
for it — *Allow / Always / Deny* for a tool, *Continue / Stop* for a blocked
agent, *Run it / Delete* for a job. Decide it here, in the chat card, from the
terminal, or from your phone; the record shows who decided, when, and what note
they left.

**Answering a blocked agent resumes the work.** Type what you'd have said if you
were there — *"use the staging key"* — press **Continue**, and the agent picks
up from where it stopped, with your answer. Before v1.1 that block was a line on
Telegram and a job sitting idle until you got back to the desk.

### From your phone

Every approval is pushed to your connected channels (rules permitting — see
below). On **Telegram** the message carries buttons; one tap answers it. On
every channel you can also just type a reply:

```
1 yes                     answer item 1 with its first option
2 no too risky            answer item 2 with its last option, with a note
2 continue use staging    a specific option, with a note
/approve 1  ·  /deny 2    the same, as commands
yes                       allowed only when exactly ONE thing is pending
/inbox                    list what's waiting, numbered
```

A reply that matches a pending item is answered on the spot and never reaches
the Director as an order. Anything else is a normal message, as before.

### From the terminal

```
bagidea inbox                     what's waiting, numbered · what's unread
bagidea approve 1 [note]          the item's first option
bagidea deny 2 [note]             its last option
bagidea answer 2 continue [note]  a specific option
```

### For plugins and scripts

```
POST /approvals            { title, detail?, agent?, options?: [{value,label}], expiresMs? }
GET  /approvals?pending=1  the queue (each item carries its short number `n`)
POST /approvals/respond    { id, decision, note? }   — human UI only (x-bagidea-ui)
GET  /inbox                pending approvals + unread notifications, in one call
```

`POST /approvals` returns the item; the decision arrives as an
`approval.decided` event on the office stream. This is the primitive the author
of issues #48 and #50 was building by hand out of disabled jobs.

---

## 🔔 NOTIFICATIONS — you'll know

Every notification lands in the sidebar's 🔔 list (with an unread count on the
badge) — that part is always on. The **rules** decide what else happens:

| Where | What it is |
|---|---|
| **toast** | a pop-up in the corner of the chat window — and, since v1.2, a small always-on-top window in the corner of your **screen**, drawn by the office itself, so it shows even when the chat window is hidden or covered; click either to jump to the item |
| **channel** | pushed to Telegram / Discord / LINE / Slack / WhatsApp / Messenger |
| **sound** | one short cue (respects the office sound toggle) |

…and **when**:

| When | Meaning |
|---|---|
| **always** | every time |
| **quiet** | not during your quiet hours |
| **away** | only when you've been away from the keyboard for five minutes — a toast is pointless while you're typing in the chat and essential when you're in another app |

Set them per *kind* in **⚙ → 🔔 NOTIFY**:

| Kind | Fires when | Default |
|---|---|---|
| 📥 approval | something needs your decision | everywhere, always |
| ⛔ blocked | an AUTO agent is stuck | everywhere, always |
| ⏰ reminder | a calendar reminder | everywhere, quiet hours respected |
| 💸 budget | a spend warning or a stop — see [budgets](budget.md) | everywhere, always |
| ✅ done | delegated work reported back | centre + channel |
| 🔀 workflow | a workflow finished or failed *(v1.3)* | centre + toast + channel |
| 💡 proposal | the team pitched something | centre + channel |
| 💬 mention | someone named you | centre + toast + sound |
| ℹ️ system | office housekeeping | centre only |

**🌙 QUIET HOURS** — a start and end time (they may wrap midnight, `22:00 →
08:00`). During quiet hours, toast, sound and channel are held for any kind set
to *quiet*; the 🔔 list still receives everything. Kinds set to *always* — an
approval, a blocked agent — ignore quiet hours, because those are the ones worth
waking up for.

The old **📡 milestones → channels** switch still works: turning it off mutes
the channel leg for everything.

**🔔 Test** in the same tab sends one notification through your rules so you can
see where it lands.

### From the terminal and from plugins

```
bagidea notify            unread notifications
bagidea notify test       send one through your rules

POST /notify/send         { kind, title, body?, link?, agent? }  → the item + where it was routed
GET  /notify?unread=1     the list, the unread count, the rules, the quiet hours
POST /notify/read         { ids: [...] | "all" }
POST /notify/rules        { rules: { kind: { centre, toast, channel, sound, when } }, quiet: { enabled, start, end } }
```

---

## What did not change

- The Security Center card, the chat card, and **✓✓ Forever** work exactly as
  before. They also close the inbox item, so your phone never shows a card the
  office already settled.
- `POST /perm/respond`, `POST /project/trust`, `POST /proposals/respond` and
  `POST /jobs/update` all still work; they now go through the queue on the way.
- Nothing here changes what an agent may *do*. 🤖 AUTO and 🔓 auto-approve are
  the switches for that, same as before.

## See also

- [Agents & skills](agents.md) — the Security Center and what granting a tool means
- [Channels](channels.md) — connecting Telegram and friends
- [Office Ops](office-ops.md) — jobs, calendar, proposals
- [CLI](cli.md)
