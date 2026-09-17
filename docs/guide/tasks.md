# 📋 Tasks and 📅 Calendar — the office's board, for real

*New in v1.4.0.*

Until now the office had three separate ideas of "work to do": scheduled jobs,
a meeting's action items, and whatever the Director said in prose when it
handed something out. None of them showed up in one place, none had a due
date that could remind you, and none knew about each other.

Now there is **one board**, and everything lands on it.

---

## 1 · The board — 🗂 → 📋 TASKS

Four columns: **TODO · DOING · WAITING · DONE**. A card is a work item:

| field | what it is |
|---|---|
| title, detail | what to do |
| owner | an agent, or *you* |
| project | the registered project it belongs to |
| due | when — reminders go through your 🔔 rules an hour before, and again when it is overdue |
| priority | P1 urgent … P4 someday; orders every column and every agent's list |
| depends on | cards that must finish first — the card waits in WAITING and moves to TODO **by itself** when the last blocker closes, and the owner is told |
| repeat | every day / week / month — a finished card comes back, due the next period |

Type a title in the box at the top and press Enter to add one. Drag a card
between columns. Click a card to edit everything else.

**Cards that appear on their own:**

| card | when |
|---|---|
| 🕊 delegation | the Director hands work to a teammate — owned by the assignee, DOING until they finish (WAITING if the task failed and needs a person) |
| 🔁 job | a scheduled job fires — one card per job, back to DOING on every run |
| 🗣 action item | a meeting ends with follow-ups — owned by whoever the meeting assigned, with its due date |
| 🔀 workflow | a workflow run starts — DONE when it finishes, WAITING when it failed |
| 🧑‍💻 codex | the Director called Codex in |

**Agents move their own cards.** Every agent is told about the board and its
API at the start of every turn; a good one marks a card *doing* when it starts
and *done* when it finishes, and creates cards for work it discovers. You'll
see the board change while the office works.

## 2 · The calendar — 🗂 → 📅 CALENDAR

Events gained what a real calendar has:

- **Repeat** — daily, weekly, weekdays, monthly (the RRULE subset a real
  calendar exports). A repeating event reminds you **every time**, not once.
- **All-day** events.
- **Reminders through your rules** — the Director still walks over and tells
  you in chat, and the same reminder goes wherever your 🔔 NOTIFY rules send it
  (a toast, your phone in quiet hours off, a sound).
- **📤 Export .ics** — subscribe to `http://127.0.0.1:8787/calendar/ics` from
  your real calendar, or import the file once.
- **📥 Import .ics** — events from Google Calendar, Outlook, Apple Calendar
  or anything else; the same event imported twice updates instead of
  duplicating.
- **Agents can book** — an agent that promises a follow-up can put it on the
  calendar, with itself as the person to remind.

## 3 · From the terminal

```
bagidea tasks                      # the whole board
bagidea tasks doing                # one column
bagidea task add "Write the launch post" --owner priya --due 2026-09-20 --p 2
bagidea task done 3                # by number from the list, or by id
bagidea task move 3 waiting
bagidea cal                        # the next 30 days
bagidea cal add "Team sync" 2026-09-14T10:00 --every week --remind 15
bagidea cal ics > office.ics
```

## 4 · The API (what agents and plugins use)

```
GET  /tasks?owner=&project=&status=&open=1     list
GET  /tasks/board                               { board: {todo,doing,waiting,done}, summary, agents }
POST /tasks          { title, owner, project, due, priority, dependsOn, recurrence, detail, tags }
POST /tasks/update   { id, …fields }
POST /tasks/move     { id, status }
POST /tasks/delete   { id }                     human UI only — an agent finishes a card, it never removes one

GET  /calendar?from=&to=                        { cal: [events], upcoming: [occurrences] }
POST /calendar       { title, at, end, allDay, remindMin, recurrence:{freq,interval,byDay,count,until}, link, agent, notes }
                     { edit: id, … }  ·  { remove: id }
GET  /calendar/ics                              the calendar as text/calendar
POST /calendar/import                           an .ics body (or { ics }) · human UI only
```

Events on the office stream: `work.created`, `work.updated`, `work.done`,
`work.removed`, `calendar.changed` — a workflow's **event** trigger can start
on any of them ("when a P1 card is created, …").

Plugins get the same through `ctx.tasks` and `ctx.calendar` — see
[plugins](plugins.md#hooks).

## See also

- [The inbox](inbox.md) — where due-date reminders land
- [Workflow Builder](workflows.md) — runs become cards; `work.*` events start workflows
- [Meetings](meetings.md) — action items become cards
