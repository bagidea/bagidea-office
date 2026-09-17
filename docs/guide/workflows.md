# 🔀 Workflow Builder — plan it, run it, let it run itself

*Rewritten for v1.3.0 — the release where a workflow stopped being a drawing.*

Open it from **⋯ → 🔀 Workflow Builder**.

Until v1.3, pressing **Run** serialized your diagram to text and handed the
whole thing to the Director as one big order. Nothing on the canvas ran on its
own, nothing could wait for you, a restart forgot everything, and there was no
record of what happened. Now the office **executes the graph**: every node runs
on its own, in parallel where the arrows allow, with a persisted record per run
that survives a restart — and a workflow can start **without you**.

---

## 1 · Draw it

Right-click the canvas (or press **＋ Node**) and pick a type. Type what the
step should do in plain language. Drag from a node's bottom port to another
node's top port to connect them.

| Node | What it does | Put in the box |
|---|---|---|
| ⚡ **Trigger** | where a run starts; its output is the trigger's payload | anything — triggers are set in the ⚡ panel |
| ⚙ **Action** | a real agent turn; the reply is the step's output | the task · start with `@marcus:` to pick who (default: the Director, with DELEGATE power) |
| ⬇ **Fetch** | an HTTP request | the URL · output is `{ status, body }` (JSON parsed when it is JSON) |
| ◆ **Decision** | pick a branch | an expression like `{{n2.output.status}} == 200`, or a question the Director answers YES/NO |
| ✋ **Approval** | stop and wait for you | what you're approving — it lands in 📥 APPROVALS and on your phone |
| 🔔 **Notify** | tell you, through your rules | the message |
| ⏳ **Delay** | wait | `10m` · `2h 30m` · `30s` · `until 09:00` |
| 📤 **Output** | record, write or send the result | plain text · `file:C:/path/out.md` · `channel: <text>` |
| 🧑‍💻 **Codex** | hand a coding task to [Codex](codex.md) | the task · `cfg.project` picks the project (default: the workspace) · output `{ text, diff }` |
| 📝 **Note** | a comment on the canvas | not run |

Plugins can add node types of their own (they appear in the palette as soon
as the plugin loads) and trigger kinds (in the ⚡ panel as `🧩 …`) — see
[plugins → hooks](plugins.md#hooks). Every run is also a 🔀 card on the
[task board](tasks.md).

**Branches and joins.** A node with several outgoing arrows fans out and those
branches run **at the same time**. A node with several incoming arrows **waits
for all of them**. A decision opens only the branch it chose: label the arrows
`yes` / `no` (right-click an arrow), or leave them unlabelled — the first is
*yes*, the second *no*. The branch not taken is *skipped*, which is not a
failure.

**Data.** Any box may use `{{…}}`:

| | |
|---|---|
| `{{trigger.data.issue.title}}` | a field from whatever started the run |
| `{{n3.output}}` | another node's output, by its id |
| `{{prev}}` | every upstream output, joined — the usual choice for an action |

Small and explicit, on purpose: no scripting language in a text box.

## 2 · Run it, and watch it

**▶️ Run now** starts a run and the canvas lights up as it goes — blue running,
green done, red failed, amber waiting for you or for a delay, faded skipped —
with each step's output in the panel on the right. A run's record is kept
(the **▶ RUNS** list, newest first; click one to see it again).

Every agent step is a real turn: the same permission broker, the same
[budget](budget.md), the same Security Center. A step the office refuses (a
cap reached, a tool denied) fails the run and says why.

**Restart-safe.** A delay that was waiting re-arms; an approval that was
waiting is still in your inbox; an agent step that was mid-flight when the
office stopped is marked failed rather than pretended.

**Analyze** and **🪄 Draft with Director** are unchanged: the Director reads
your plan and says what skills, tools, permissions and people it needs — or
drafts the whole thing from a sentence.

## 3 · Let it start itself — ⚡ TRIGGERS

Save the workflow, then add triggers in the ⚡ panel. A trigger is a source of
runs:

| Kind | Fires when | Payload |
|---|---|---|
| ⏰ **Schedule** | every N minutes, or daily at HH:MM | `{ event: "schedule" }` |
| 🌐 **Webhook** | anything POSTs to `http://127.0.0.1:8787/hook/<token>` | the JSON body; the `X-GitHub-Event` header becomes `event` |
| 📡 **Event** | an office event of that type — `task.completed`, `work.created` (a new card), `proposal.created`, a plugin's own | the event |
| 📁 **File** | a file matching the pattern appears or changes in a folder | `{ path, name, change, size }` |
| 💬 **Channel** | a message on Telegram / Discord / LINE / … starts with the keyword | `{ channel, from, text, rest }` |

Each row can be paused (⏸), fired by hand (🔥 — the fastest way to test), or
removed.

**Webhooks and the internet.** The office listens on `127.0.0.1` only, on
purpose. To let GitHub, Stripe, Zapier or a script on another machine reach a
hook, run a tunnel — the same way the LINE and Meta channels are set up:

```
cloudflared tunnel --url http://127.0.0.1:8787     # or: ngrok http 8787
```

then use `https://<your-tunnel>/hook/<token>` as the webhook URL. Set a
**secret** on the trigger and the office verifies an HMAC-SHA256 signature on
every call — GitHub's `X-Hub-Signature-256` works as-is; anything else can send
`X-Signature-256`.

**No loops.** The engine's own events never trigger workflows, and a keyword
message that starts one is consumed — it never reaches the Director as an
order.

## 4 · Two workflows worth building first

**GitHub triage** — trigger: webhook (secret set, repo → Settings → Webhooks,
event *Issues*). Decision: `{{trigger.data.action}} == opened`. Action:
`@marcus: read the issue {{trigger.data.issue.title}} — {{trigger.data.issue.body}}. Label it bug / question / feature and draft a reply.`
Approval: *post this reply?* Action: `@marcus: post the reply with gh.`

**Client folder** — trigger: file (`D:/clients/acme`, `*.pdf`). Action:
`@priya: summarize {{trigger.data.path}} in one page and save it beside the original.`
Notify: `Summary ready for {{trigger.data.name}}`.

## 5 · Save as a skill · the legacy path

**🧠 Save as Skill** still compiles the workflow into a skill any agent can be
given, for "run *X*" in chat. And `POST /workflows/run` with `legacy: true`
still does what v1.2 did — the whole drawing as one Director order — if you
relied on that.

## For scripts and plugins

```
POST /workflows/run       { id }  or  { name, nodes, edges }  (+ data)  → { run }
GET  /workflows/run?id=   the full run record
GET  /workflows/runs?id=<workflowId>&limit=
POST /workflows/cancel    { id }                       human UI only
GET  /triggers            · POST /triggers { kind, workflowId, cfg } · POST /triggers/delete · POST /triggers/fire { id, data }
POST /hook/<token>        the inbound webhook (no UI header — that is the point)
```

Events on the office stream: `workflow.run`, `workflow.node`.

## See also

- [The inbox](inbox.md) — where approval nodes wait and notify nodes land
- [Budgets](budget.md) — every agent step is gated
- [Channels](channels.md) — the tunnel, and keyword triggers
