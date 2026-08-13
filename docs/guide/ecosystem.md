# A self-evolving, self-extending agentic AI ecosystem

> Where BagIdea Office started, what it is turning into, and which parts of that
> are already shipping today.

![The office floor at work](../img/world.png)

---

## 1. It began as "AI agents you can actually work with"

The first goal was simple: give yourself **AI agents as real coworkers** — not a
chat box you ask a question and wait, but a team that thinks with you, builds
with you, writes code, researches, and does real work inside real project
folders.

That part works. Every character on the wallpaper is a real Claude Code session
inside a real directory ([Projects](projects.md)), you give an order and the
Director plans and delegates it ([Agents](agents.md)), and everything on screen
is the truth — a walk to Security is a real permission request, a glowing
monitor is a live tool call.

But it has been growing into something wider than "agents that answer".

## 2. What it is becoming

**A self-evolving and self-extending agentic AI ecosystem.**

In plain words: a system that isn't only a collection of agents, but an
environment where agents can **learn, adapt, work together, and grow their own
capabilities** — and where what they gain stays in the office and is reusable by
the next project.

Four properties make that up. All four exist in the product today; the interesting
part is what happens when they run together, for months, on your real work.

## 3. Multi-agent collaboration

One office holds many agents with different roles, personas, skills, tools — and
even different **brains** ([Swappable brains](models.md)): the Director on a
strong model, workers on cheap-but-capable ones.

They talk to each other, coordinate, hand work off, split into ghost clones for
parallel work and merge back with a synthesis, hold [meetings](meetings.md), and
report back up the chain.

So you no longer have *an AI*. You have **a team of AI that works together** —
and you watch the hand-offs happen on your wallpaper instead of guessing.

## 4. Knowledge that compounds

The part I care about more than answers: agents **accumulate knowledge and
experience from the work itself**.

- **`OFFICE.md`** (🗂 → NOTES) — shared knowledge every agent can consult.
- **Per-agent memory** (`workspace/memory/<agent>.md`) — each teammate writes down
  what mattered, on its own, after real work. `bagidea memory <agent>` to read it.
- **Skills** — a workflow you built can be saved as a reusable skill
  ([Workflow Builder](workflows.md)), and the office also learns Hermes-style
  skills from work that actually happened.
- **Archive Search** — the builtin skill that lets any agent recall the office's
  own history instead of starting cold.
- **Your decisions teach them too** — approve or reject a proposal *with your
  reasons*, and that steer shapes what they bring you next time.

One project produces knowledge. The next project can use it. So the office
**doesn't start from zero** every time you open a new project — it grows
alongside the work you do.

Memory is deliberately token-lean: a new session sees a pointer plus the last few
lines, and fetches the rest only when it's relevant. See
[AI features → Memory](ai-features.md#-memory-hermes-style).

## 5. When an agent hits its limit, it can extend the office

This is the part I find most interesting.

An agent working on a task may find that **the capabilities it currently has are
not enough for this job**. It doesn't have to stop there. It can say:

> "We should have a tool — a plugin — for this."

…and that capability can be brought into the system for real.

- Agents **propose** ideas (a project, or a plugin for the office), and you press
  **✅ Approve / ✕ Reject** with a message — or decide from the terminal with
  `bagidea proposal show|approve|reject <id>`.
- The **Plugin Builder** builtin skill means an agent can scaffold, build, deploy
  and install a working plugin **onto the running office itself** — panels, HTTP
  routes, agent commands ([Plugins & skills](plugins.md), [Plugin Hub](plugin-hub.md)).
- Raw new capability can also come from **MCP servers**, granted per agent.

**A real example from our own office:** the team built themselves a small tool to
talk to each other with — one that also cleaned up several errors that kept
recurring — and the Director now summarizes that plugin's data back to the CEO
as a report. Nobody specified that tool up front. The work asked for it.

That is the shift in the idea behind BagIdea Office:

> from **AI that uses tools** → to **AI that can propose new tools and capabilities
> for itself**, and have them become part of the system.

## 6. The loop

```
Goal → Think → Act → Learn → Extend → Collaborate → Repeat
```

You give the goal. Agents think together. Agents act. The system harvests
knowledge from the work. When it meets a limit, it finds a way to add capability.
That capability comes back to the next project. Repeat.

## 7. You are still the CEO

Self-extending does not mean unsupervised. Every widening of what the office can
do passes a human gate:

- **Security Center** — a tool you haven't granted means the agent physically
  walks over and waits for Allow / ✓✓ Forever / Deny.
- **Project trust** — a folder that ships its own `.claude` hooks raises a card
  with the literal commands and parks the work until you answer (`bagidea trust`).
- **Proposals** — nothing becomes a project or a plugin without your approval.
- **AUTO mode** removes the wait for an *opinion*, never the gate on an
  irreversible or outward-facing action ([Keep going (AUTO)](agents.md#-keep-going-without-you-auto-mode)).

The office grows in the direction *you* keep approving.

## 8. Where this goes

Honestly — nobody knows yet what a system like this looks like after another year
or two of growing. That is the most interesting part of building it.

Because the thing being built is not one AI.

It's **a place where AI can work, learn, build and grow together with you**.

> Welcome to BagIdea Office. 🏢🤖
> A self-evolving & self-extending agentic AI ecosystem.

---

## Try it yourself

| You want | Do this |
| --- | --- |
| A team, not a single agent | ⚙ → AGENTS → hire a few roles; give the Director an order and watch the delegation |
| Knowledge that carries over | Let agents work in real [projects](projects.md); read `bagidea memory <agent>` after a week |
| Ideas from the team | ⚙ → AGENTS → ☕ SOCIAL on; proposals arrive in 🗂 → TASKS ([Office Ops](office-ops.md)) |
| The office to build its own tool | Give an agent the **Plugin Builder** skill and ask for the tool you're missing |
| Reusable capability | Build a flow in the [Workflow Builder](workflows.md) → **🧠 Save as Skill** |
| Outside capability | ⚙ → MCP SERVERS, then grant it per agent |

**Related guides:** [Agents & hiring](agents.md) · [Meetings](meetings.md) ·
[Office Ops](office-ops.md) · [Plugins & skills](plugins.md) ·
[Workflow Builder](workflows.md) · [Cost & vision](cost-and-vision.md)
