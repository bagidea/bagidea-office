# 🧑‍💻 Codex — a colleague you can call in, not a brain transplant

*New in v1.4.0 (the Tools Hub entry arrived in v1.1.0).*

OpenAI's [Codex CLI](https://github.com/openai/codex) is a capable coding agent.
The office does not run *on* it — persona, memory, skills, permissions and the
world all stay on the agent that calls it — but any agent, the Director, a
workflow or you can **hand it a self-contained task** and get the result back,
with a diff summary, on the budget line of whoever asked.

Two ways to use it, from cheapest to most integrated.

---

## Level 1 · a tool an agent uses inside its own session

Tools Hub → **Codex** → one click, per-agent grant. That agent's Claude
session gets `codex` as an MCP server and can delegate a sub-task to it from
inside its own turn. Needs Codex installed and logged in. Nothing else to set
up. *(Risk tag: runs a second agent.)*

## Level 2 · the office drives Codex itself

Here the **office** runs `codex exec` — so it can watch it, budget it, isolate
it and record it:

| who | how |
|---|---|
| any agent | `POST /codex/exec { task, project }` from Bash — every agent is told about it when Codex is installed |
| the Director | `DELEGATE: codex @ <project> :: <task>` — the same grammar as for a teammate; the result reports back the same way |
| a workflow | the **🧑‍💻 Codex** node — the step's text is the task, `cfg.project` picks where |
| you | `bagidea codex "add a --json flag to the exporter" --project my-app` |
| a plugin | `ctx.codex.exec(...)` |

What happens: the office spawns
`codex exec --json -C <project dir> -s workspace-write --ephemeral` with the
task on stdin, streams its JSONL into a live run (a 🧑‍💻 mission row at the
caller's desk, steps in ⚙ → 🧑‍💻 CODEX), and returns Codex's final message plus
a diff summary (`files`, `summary`) of what changed in that directory.

**Where it may work:** a registered project (by name, id, or path), or the
shared workspace. Never anywhere else — the office's scope, not the whole disk.

**Ghost isolation applies unchanged.** With 👻 GHOST ISOLATION on, Codex
works in its own git worktree and its edits arrive as a branch to merge, like
a ghost's.

**Cost.** Codex bills your OpenAI plan or key, not the office. The office
records an *estimate* against the calling agent and project (labelled ≈ in
💸 BUDGET) so caps still mean something.

### A second opinion

`POST /codex/review { project, base? | commit? | instructions? }` runs
`codex exec review` on the project's uncommitted changes (or against a
branch, or one commit). Claude does the work, Codex reviews it — or the
reverse. The two disagree more usefully than either agrees with itself.

`bagidea codex review my-app` from the terminal.

## Settings — ⚙ → 🧑‍💻 CODEX

| | |
|---|---|
| enabled | switch it off and every route, node and DELEGATE line refuses politely |
| sandbox | `read-only` · **`workspace-write`** (default — it can edit the project) · `danger-full-access` |
| model | blank = Codex's default |
| local model | `--oss --local-provider ollama` (or LM Studio) — for offices that never send code anywhere |
| max minutes | a run is stopped after this |

**Install:** `npm i -g @openai/codex`, then `codex login` (or set
`OPENAI_API_KEY` in ⚙ → CONNECT). ⚙ → 🧑‍💻 CODEX shows whether the office can
see it.

## The API

```
GET  /codex/status                       installed? version, settings, recent runs
POST /codex/exec     { task, project?, sandbox?, model?, agent? }        → { ok, text, usage, diff, error, steps }
POST /codex/review   { project?, base?, commit?, instructions?, agent? } → the same
POST /codex/settings { enabled, sandbox, model, oss, localProvider, maxMinutes }   human UI only
POST /codex/cancel   { id }                                                        human UI only
```

Events: `codex.run` (state changes), `codex.step` (each command, file change
and message as it happens).

## See also

- [Tools Hub](tools-hub.md) — Level 1
- [Workflow Builder](workflows.md) — the node
- [Budgets](budget.md) — where the estimate lands
