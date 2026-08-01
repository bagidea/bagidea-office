# Models & Providers — a swappable brain (pick a model per agent)

The office always runs on the **Claude Code CLI** as its engine (tools, file editing, skills,
session loop) — but **the "brain" (the model) behind it can be swapped per agent**, set at
⚙ → AGENTS → edit agent → the **🧠 Brain (model/provider)** field.

> `claude` is just the request sender — point `ANTHROPIC_BASE_URL` at another provider and it talks to that one instead,
> while the tools/loop stay Claude Code (free, local). Only the model changes.

![Pick a provider + model per agent, with a context meter in chat](../img/swappable-brains.png)

## Why it's worth it

- **Cheaper** — models like DeepSeek/GLM/Qwen/MiniMax are several times cheaper than Claude per token
- **No Claude plan required** — if every agent uses another provider, you **never touch Claude credit at all**
  (set another provider + drop in its key, and you're set — Claude is just the default)
- **fail-open** — an agent on Claude, or one with no key set yet, works exactly as before

## How to set it up (2 steps)

**Step 1 — connect a provider (one time)**

⚙ → **CONNECT → 🧠 MODELS / PROVIDERS** → paste the API key of the provider you want → press **🔌 Connect**
until it turns ✅ (the system "tests the key + fetches the model list" automatically) · the key is shown masked
(`sk-proj-••••••2rAA`) so you know which one is in use.

| Grouped by category: Claude · direct · via proxy | Others + add your own custom provider |
|---|---|
| ![Provider list: Claude, GLM, DeepSeek, Qwen, MiniMax, OpenAI, Gemini](../img/brains-connect.png) | ![OpenRouter, NVIDIA build, and the custom provider form](../img/brains-providers.png) |

**Step 2 — pick a brain for the agent**

1. ⚙ → AGENTS → click to edit the agent you want
2. The **🧠 Brain** field → pick a provider (default = Claude)
3. The **Model** field — the system picks a usable default for you, or type/select your own from the dropdown
4. 💾 Save — you **can't save if the provider isn't connected yet** (to prevent mistakes)
5. Takes effect on that agent's next session immediately (a resumed session keeps its existing model until a new thread starts — or until auto-compact)

> 🧠 A ghost (sub-agent) uses the same provider as its parent agent automatically

## ↻ The model list stays current by itself

A model released today should be pickable today — you should never have to wait for an
office release to see it. So the office pulls each provider's **live** model list
(`/models`) instead of trusting a list baked into the code:

- **on start-up**, and **every 12 hours**, for Claude + every connected provider
- **⚙ → CONNECT → 🧠 MODELS / PROVIDERS → `↻ Refresh model list`** — pulls every provider
  right now, and shows what came back (`✓ claude 11 · openai 80 · …`) plus when it last ran
- **the `↻` button next to the Model field** (AGENTS → edit an agent) — re-pulls just the
  provider selected there, so a brand-new model appears in that dropdown immediately

**Claude is included.** Anthropic's `/v1/models` needs your own credentials rather than a
provider key, so the office authenticates with `ANTHROPIC_API_KEY` when you've set one, and
otherwise with the Claude Code CLI's existing login on this machine (read-only; it is sent
nowhere except `api.anthropic.com`). That's what puts a same-day Claude release in the
picker. If neither is available, the built-in list is used and nothing breaks.

The newest model is pre-selected as the default when you pick a provider — you can always
drop back to an older one from the dropdown, and an **agent's saved model is never changed
for you**.

## Supported providers

### 🟢 Direct (Anthropic-compatible) — nothing in between

