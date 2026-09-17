# Cost, cheap setups & vision

How BagIdea Office spends tokens, how to run it **cheaply** (even with no Claude at all),
and how the agents **see images** — so you can keep them smart without a scary bill.

> TL;DR — each agent does its real work on **its own brain**, so route worker agents to a
> cheap-but-capable model (GLM / DeepSeek / Qwen / Gemini Flash) and keep an expensive one
> only where it matters. Add a **free Gemini key** as the office's "eyes" and any brain can
> read images. The autonomous office (meetings, social) is cheap; the real spend is agents
> **doing parallel work** — so the brain you assign to your workers is the biggest lever.

---

## 1. How "brains" actually work

Every agent can be assigned a **brain** (a model provider) in ⚙ → the agent editor, or
office-wide via the **default provider**. Supported: Claude (Anthropic), GLM (Z.AI),
DeepSeek, Qwen, MiniMax, Kimi/Moonshot, OpenAI, Gemini, OpenRouter, NVIDIA, Groq, Cerebras,
xAI, Mistral, Together, Fireworks, and **local** via Ollama / LM Studio.

**The key fact:** when an agent does *real work in a project* (a delegated task, a
sub-agent split, a verification pass, a synthesis turn) it runs on **that agent's own
brain** — not always Claude. If an agent's brain is DeepSeek, its project work runs on
DeepSeek. The Director ("main") is swappable too, and sub-agent clones inherit their
parent's brain. Under the hood the office runs the Claude Code CLI but points it at the
chosen backend (directly for Anthropic-format providers like GLM/DeepSeek/Qwen, or through
the office's built-in OpenAI-compatible proxy for the rest), so you get Claude Code's whole
agent loop on whatever model you pick.

See **[Swappable brains](models.md)** for how to connect a provider and assign it.

---

## 2. Where the tokens go

Two very different sources:

- **The idle/autonomous office is cheap.** Ambient mood lines and most "break-room" banter
  are canned strings (zero tokens). Real autonomous meetings happen only every ~1–2 hours
  and are small. This is not where the money goes.
- **Real work is where it adds up.** One CEO order can fan out to the Director **plus**
  several delegates, each a *separate* `claude` session running in its own project folder,
  sometimes splitting further into parallel sub-agents. Three or four agents working at
  once = three or four full model sessions at once. **That** is the bill.

So the single biggest cost lever is: **what brain are your busy/worker agents on?**

### Cut the spend

1. **Route workers to a cheap-but-capable brain.** Keep an expensive model (Claude, or a
   top GLM/DeepSeek tier) on the **Director** or your one "senior" agent, and put the
   hands-on workers on something cheaper. Strong, inexpensive coders: **DeepSeek**,
   **Qwen-Coder**, **GLM**. Fast and often free: **Groq**, **Gemini Flash**, **Cerebras**,
   **NVIDIA** (free tier), or **local** models via Ollama / LM Studio.
2. **Tune the autonomous rhythms** in ⚙ → AGENTS / SKILLS (all optional, all reversible):
   - **Social** — how often agents meet/chat on their own (off / 30 / 60 / 120 min). Set it
     lower or **off** if you don't want idle chatter at all.
   - **Director heartbeat** — periodic check-in run (off / 15 / 30 / 60). **Off** is fine.
   - **Auto-learn skills** — agents distill reusable skills from real work. Left **on**, it's
     *adaptive*: eager while the office is young (so you see your agents grow), then it
     throttles itself once they have a healthy skill library. Turn it off to stop entirely.
   - **Verify delegated work** — off by default; a quality double-check that costs an extra
     run per task. Turn on only when you need the extra rigor.
3. **Watch the meter.** `bagidea stats` shows the last 7 days — runs, cost, per-agent spend,
   and a per-brain estimate — so you can see which agent/brain is expensive and re-route it.

> The defaults are tuned for economy out of the box: agents split into sub-agents only when
> a task is *genuinely* parallel (not "always"), auto-learn is adaptive (eager while the
> office is young, then it throttles itself), idle social is lighter and runs with no web
> tools, and long Claude threads are compacted proactively. You don't have to do anything to
> get those — the knobs above are for going further.

### "The model has a 1M context window — why does the office compact at ~200k?"

1M is the model's **maximum** — not the size it works *best* at, or *cheapest* at. The office
keeps each agent's working memory around ~200k tokens and summarizes older history beyond
that, for two reasons:

- **You pay for the whole context on every turn.** Each reply is billed the *entire*
  conversation so far as input. If a thread is allowed to grow to ~900k before the model
  compacts on its own, every turn near there bills ~900k input tokens — for the same work.
  Capping at ~200k keeps each turn affordable.
- **A tighter context is sharper.** Models lose accuracy when the window is stuffed with
  stale history ("lost in the middle"). A focused ~200k working set usually gives *better*
  answers, not worse.

This is **not** a limit on what an agent can do. Compaction *summarizes* the old history and
continues — and the real source of truth, your **files on disk**, is always there for the
agent to re-read. Think of it like a desk: it could hold a thousand pages, but you work
fastest with the ~200 you actually need in front of you; the rest are filed and one reach
away.

Most tasks never reach the cap, so there's no overhead for normal work — it only bounds
genuinely long, marathon threads. And it's **tunable**: raise a specific agent's budget for
big builds (`providerConfig.claude.contextBudget`), or set `CTX_BUDGET.claude = 0` to let the
model self-manage all the way to its window.

---

## 3. Running with **no Claude at all** (e.g. GLM + DeepSeek only)

Totally supported. Set your office-wide **default provider** (and/or each agent's brain) to
GLM or DeepSeek and everything works — the Director delegates, agents run real tasks in
projects, sub-agents split, skills are learned — all on those models. For coding and
research, GLM-5.2 and DeepSeek V4 are very capable, so the agents stay genuinely useful.

**The one thing to know: vision.** GLM and DeepSeek (and most cheap/fast chat models) are
**text-only**. On their own they can't look at a screenshot. BagIdea Office has a built-in
fallback that lets *any* brain "read" an image — but that fallback needs a vision key (see
§4). So:

- **GLM/DeepSeek for brains + a free Gemini key for eyes** is the sweet-spot cheap setup:
  the agents think on GLM/DeepSeek, and any image you send is auto-described/OCR'd by Gemini
  so even a text-only agent can work with it. Voice features come along for free with the
  Gemini key too.
- With **no** Gemini/OpenAI key at all, a GLM/DeepSeek-only office simply **can't see
  images** — it'll work fine on text/code but will tell you it can't view a picture.

---

## 4. Vision — making agents see images

### How to send an image
**Attach it through the chat** (the 📎/upload control), don't just paste a file path. The
office copies it into `workspace/uploads/` and hands the agent a path it can actually open.
A bare path to some other folder often can't be reached by the agent's run and won't be
seen.

### How any brain can still "read" an image
When you attach an image, the office runs a quick **describe + OCR** pass (Gemini Flash, or
GPT-4o-mini as fallback) and injects a text description **plus the verbatim text in the
image** into the agent's prompt. This is what lets a text-only brain (GLM/DeepSeek/Groq…)
work with screenshots at all. **It requires a `GEMINI_API_KEY` or `OPENAI_API_KEY`** in
⚙ → CONNECT. Gemini's free tier is enough — add it just for this (and voice).

### When you need *real* vision (precise visual judgments)
The OCR/description pass is great for **reading text** in an image and a general summary.
It is **not** reliable for fine **visual/spatial** judgments — e.g. "is the character's foot
floating a few pixels above the floor?" For that the agent must actually *see the pixels*,
which means giving that task to an agent whose brain is **natively multimodal**:

- **Natively see images:** **Claude**, **Gemini**.
- **Text-only (rely on the OCR/description fallback):** GLM, DeepSeek, Qwen, Groq, Cerebras,
  most local models.

**Recipe:** put the agent that reviews art / UI / screenshots on **Claude or Gemini**, send
the image via the chat upload, and ask your precise question. The other agents can stay on
cheaper text-only brains.

---

## 5. Three setups to copy

| Goal | Director / senior | Workers | Eyes | Notes |
|---|---|---|---|---|
| **Cheapest** | GLM or DeepSeek | GLM / DeepSeek | free **Gemini key** (OCR) | No Claude. Text + code excellent; images via OCR. |
| **Balanced** | Claude | **Gemini Flash** | native (Gemini sees) | Workers are cheap *and* can see images; Claude orchestrates. |
| **Best quality** | Claude | Claude | native (Claude sees) | Most capable, most expensive — turn Social/Heartbeat down to save. |

For local-only / offline, see **[Ollama & local models](ollama-local.md)**.

---

### Quick checklist to lower a high bill
- [ ] Move busy/worker agents off Claude onto DeepSeek / GLM / Qwen / Gemini Flash / Groq.
- [ ] Add a free **Gemini key** (eyes + voice) if you run text-only brains.
- [ ] Put image/visual-review agents on **Claude or Gemini**; send images via the upload.
- [ ] In ⚙: Social lower/off, Heartbeat off, Verify off (unless needed), Auto-learn as you like.
- [ ] Check `bagidea stats` to find the expensive agent and re-route its brain.