| Provider | Recommended model | Endpoint (global) | Get a key |
|---|---|---|---|
| **Claude** (default) | `claude-opus-5` · or the `opus`/`sonnet`/`haiku` aliases | — (uses your login/plan) | claude.ai or ANTHROPIC_API_KEY |
| **GLM** (Z.AI) | `glm-5.2[1m]` / `glm-5.2` | `https://api.z.ai/api/anthropic` | z.ai (has a key-based coding plan) |
| **DeepSeek** | `deepseek-v4-pro` / `-flash` | `https://api.deepseek.com/anthropic` | platform.deepseek.com |
| **Qwen** (Alibaba) | `qwen3-coder-plus` | `https://dashscope-intl.aliyuncs.com/apps/anthropic` | Alibaba Model Studio |
| **MiniMax** | `MiniMax-M3` | `https://api.minimax.io/anthropic` | platform.minimax.io |
| **Kimi** (Moonshot) | `kimi-k2.6` | `https://api.moonshot.ai/anthropic` | platform.moonshot.ai |
| **Kimi Code** (coding plan) | `kimi-for-coding` | `https://api.kimi.com/coding` | kimi.com/code (separate `sk-kimi-…` key) |

> **GLM tip:** GLM-5.2's full **1M-token context** is unlocked only by the `glm-5.2[1m]` model id — plain `glm-5.2` serves ~200k. The picker lists `[1m]` first for that reason.
> **Kimi vs Kimi Code:** these are two different products — **Kimi** (Moonshot) uses your general `platform.moonshot.ai` API key; **Kimi Code** is the separate kimi.com/code coding subscription with its own `sk-kimi-…` key and a single `kimi-for-coding` model. Add whichever you pay for.

### 🔵 Via the built-in proxy (OpenAI-compatible) — no LiteLLM/Python to install

The office ships a **built-in, zero-dependency proxy that translates Anthropic ↔ OpenAI** — just add a key:

| Provider | Recommended model | Model name format |
|---|---|---|
| **OpenAI** | `gpt-4o` | bare name |
| **Gemini** (Google) | `gemini-2.5-flash` | bare name |
| **OpenRouter** | `openai/gpt-4o`, `anthropic/claude-…` | **`vendor/model`** |
| **NVIDIA build** | `meta/llama-3.3-70b-instruct` | **`vendor/model`** |
| **Groq** | `llama-3.3-70b-versatile` | bare name · very fast + free tier |
| **Cerebras** | `llama-3.3-70b` | bare name · very fast + free tier |
| **xAI (Grok)** | `grok-3` | bare name |
| **Mistral** | `mistral-large-latest`, `codestral-latest` | bare name |
| **Together AI** | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | **`vendor/model`** |
| **Fireworks AI** | `accounts/fireworks/models/…` | Fireworks path |
| **Custom** | anything | as the provider requires |

### 💻 Local — on your machine, no key needed

Run models locally through an OpenAI-compatible server — **no API key to paste**, just start the server and press Connect
(the office sends to `localhost`) · free · offline · private.

| Provider | Endpoint (default) | Models |
|---|---|---|
| **Ollama** | `http://127.0.0.1:11434/v1` | `llama3.1`, `qwen2.5-coder`, `deepseek-r1` … (whatever you've `ollama pull`ed) |
| **LM Studio** | `http://127.0.0.1:1234/v1` | the models loaded in LM Studio |

> Non-default port → use a **Custom provider** and set the Base URL yourself (OpenAI-compatible)

> The daemon takes a request from claude (in Anthropic format) → translates it to OpenAI → sends it on with the key from CONNECT
> (the real key never enters the sandbox) · no key → it falls back to Claude (never hangs)

### 🛠 Custom provider — add your own

CONNECT has a **Custom** form — enter a **name + Base URL + API key**, and choose whether it speaks
**Anthropic-compatible** or **OpenAI-compatible** → anyone who already has their own **LiteLLM gateway**
can just point the Base URL at it (avoid LiteLLM versions 1.82.7/1.82.8, which once carried malware).

## 🆓 Free to try — but with limits

| Provider | Free? | Limits to know |
|---|---|---|
| **NVIDIA build** | ✅ free to test | **low rate limit (~40 req/min)** — agent tasks with heavy context hit 429 quickly; best for light tasks/playing around |
| **OpenRouter** | ✅ has `:free` models | **daily cap + possible queueing** · must use `vendor/model` ids · for heavy work, add credit |
| **Gemini** | ✅ generous quota | great for a general assistant — flash has a fairly large free allowance |
| **OpenAI** | ❌ pay-as-you-go | **Tier 1 = 30k tokens/min**, too small for heavy agent work (but auto-compact helps, see below) |

## ♻️ Auto-Compact + Auto-New-Thread — works with *every model*

> No matter how long the conversation, it won't clog, won't hang, no need to open a new thread yourself

Normally, a long conversation fills the context and breaks — Claude Code handles this for Claude only, but the office makes it
automatic for **every model**:

- 🧠 **Proactive** — before every continuation, it checks the conversation size against that model's context window; if it's nearly full → **summarize with Claude → open a new thread → carry on** before anything breaks
- 🛟 **Reactive** — if the model bails due to rate-limit / unexpected full context → it recovers the same way (a temporary rate-limit retries itself, no error bounce)
- 🪄 **Continuity never lost** — it summarizes with **Claude** (the big brain) and feeds it into the new thread · the screen **takes you along to the new thread** so you're never confused about where the agent went

You can tune the context window per provider in the registry at `providerConfig.<p>.contextWindow`
(and the budget used to decide on compaction at `providerConfig.<p>.contextBudget`)

## 🛟 Fallback brain — survive a provider outage (opt-in)

Providers go down. GLM/Z.AI in particular throws `529 · overloaded` under load, and
while it's down any agent on that brain just sits there erroring. Set an **office-wide
fallback brain** and the office will re-run that task on the fallback instead:

- Go to **Settings → CONNECT → 🛟 fallback brain** and pick any **connected** provider (plus
  an optional model). That's it — it applies to every agent.
- It's **off by default**. With no fallback set, nothing changes: an overloaded brain
  just retries hard, exactly as before.
- It fires **only** when the overload is *sustained* (repeated `5xx`), never on a one-off
  blip, and **only** onto a provider that's actually connected — so a task can't be
  rerouted into a second dead brain. It never loops back onto the down brain or fails
  over twice for the same task.
- Only server overload/unavailability (`5xx`) triggers it. Bad auth (`401/403`) still
  fast-fails with a clear message; rate/usage limits (`429`) still pause-and-resume.

The failed-over run keeps the original task and still reports back to whoever delegated
it, with a one-line note that it switched brains and why.

## 📊 Monitoring

- 🏷 **Every message shows the model used** + a bar for **what % of context is used** (e.g. `gpt-4o · 40k/128k`)
- 🧠 **The BRAINS page** (🛡 sidebar) — connect status of every provider + every agent's context, live
- 💰 **The STATS page** (🗂 Office Ops) — costs broken down by provider (estimated from real tokens) + daily totals

![Chat tagged with the model + a context meter in the thread bar](../img/brains-chat.png)

> Costs for other providers are **estimates** (these providers don't send real bills like Claude does) —
> calculated from tokens × approximate public pricing; adjust the rates in `BRAIN_PRICES` in `daemon/server.js`

## Team-building advice (tiered)

Tool-use accuracy matters for "money wasted on failed/redone work" — choose by the job:

| Role | Recommended | Why |
|---|---|---|
| **Director / main** (planning, delegating) | **Claude** | high leverage — a mistake affects the whole team, so keep the good brain here |
| **Project builders** | **DeepSeek V4 Pro** / GLM | close to Claude, ~10x cheaper, direct connection |
| **Assistant / social agents** | Qwen / MiniMax / Gemini | light work, accuracy not critical, cheapest |

> Cheap models suit assistant/chat work (someone's watching, can fix it on the spot) more than long autonomous loops

## Model identity

A model swapped in reads Claude Code's system prompt and may claim to be Claude —
the office injects a note about the real backend every turn, so if you ask **"which model are you using"** it answers truthfully
(e.g. `gpt-4o`), matching the tag shown under the message.

## Notes on credit / policy

- Choosing another provider = **you pay that provider, no Claude credit touched** — `claude` just forwards the request to the configured endpoint
- Choosing a model/provider **isn't against policy** — it's a standard feature
- Tokens are stored in `registry.json` locally only (the same place as other API keys); they're never sent to Anthropic

> **China endpoints** differ from the global ones — if you're in mainland China you can set the baseUrl yourself (registry `providerConfig.<p>.baseUrl`):
> Qwen `https://dashscope.aliyuncs.com/apps/anthropic` · MiniMax `https://api.minimaxi.com/anthropic` (note the extra "i")
