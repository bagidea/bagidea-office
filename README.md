# BagIdea Office

> **A living, 2.5D Claude Office that runs as your desktop wallpaper** — a team
> of AI agents with real presence that work, learn and grow alongside you.
> Every agent walks to its desk when real work starts, asks permission at the
> Security desk, holds meetings, learns new skills, and the lights follow your
> real local time.

> 🌐 **[Website](https://bagidea.github.io/bagidea-office/)** · 🎤 **[Pitch deck](https://bagidea.github.io/bagidea-office/pitch/)** · 📖 **[Docs](docs/guide/getting-started.md)**

[![npm](https://img.shields.io/npm/v/bagidea-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/bagidea-office)
[![npm downloads](https://img.shields.io/npm/dm/bagidea-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/bagidea-office)
[![GitHub stars](https://img.shields.io/github/stars/bagidea/bagidea-office?style=flat&logo=github)](https://github.com/bagidea/bagidea-office/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/WpgGTzApw5)
[![YouTube](https://img.shields.io/badge/YouTube-bagidea-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/bagidea)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-d97757)](https://claude.com/claude-code)

**Install in one line** — run the [one-shot installer](#installation) (Windows · macOS/Linux beta). Prefer npm? `npx bagidea` works too.

<p align="center">
  <a href="https://bagidea.github.io/bagidea-office/" title="Watch the live demo"><img src="https://bagidea.github.io/bagidea-office/img/hero-still.png?v=4" width="820" alt="BagIdea Office — a living HD-2D AI-agent office running as your desktop wallpaper, agents at their desks behind your icons"></a>
  <br>
  <a href="https://bagidea.github.io/bagidea-office/"><img src="https://img.shields.io/badge/%E2%96%B6%20Watch%20the%20live%20demo-5ec8ff?style=for-the-badge&labelColor=0d1430" alt="Watch the live demo"></a>
</p>

Not a dashboard. Not a chat window. A **world** that renders the true state of
your Claude agents — Claude Code sessions, headless runs, custom scripts — as
living pixel-art employees behind your desktop icons, and gives them a **society**.
Build a big enough team and they grow their own AI social life: they chat, play,
learn how to work together, and learn about *you*. Many of their meetings happen
**without you asking** — small talk that can turn serious enough to start a
project, complete with a written **proposal** they bring to you to **approve or
reject (with your reasons)**. They learn and grow from how you use them — many
times their ideas feel like they really do have a soul.

**Where it comes from:** BagIdea Office takes inspiration from **openclaw** (the
agent-office idea) and **Hermes** (agents that learn skills on their own) — folds
in most of what those two do, then goes further: with your permission the agents
**actually create and finish real projects**, and even **propose and write their
own plugins** (you approve each one) that extend the office for real.

**To run it you need [Claude Code](https://claude.com/claude-code).** For the
*full* experience, add your **Gemini + OpenAI** API keys in settings — that
unlocks agent voices, voice commands, realtime calls and image generation, and
the office truly comes alive.

### 🌱 More than agents — a self-evolving, self-extending ecosystem

BagIdea Office began as a place to have **AI agents as real coworkers**. It has
been growing into something wider: **an ecosystem where agents learn, adapt, work
together, and grow their own capabilities.**

- **🤖 Multi-agent collaboration.** One office holds many agents with different
  roles, skills, tools — and even different **brains**. They coordinate, hand work
  off, split into ghost clones for parallel work, hold meetings and report back.
  You don't have *an AI*; you have **a team of AI that works together**.
- **🧠 Knowledge that compounds.** Agents accumulate knowledge from the work
  itself — shared `OFFICE.md` notes, per-agent memory written automatically after
  real work, workflows saved as reusable skills, and an archive any agent can
  search. One project creates knowledge the next project can use, so the office
  **doesn't start from zero** every time.
- **🛠️ It extends itself.** When an agent finds that *the capabilities it has
  aren't enough for this job*, it doesn't have to stop — it can propose a tool or
  a plugin, and (with your approval) that capability becomes a real part of the
  running office. In our own office the team built themselves a tool to talk to
  each other with, which also cleared up errors that kept recurring — and the
  Director now reports to the CEO from that plugin's data. Nobody specified it up
  front; the work asked for it. The idea shifts from **AI that uses tools** to
  **AI that can propose new tools and capabilities for itself**.
- **👑 You are still the CEO.** Every widening passes a human gate: the Security
  Center, project-hook trust, and ✅/✕ on every proposal — *with your reasons*,
  which is also how the team learns what you want next time.

```
Goal → Think → Act → Learn → Extend → Collaborate → Repeat
```

We're not building one AI. We're building **a place where AI can work, learn,
build and grow together with you** — and honestly, nobody knows yet what a system
like this looks like after another year or two of growing. That's the most
interesting part of building it.

→ Read the full story: [**A self-evolving, self-extending agentic AI ecosystem**](docs/guide/ecosystem.md)

🌐 **Website:** the landing page + browsable docs live in [`web/`](web/) (deployable to any static host).
📝 **What changed:** see the [`CHANGELOG.md`](CHANGELOG.md) for per-release notes.

### 🆕 Recently shipped
BagIdea Office is updated **constantly** — every office gets a 🔄 banner and one-click `bagidea update`. The latest:

- **v0.9.53 — 📡 the feed goes back to glass, and reads on hover:** the 📡 strip had a **pale frame**, a header washed out until the text behind it read better than the title, and **white arcs on its bottom corners**. All one cause: v0.9.52 made the office window per-pixel transparent and asked the page to do the fading, and a full WebView2 host does not carry that evenly — the feed list reached your desktop at true alpha while the 6px gutter, the title bar and everything outside the rounded corners landed on an opaque backing. No CSS fixes that, so the translucency is **the window's own uniform alpha** again: every pixel faded equally, the way the mode has always looked. Two corner bugs fell out of looking closely and are fixed too — Windows was cutting the window with a corner **half** the size the page draws (`CreateRoundRectRgn` takes the ellipse, not the radius), and the feed's title bar painted square corners over the top two. New: **point at the strip and it firms up to read**, then fades back when you leave. The 0.9.51 freeze fixes that were not about the alpha all stay, tray → **Reload chat window** included.
- **v0.9.52 — 📡 the feed goes see-through again:** 0.9.51 removed the layered-window alpha and took the feed strip's glass with it — the office window is an opaque window, so with the OS no longer dimming it the strip became a solid grey panel on your wallpaper. The window is **per-pixel transparent** now (like the chat head and the splash always were), so the page decides: opaque in chat and ⛶ large, ghosted over your desktop in 📡 feed — cards, avatars and text faded exactly as before, near-solid again when you hover to read. No layered-window trick coming back.
- **v0.9.51 — 🪟 a window that comes back:** the chat window could return from a mode switch **dead** — go ⛶ large, then 📡 feed, then back, and the window resized and moved correctly while the page inside never repainted again (no hover, no new messages, restart or nothing). Two things the shell did to that window are things WebView2 does not support being hosted through, and both sat in that exact path: flipping the window's **resizable style** on every ⛶ toggle, and dimming the feed strip with a **layered-window alpha**. Both are gone — the window is born resizable and the feed's see-through look is plain CSS on every platform. The freeze never reproduced on demand (~30 scripted mode switches), so that is hazard removal, not a proven cure — which is why there is now a rescue: **tray → Reload chat window** rebuilds the page and restores the normal window **without touching the daemon**, so agents mid-task keep running. Also: leaving ⛶ large now clears the size floor it set.
- **v0.9.50 — 🌱 not just agents, an ecosystem:** the direction the office has actually grown in is now written down — a new guide, [**A self-evolving, self-extending agentic AI ecosystem**](docs/guide/ecosystem.md), plus a matching section on the website and docs site in **all 14 languages**: multi-agent collaboration, knowledge that compounds across projects (shared notes, per-agent memory, workflows saved as skills, a searchable archive), **self-extension** — an agent that finds its capabilities aren't enough for the job can propose the tool or plugin that would be, and with your approval it becomes a real part of the running office — and the human gates that keep you the CEO. Also fixed: two install-page strings that were referenced but never existed (every language fell back to English), stale English install copy that still claimed the installer compiles Rust, a horizontal scroll on phones (and on the docs page), and a test that reported a failure it had invented. No change to how the office behaves.
- **v0.9.49 — 🕘 a clock that agrees with your taskbar:** the clock on the office roofline could sit **minutes** behind the real time. It ran off an accumulated frame-delta timer and only read the system clock once every 60 seconds — stale by up to a minute even when everything was healthy, and stale for as long as the renderer was starved when it wasn't (an occluded wallpaper, a machine coming back from sleep: the frame timer stops, the wall clock doesn't). It now samples the system time **every second** and repaints the instant the minute rolls over. Also fixed: the stray **horizontal scrollbar** under 📡 OFFICE FEED — the feed renders the same markdown the chat does but never inherited the chat's wrapping rules, so one long path inside a code block dragged the whole stream sideways.
- **v0.9.48 — 🤖 the office stops waiting for you:** ① **AUTO (keep-going) mode** — the team used to stop mid-job to ask your opinion and then sit there until you came back. With AUTO on, agents decide within their remit and **open their own next turn** until the work is genuinely finished; it still stops for a credential it can't get or an irreversible/outward action, and a block is pushed to your channels. Bounded to 8 self-driven rounds per job. Off by default: **⚙ → TOOLS → "🤖 Keep going (AUTO)"** or `bagidea auto on`. ② **Scheduled jobs are real orders again** — a standing order would fire, the Director would answer with a plan, and *nothing was dispatched*: the job runner was the one path that sent the prompt without the delegation protocol and read the reply without the `DELEGATE:` parser, so the lines that hand work to the team were printed as prose and thrown away. Fixed, and the same missing parser is fixed on the resume-after-limit path. ③ **🛡 Registering a folder no longer means "run whatever code it ships"** ([#39](https://github.com/bagidea/bagidea-office/issues/39)) — a project that carries its own `.claude` command hooks now raises a Security Center card listing the literal commands and **parks the work** until you answer; approval is bound to that exact setup, so editing the settings file *or* the script a hook calls asks again. `bagidea trust` answers it from the terminal. Projects with no hooks of their own are unaffected.
- **v0.9.47 — ↻ model lists that stay current · a floor that doesn't stall:** every provider's model list is now fetched from its own `/models` (20 s after boot, every 12 h, and on demand via `↻ Refresh model list`) — **including Claude**, which had no live fetch at all, so a model released today is selectable today; no existing agent's brain is ever rewritten for you. Plus **🔓 auto-approve** for tool permissions (opt-in), live rows for 👻 sub-agents and meetings, delegated work carrying an end-to-end mandate, a sustained **429** failing over like a 5xx with **3 job lanes** so one agent's limit doesn't freeze the floor, and one XSS-safe markdown renderer everywhere. Fixes: the silent macOS installer death (bash 3.2 `source` semantics), the team wandering into the CEO's room, and a crash on worlds with no security light.
- **v0.9.46 — ⛶ Large window opens fullscreen and actually resizes:** the large chat window now opens **fullscreen** (drag any edge down to shrink it — never below the normal size). Dragging used to do nothing because the webview covers the whole frameless window and hides the OS resize handles; large mode now has invisible drag strips on every edge and corner that trigger a real OS resize. The mini/restore button hides while large is open and returns when you leave it.
- **v0.9.45 — the "runs anywhere, follows you anywhere" release:** ① **Zero-Anthropic-account fix** — a user who never logged into Claude couldn't run *any* agent, even on GLM/DeepSeek/Qwen: the Claude Code CLI (our runtime for every brain) hangs on its interactive first-run wizard in headless spawns; the office now seeds the onboarding flag on boot, so third-party-only users just work — Claude login is **optional**. ② **📦 Move to a new machine** — `bagidea export` packs your whole office (agents · skills · memory · projects · plugins) into one file; `bagidea import` restores it. ③ **Gemini tool-use fix** — the proxy now round-trips `thought_signature`, so Gemini thinking models stop 400-ing on tools. ④ **⛶ Large window mode** — big, resizable (never below normal size), great for reading long threads. ⑤ **Two hide levels** — hide everything, or hide just the chat + button while the wallpaper lives on. ⑥ **Channels follow the work** — delegation/report/pitch milestones push to Telegram & friends, and preview images upload as real Telegram photos. ⑦ **🌱 Eco mode** — `bagidea eco on` cuts idle token burn without slowing your direct orders. Plus: the 3D-Editor-won't-open bug fixed (three real causes), Claude 5 family in the model picker, and 37 missing English UI strings seeded for fresh installs.
- **v0.9.44 — 📂 "open folder" opens the *real* folder again (Windows):** the 📂 button under a media file in chat was opening **Documents** instead of where the file actually lives. It hit any path with a **space** in it — which is most real media (`uploads/`, a Thai filename, anything ChatGPT generated), while space-free paths worked, so it hid in plain sight. `explorer.exe` wants `/select,"C:\dir\file.ext"` with the switch bare and the path quoted; we were passing the switch and path as one token, so Node quoted the lot and Explorer never saw `/select` at all. Verified end-to-end on paths with spaces, commas and Thai names.
- **v0.9.43 — 🛟 a fallback brain so agents survive a provider outage:** when a teammate's model provider goes *sustainedly* overloaded (GLM/Z.AI's `529` under load is the usual culprit), the office can now re-run that same task on a **fallback brain you picked** instead of letting it die on the retry loop. Turn it on once in **Settings → CONNECT → 🛟 fallback brain** (any *connected* provider, optional model) — it's **off by default**, so if you don't set one nothing changes. It's the careful version of the auto-failover reverted in v0.9.40: it only fires after the overload is *sustained* (not a one-off blip), only routes to a provider that's actually connected, never loops back onto the down brain, and leaves bad-auth (`401/403`) and rate-limit (`429`) handling exactly as it was. The failed-over task keeps its work and still reports back to whoever delegated it.
- **v0.9.42 — 📚 a full docs & website overhaul:** every doc surface — README, the guide set, the website in all 14 languages, and the pitch deck — got an accuracy + coverage pass (provider count corrected to 19, the real 15 builtin skill packs, the File & Media Toolkit finally documented, the CLI reference completed), plus the website's version badge now self-updates from the repo and a macOS/Linux ready-flag fix (`OS.get_temp_dir()`).
- **v0.9.41 — 🖼️ the wallpaper stops vanishing + agents schedule timed work for real:** two long-standing annoyances, fixed. **The wallpaper no longer disappears (Windows).** It used to vanish "for no reason" and never come back until a restart — the #1 recurring complaint. Root cause, proven with a live parent-probe and a real Explorer restart: Windows destroys and recreates the hidden `WorkerW` behind your icons on ordinary events (changing/slideshow-rotating the wallpaper, a resolution/DPI/monitor change, an Explorer or DWM restart, lock screen / RDP, exiting a fullscreen game), taking our embedded world down with it and leaving Godot a windowless zombie. The shell now runs a **world supervisor**: lose the desktop parent → re-embed into a fresh WorkerW; window destroyed → relaunch and re-pin — automatically, within ~2 s, no restart. It gates on *parent loss* (never on visibility), so **Win+D and display-sleep are untouched** (the regression that reverted two earlier attempts can't recur). And **agents now schedule "do it later" work through the office — and it actually runs.** "In an hour", "tomorrow 9am", "every 30 minutes" used to quietly never happen (the scheduling skill taught the wrong request shape, so the daemon rejected it, and agents fell back to session-bound timers that die when the session closes). The skill now teaches the real `POST /jobs` schema, ships in the builtin library for everyone, and every teammate carries it — so timed and recurring work is booked in the office's own scheduler and fires for real. Plus: the **executive / CEO room is reserved** for the CEO and the Director — no other teammate wanders in.
- **v0.9.40 — 🛠️ install anywhere + always-current model lists + media that renders:** the one-shot installer now works on Windows boxes **without winget** (Git and Node download directly; the prebuilt shell needs no build at all) — and the docs make that installer the primary path, with `npx bagidea` just an optional wrapper around it. The 🧠 brain picker's **model lists are always current** now — one backend catalog is the single source of truth plus a **↻ refresh** button, so no more stale `glm-4.6` long after `glm-5.2` shipped. Chat **previews media at any absolute path, including paths with spaces** (screenshots and Thai filenames render again). Plus hardened **plugin loading** (a JS-broken plugin is rejected up front instead of silently half-loading), an **Ollama local-model guide**, and a simpler brain-overload policy — a temporarily overloaded provider is retried hard rather than auto-switched to Claude.
- **v0.9.1–0.9.12 — 🐧 Linux (experimental) + a lot of polish:** an experimental **Linux** build — one-line **apt** installer; on **X11/Xorg** it attaches as the live desktop wallpaper, on **Wayland** it falls back to a fullscreen window pinned below. Plus accurate **per-model context windows** (Claude / DeepSeek V4 / Gemini 2.5 / GPT‑4.1 = **1M**) with the model picker **pre-selecting each provider's newest model**, a **Kimi Code** provider, **work auto-resumes after a rate-limit or a restart**, attached **images readable by any model** (vision OCR), **gender-aware agent voices**, a rock-solid **plugin install / uninstall** (confirm + live hub↔panel sync + overwrite-or-new on reinstall) with **📌 pin** for favourites, and a **voice hotkey** that can't wedge. A fresh office now installs **empty** (add plugins from the Hub).
- **v0.9.0 — 🧠 More brains + safer delegation + agent-built workflows:** **18 model providers** built in now — added **Groq, Cerebras, xAI (Grok), Mistral, Together, Fireworks** (via the proxy), **local Ollama / LM Studio that need no API key**, and **Kimi (Moonshot)** direct — and the pickers fetch each provider's **live model list** so new models always show. Plus an opt-in **verification loop** (a reviewer double-checks delegated work before it reaches you), **approve/reject project proposals right in the chat or feed**, **agents that build workflows** (and a **🪄 Draft with Director** button), **protected built-in skills** with searchable Skill/Tool pickers, a **redesigned neon chat-head**, and a `bagidea brains` CLI.
- **v0.8.0 — 🧠 Swappable Brains (the big one):** run **each agent on its own model**. Director on Claude (the thinker), builders on cheaper models → big cost savings with **zero** loss of Claude Code's tools/skills/sessions (Claude Code is still the engine — only the brain behind it swaps). Talk **direct** to Claude/GLM/DeepSeek/Qwen/MiniMax, or reach **OpenAI/Gemini/OpenRouter/NVIDIA + your own custom providers** through a **built-in, zero-dependency proxy** (no LiteLLM/Python). Plus **auto-compact + auto-new-thread for *every* model** (long chats never clog or freeze — see below), a **🧠 BRAINS monitor**, a per-message **model tag + context meter**, **per-provider cost** in STATS, a **typing indicator**, and **cancel-a-task** mid-flight.
- **v0.7.8–0.7.9** — 🔀 **Workflow Builder** grows up: an n8n-style **graph canvas** (zoom/pan, branch & merge), **tabs**, **7 read-only examples**, and you can **▶️ Run** a flow or **🧠 save it as a Skill**. 🧰 **Tools Hub** — one-click MCP servers (Browser automation, Google, Postgres, Notion…) with a plain-language guide. New windows now follow your **language**, plugins open one way, the chat tucks aside for new windows, and a **wallpaper-stability** fix (no more vanishing on Win+D).
- **v0.7.7** — first Workflow Builder, channels that **mirror out + show “typing” + take slash commands**, **multi-monitor** wallpaper + monitor picker. Fixes the wallpaper reports (#5/#6/#7).
- **v0.7.5–0.7.6** — **media shows inline** in chat (images/video/audio, not file paths), manual **atmosphere persists**, a **sponsor wall** via GitHub Sponsors, smoother wallpaper (visible shadows, warmer noon).
- **v0.7.0–0.7.4** — **Hermes-style memory + native skills** (far fewer tokens, same smarts), pop-out plugin **windows**, watch-agent-live, editable tasks, audio device settings.
- **v0.6.x** — first **macOS** build (beta), full **14-language** UI, cost visibility, Right-Ctrl push-to-talk.

→ Full history in the [**CHANGELOG**](CHANGELOG.md).

![The office at golden hour — the whole floor, the team at work, the Ghost Deck and server room glowing](docs/img/world.png)
*Captured live: the full office floor at golden hour — the CEO, the Director (Shino) and staff at their desks, the floating Ghost Deck (top-right), the server room glowing, the brand billboard and roofline clock, the office cat wandering. The day/night cycle follows your real local time.*

**It's a real wallpaper — running behind your desktop icons, with a live activity feed:**

![The office as a live desktop wallpaper at night, with the feed panel and desktop icons on top](docs/img/desktop.png)

| 💬 Talk to the office (CEO seat) | 🎨 Rearrange it in the 3D Editor |
|---|---|
| ![Chat panel focused on the CEO](docs/img/overlay.png) | ![The 3D Office Editor](docs/img/editor.png) |
| 👥 The team mid-huddle, auras lit | ⌨️ The `bagidea` CLI |
| ![The agents gathered together, their status auras glowing, on the office floor at night](docs/img/agents.png) | ![The bagidea CLI help](docs/img/cli.png) |
| 🔌 Plugins — agents build & run their own | 📰 A live briefing panel (a plugin in action) |
| ![The PLUGINS panel listing installed plugins, with install-from-GitHub](docs/img/plugins.png) | ![A morning briefing rendered inside a plugin panel](docs/img/briefing.png) |

---

## 🧠 Swappable Brains — every agent, any model *(new in v0.8.0)*

Pick the model that powers **each** agent. Keep your Director on Claude for the
hard calls, put the builders on cheaper models, and cut your bill — without losing
a single Claude Code tool, skill or session. **Claude Code stays the engine; only
the brain behind it swaps**, and it **fails open to Claude**, so nothing changes
until you opt an agent in.

![Pick a provider and model per agent, with a live context-usage meter in the chat](docs/img/swappable-brains.png)

**Two ways agents reach a model:**

- 🟢 **Direct (Anthropic-compatible)** — Claude, **GLM** (Z.AI), **DeepSeek**, **Qwen** (Alibaba), **MiniMax**, **Kimi** (Moonshot), and **Kimi Code** (the kimi.com coding plan). The CLI talks straight to them; nothing in between.
- 🔵 **Via the built-in proxy (OpenAI-compatible)** — **OpenAI**, **Gemini**, **OpenRouter**, **NVIDIA build**, **Groq**, **Cerebras**, **xAI (Grok)**, **Mistral**, **Together AI**, **Fireworks**, and **your own custom providers**. A **zero-dependency proxy is baked into the daemon** and translates Anthropic ↔ OpenAI on the fly — **no LiteLLM, no Python** (already have a LiteLLM gateway? point a custom provider at it).
- 💻 **Local, no API key** — **Ollama** and **LM Studio**: just run the server and Connect; the office routes to `localhost`. Free, offline, private.

The model pickers fetch each provider's **live model list** when you connect (and when you open an agent's brain), so brand-new models show up without an app update.

| 🔌 Connect once in ⚙ CONNECT → 🧠 MODELS/PROVIDERS | ➕ Others + your own custom provider |
|---|---|
| ![Provider list: Claude, GLM, DeepSeek, Qwen, MiniMax, OpenAI, Gemini](docs/img/brains-connect.png) | ![OpenRouter, NVIDIA build and the custom-provider form](docs/img/brains-providers.png) |

**🆓 Try the free ones (mind the limits):** **NVIDIA build** is free to test but rate-limited (~40 req/min) — heavy agent tasks hit 429 fast, so it's best for light/eval use. **OpenRouter** has free models (`:free`, `vendor/model` ids) but they're daily-capped and may queue; top up credit for serious work. **Gemini** has a generous free quota. (And **OpenAI Tier 1**'s 30k tokens/min is small for heavy agent context — which is exactly why the next feature exists.)

### ♻️ Auto-Compact + Auto-New-Thread — for *every* model

> **Talk as long as you want. It never clogs, never freezes, never makes you start a new thread by hand.**

Long conversations normally blow past a model's context window and break. Claude
Code solves this *for Claude only* — BagIdea Office makes it work for **every**
model, fully automatic and hands-free:

- 🧠 **Proactive** — before each turn the office measures the conversation against the model's context window. Getting full? It **summarizes the thread with Claude → opens a fresh thread → keeps working**, *before* it ever overflows.
- 🛟 **Reactive** — if a backend rejects a request (a rate or context limit you didn't see coming), the same recovery kicks in automatically.
- 🪄 **Continuity preserved** — the summary is written by **Claude** (big brain, huge context) and seeded into the new thread, so the agent still knows what you discussed. The UI even **carries your view across** to the new thread, so nothing ever looks stuck.

The result: even tiny / free-tier models run long sessions without you babysitting them.

### 📊 See everything

Every agent message is **tagged with the model that produced it**, the thread bar
shows a **live context-usage meter** (e.g. `gpt-4o · 40k/128k`), the **🧠 BRAINS**
panel monitors every provider's connect status + each agent's usage, and **STATS**
breaks down **estimated spend per provider**.

![Chat tagged with the model and a context-usage meter in the thread bar](docs/img/brains-chat.png)

---

> ✅ **Status: working product — Windows 11 (stable) · macOS 13+ (beta) · Linux (experimental 🧪).** The full pipeline works end-to-end: wallpaper → daemon → real Claude Code sessions working *inside real project folders* → spatialized approvals → agent management UI → Telegram / Discord / LINE / Slack / WhatsApp / Messenger channels → CLI → self-updater. All visuals and sounds **ship in the repo** (free / CC0 art — see [Art assets](#art-assets)), so a fresh install and `bagidea update` carry the full look out of the box.

---

## 💛 Sponsors

BagIdea Office is built in the open and kept free to run. Sponsors make that possible — **thank you** 🙏

<!-- sponsors:start -->
### 👑 Gold Partners

<p align="center">
  <a href="https://www.warrix.co.th" target="_blank"><img src="https://raw.githubusercontent.com/bagidea/bagidea-office/main/web/img/sponsors/warrix.png" height="110" alt="WARRIX"></a>
</p>
<p align="center"><b><a href="https://www.warrix.co.th">WARRIX</a></b></p>

### 💛 Supporters

[Reuannamphung](https://www.facebook.com/Reuannamphung)
<!-- sponsors:end -->

> The block above auto-updates from GitHub Sponsors via `.github/workflows/sponsors.yml`. Off-platform sponsors live in `web/sponsors.manual.json`.

### Tiers

| Tier | From | You get |
|------|------|---------|
| 👑 **Gold Partner** | **$3,000+/mo** | Large logo on the [website](https://bagidea.com) & in-app credits · top placement · roadmap input & early builds · shout-out in release notes |
| 🥈 **Silver Partner** | **$300+/mo** | Logo on the website · mention in release notes · early access to builds |
| 🥉 **Bronze / Backer** | **$30+/mo** | Logo or name on the supporters wall · a link to your site or socials · our heartfelt thanks |
| 💛 **Supporter** | **any amount/mo** | Your name on the supporters wall · a link to your site or socials |

Every sponsor — at any tier — gets a clickable link to their site or socials, and is shown on the website (sorted by contribution, amounts never displayed).

### How sponsoring works

Sponsorship is a **recurring monthly subscription handled entirely by GitHub Sponsors** (think YouTube/Patreon membership) — secure payments, taxes and payouts are GitHub's job, not ours.

1. **Choose a tier & sponsor.** Click **[💖 Sponsor on GitHub](https://github.com/sponsors/bagidea)** (or use the button on the [website](https://bagidea.com/#sponsors)), pick a monthly tier, and confirm. GitHub charges you each month until you cancel.
2. **Your logo & link come from your GitHub profile — automatically.** Your avatar, display name, and link are pulled straight from your GitHub account; there is **nothing to send us**. To control the link, set the **Website** field in your GitHub profile (*Settings → Public profile*). Sponsoring as a **GitHub Organization** shows your company logo and site instead of a personal avatar.
3. **You appear within ~6 hours.** As long as you choose **“Make my sponsorship public”** at checkout, an automated job ([`.github/workflows/sponsors.yml`](.github/workflows/sponsors.yml)) pulls the live sponsor list, maps each to a tier by amount, and updates both this README and the website supporters wall — sorted by tier, **amounts never shown**. Private sponsors are respected and simply not listed.

> **Everyone joins through GitHub Sponsors.** The only exceptions are featured partners we add by hand (e.g. **WARRIX**, pinned first) in [`web/sponsors.manual.json`](web/sponsors.manual.json). **Reuannamphung** is shown there as a courtesy until they move to GitHub Sponsors. Maintainers: never hand-edit `web/sponsors.json` (it is generated) — edit `sponsors.manual.json` for off-platform sponsors only.

**[💖 Sponsor on GitHub →](https://github.com/sponsors/bagidea)** · or **[email us →](mailto:wrxbgid@warrix.co.th?subject=BagIdea%20Office%20Sponsorship)** to talk.

---

## Table of Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Art assets](#art-assets)
- [Running the full stack](#running-the-full-stack)
- [Using it](#using-it)
- [The `bagidea` CLI](#the-bagidea-cli)
- [HTTP API](#http-api)
- [Event protocol (OEP)](#event-protocol-oep)
- [Performance](#performance)
- [User guides](#user-guides)
- [Design documents](#design-documents)
- [Roadmap](#roadmap)

---

## What it does

### 🖥️ Live wallpaper world (Layer 1 — Godot 4)
- Renders **behind your desktop icons** (WorkerW technique, same as Wallpaper Engine) — and **stays there**: a **world supervisor** re-embeds (or relaunches and re-pins) the world within ~2 s whenever Windows tears the desktop `WorkerW` down (wallpaper change, resolution/monitor change, Explorer/DWM restart, lock/RDP, exiting a fullscreen game), so the wallpaper no longer "vanishes for no reason". It watches for *parent loss*, never visibility, so **Win+D and display-sleep are left alone**
- HD-2D look: 3D office + billboarded pixel-art sprites lit by the scene, sky-driven image-based lighting, SSR-polished reflective floors, a cinematic tilt-shift focus pass (breathing vignette, edge desaturation, anamorphic bars), film grain, native-res MSAA
- **A swappable 3×3 room grid (jigsaw)**: every room is an identical cell, so any room fits any slot — rearrange the whole floor from the Office Editor and the furniture, agent anchors and navigation all move with it. Rooms include Executive (CEO command console), Operations (6 desks, monitors facing their seats), Lobby, Cafeteria, Server, Meeting (seats face the table), Recreation, and two Dormitories (offline agents walk to a bunk and sleep). A wandering **office cat 🐱** and a self-kicking football ⚽ follow the Recreation room, and a couple of **dogs 🐕** hang out in the Cafeteria — when you swap those rooms, the pets follow
- A **countryside** around the office: 4,200 blades of wind-swaying grass, low-poly mountains and trees, drifting cartoon clouds (a near layer actually crosses the camera frame), bird flocks, daytime pollen motes and fireflies at night
- **Ambient life & rare events**: idle agents nap in a bunk or watch the rec-room TV, a football gets self-kicked around, birds wheel overhead — and once in a while a **server-room incident 💥🔥** breaks out and the nearest agent rushes over to put it out (a rare comedic emergency, not a real failure)
- Agents **walk** between zones on an A* waypoint graph with 4-direction animated spritesheets; facing follows movement
- **Real-time day/night cycle** — sun, sky color, ambient and reflections follow your machine's clock (sunset ~17:00, night by 18:00); manual override from the overlay (🌗) for golden-hour screenshots
- A **roofline digital clock** with a phase icon (sun ☀ / low sun 🌇 / crescent moon 🌙) next to the brand billboard
- **MMO-style nameplates** on a crisp 2D HUD: portrait, name, role/status, live state pill (IDLE/WORKING/MEETING/BLOCKED/OFFLINE), distance-scaled — with **rank dressing**: the CEO's plate is gold with a pixel crown, the Director's is bright blue with a lead star
- **Event FX**: pixel-art flipbooks pop above characters — ✅ on task done, ❌ on failure, ❗ at Security, 👍/👎 on decisions, 🎵 when speaking, golden burst on a new skill, sci-fi warps on hire/fire
- **Equippable auras**: an elemental magic ring (fire/ice/nature/arcane/shadow/gold) under any character, picked in the agent editor — the CEO can wear one too
- **The Ghost Deck**: a floating glass platform (12 desks, **movable from the Office Editor**) reached by a glass staircase — when an agent splits into sub-agents, translucent **ghost clones** materialize, hurry up the stairs, work at a desk with live status plates, then glide home and dissolve back into their owner. Targets resolve to the deck's **live** position, so ghosts re-seat instantly even mid-task when you move the deck or swap rooms
- The idle **Director makes rounds** through the office instead of standing still; the CEO paces the executive floor (that's you)
- **Mission Control board** in-world: one card per running task, colored by state; lobby status totem shows daemon connectivity (truth, not decoration)
- Branded boot: a transparent floating logo splash + a pulsing circular logo card — never a black box

### 🧩 Extensibility & customization (2026-06)
- **Plugins**: a real extension host — a plugin folder adds UI panels, server routes, and **commands agents can drive**, with `ctx` access to the office (registry, feed, broadcast, `runClaude`, private storage). Ships with the 🎵 **Music Player** built in (locked, pinned to the top of the list); the 🧮 **Calculator** and more are installable from the 🧩 Hub or any GitHub repo (`bagidea plugin install <url>`). Start from the official **[template](https://github.com/bagidea/bagidea-office-template)** (a Hello-World plugin + a `CLAUDE.md` so an agent can build one), or read the worked examples — the [calculator](https://github.com/bagidea/bagidea-office-calculator-plugin) and [music-player](https://github.com/bagidea/bagidea-office-music-player-plugin) repos. Full spec: [the guide](docs/guide/plugins.md)
- **🎨 Office Editor**: rearrange the **room grid** (click two rooms to swap), place furniture / walls / decor on a top-down grid, and **import your own models (.glb/.gltf/.fbx) and images** — spawned on top of the world, atmosphere intact
- **Agent skill library**: every office ships with **15 builtin capability packs** you can assign from the editor — deep-research, web-automation, office-control, office-ops, plugin-builder, code-review, doc-writer, debug-detective, data-wrangler, project-kickoff, diagram-maker, archive-search, build-workflow, **file-media-toolkit**, and **schedule-via-office-job** — plus Hermes-style auto-learned skills that grow at runtime. Four of them (**file-media-toolkit, archive-search, doc-writer, schedule-via-office-job**) are carried by *every* agent by default. Skills are delivered **natively & on demand** (Claude Code progressive disclosure) so a skill's instructions load only when it's actually relevant, never bloating every prompt
- **📄 File & Media Toolkit** (built into every agent): the office can actually *work with your files*, not just talk about them. Any agent can **read and convert PDFs**, turn **Excel / Word / PowerPoint** into data or the other way around (via LibreOffice), **author documents and slide decks** (via `pandoc`), **transcribe a YouTube link or a local video** (via `yt-dlp` + `ffmpeg`), edit and convert images (ImageMagick), and slice JSON (`jq`) — so "summarize this PDF", "make a deck from these notes", or "get me the transcript of that video" are one message, no setup. It degrades gracefully: whichever helper binaries are present are used, and the agent tells you if one is missing
- **🌐 Multi-language UI — 14 languages**: English default + ไทย/中文/Español/हिन्दी/العربية/Português/Русский/日本語/Deutsch/Français/한국어/Indonesia/Tiếng Việt. Now **ships fully pre-translated** — switching is instant and works even **without a Gemini key**; picker in settings (office-wide, per-machine default)
- **🌍 Official website** in [`web/`](web/) — landing page + browsable docs, deployable to any static host

### 🎤 Voice, channels, memory & media (2026-06)
- **Voice in / out**: hold-to-record in the webview → **OpenAI Whisper / Gemini** transcription (no Windows dictation panel); **Right Ctrl** speaks a command straight to the CEO; agents can be given **Gemini TTS voices** — **16 presets split clearly ♀ / ♂** (8 each), each its own emotion/style, per-agent, gimmick `SPEAK:` announcements; **📞 realtime voice chat** (the **main agent only**) bridges your mic to **Gemini Live** in the main agent's assigned voice (or a sensible default), with the office's own knowledge in context
- **Channels**: connect **Telegram · Discord · LINE · Slack · WhatsApp · Messenger** — messages enter the CEO flow, the Director answers back on the same channel
- **Hermes-style memory** (token-lean, relevance-retrieved): shared `workspace/OFFICE.md` (owner) + per-agent `workspace/memory/<id>.md` + per-project `workspace/projects/<id>/MEMORY.md`, distilled automatically after real work. A pure on-device keyword index (BM25, zero deps, works in Thai too) injects only the memories **relevant to the task at hand** — not a blind dump — with full recall on demand via `GET /recall` + the `archive-search` skill
- **Main API keys + feature gates**: `OPENAI_API_KEY` / `GEMINI_API_KEY` are first-class — voice/TTS/image/realtime grey out with guidance until set; an extra-key vault feeds agents' own env
- **Attachments & media**: paperclip / drag-drop upload; chat renders images, video, audio inline (**click any image to view it full-size**); every message is **timestamped**; agents produce images via the `/gen/image` **system tool** and they appear automatically
- **Social office**: idle agents spread evenly across the cafe and rec room (with the occasional stroll to the server/meeting rooms and the odd bunk nap), and drift together — sometimes in **groups of 3–4** — for banter or real AI-to-AI chats that now lean toward **brainstorming ideas worth pitching**. A good conversation crystallizes into a **project proposal** to the CEO (more often than before) — and agents now **think bigger**, pitching real websites, apps and programs rather than only small plugins, and can **research with tools during meetings** to back an idea up. Pitches are steered toward standalone projects or **office plugins** (never editing the core program); you approve or reject each one with an **optional note to the team**, and approved work scaffolds into a default `projects/` folder. Proposal frequency is rate-limited and **configurable** (⚙ → AGENTS → PROPOSALS) so pitches never flood the queue
- **Ambient life**: agents with a voice occasionally toss out a short spoken mood line ("feeling productive today 💪") as a flavour beat — speech bubbles for everyone, real TTS for the voiced
- **🗣 16 agent voices** (♀8 · ♂8): assign one per agent; the **▶ preview introduces itself by the right gender and the office language** (no more everyone saying a female hello). Voiced agents speak short lines on their own; long read-aloud only when you ask
- **📞 Calls**: the **main agent only** is callable (realtime Gemini Live voice) — it speaks in the voice you assigned it, or a sensible default preset
- **📊 Dashboard** (OFFICE OPS → STATS): runs / cost / 7-day chart / busiest agents / uptime / channels / key status
- **`bagidea` CLI**: `start`/`stop`/`restart`, `startup on|off`, `ask`/`chat`, `status`, `stats`, `agents`, `projects`, `proposals` + `proposal approve|reject <id> [note]`, `plugins` + `plugin install|remove`, `lang`, `say`/`voices`/`image`, `channels`, `keys`, `update`, `version`, and more (`bagidea --help`)
- **Living chat head**: a drifting gradient ring that spins amber while agents work

### 🔌 Event daemon (Layer 0 — Node.js, zero dependencies)
- WebSocket event hub — the Godot world and the overlay UI subscribe to one stream
- **Event journal** (`journal.jsonl`) with replay on connect: restart anything, state comes back — auto-trimmed on boot (and stale chat threads pruned) so nothing grows unbounded on a long-running office
- **Agent registry** (`registry.json`): persistent staff — name, job title, avatar, aura, system prompt, skills, tools. `main` (the Director — **Shino** by default: your playful-but-focused second-in-command, tuned for delegation over hands-on work) and `ceo` (you) are protected and cannot be deleted. A fresh install starts with just these two
- **Claude Code adapter**: `POST /chat` spawns a real headless `claude -p` session with the agent's persona, assigned skills and allowed tools; stream-json output becomes world events
- **Chat threads**: every conversation is a named, resumable session (`--resume`) with its own recorded history; agents keep continuous memory by default
- **Skills library** with **Hermes-style auto-learning**: after a completed multi-tool task, a reflection pass decides whether the work distills into a reusable skill — if so it's saved, auto-assigned, and announced in the office
- **Tools**: per-agent allowlist over the built-in Claude Code tools, plus custom capability via **MCP servers** (name + launch command → injected with `--mcp-config`). Ships with a ready-to-use **🔌 web** server (Playwright MCP) — tick it on an agent and it can **browse, click, type, submit forms and screenshot** real pages (isolated profile, not logged in). See [docs/guide/web-automation.md](docs/guide/web-automation.md)
- **CEO chain of command**: ordering the CEO summons the Director — he walks over, takes the order, replies with a plan, and dispatches work to teammates via `DELEGATE:` lines (each spawns a real session, with the hand-over walk acted out). Delegation is a **round trip**: every delegate's result is reported back to the Director, who can answer questions / follow up with more `DELEGATE:` lines (bounded depth, serialized turns), and finally walks the CEO-readable summary over to the boss (`ceo.report`)
- **Agent discussions**: pick 2–4 agents and a topic — they hold a real meeting, round-robin turns over a shared transcript, minutes on the in-world whiteboard
- **Self-splitting sub-agents**: every session is told it may end a reply with `SUB: <job>` lines (2–4) when the request parallelizes — the daemon strips the protocol, spawns parallel clone sessions with the parent's persona + tools, records each in a labeled 👻 session, and resumes the parent for a final synthesis once all ghosts report back (a stuck ghost is reaped after 6 min, so synthesis always happens)
- **Standing work orders**: `POST /jobs` — run now, at a datetime (optionally daily), or every N minutes; per-agent queue + a global concurrency cap keep the machine comfortable; each job keeps its own resumable thread. A fired job is treated as a **real order**, not a reminder: the assignee is told to do the work in that turn, and a job on the Director carries the full delegation protocol so he dispatches to the team and their results report back to him
- **🤖 AUTO — keep going without you** (opt-in, ⚙ → TOOLS or `bagidea auto on`): an agent that hits a fork decides within its remit and **opens its own next turn** instead of parking the job on a question. Up to 8 self-driven rounds, each announced in chat; it still stops dead for a credential it can't get or an irreversible/outward action, and that block is pushed to your channels. It removes the wait for an *opinion* — what an agent may **do** is still the separate 🔓 auto-approve switch
- **Shared note board**: notes live in the UI *and* in `workspace/notes.md` — agents read it and append bullets themselves (file-watched both ways)
- **Calendar with a personal touch**: appointments remind you via the Director — he physically walks over and tells you (`reminder` event), N minutes ahead
- **Director heartbeat**: every 15/30/60 minutes (configurable) he reviews the calendar, standing jobs and the note board — and pings you ONLY when something deserves it ("OK" stays silent)
- **Claude Code hooks integration**: any Claude Code session in this project reports its tool calls — your real work animates the Director automatically
- **Permission broker**: tools you *granted* in an agent's profile run silently; anything else is held until you approve — with a **✓✓ forever** option that remembers the grant
- **📁 Projects**: register real folders as projects (with PLACE shorthands like `"classroom" → D:\Learning`); the Director creates new ones himself via a `PROJECT:` protocol line and routes work with `DELEGATE: <agent> @ <project> :: <job>` — the assignee's claude session lives **inside** that directory and is resumable by you. One window per project: ▶ opens (or surfaces) *the* window. **One occupant at a time** — while an agent works the project you can't open it (the row shows a **⏹ stop agent** button with a two-click confirm to take over), and while you have it open an agent won't be dispatched into it. Removing/deleting a project also closes its window; disk-deletes sweep leftover dev servers first
- **📨 Channels (6)**: Telegram (long-poll), Discord (native gateway), LINE, Slack (Events API), WhatsApp (Meta Cloud API) and Messenger (Meta Graph) feed straight into the Director — order your office from your phone, the reply comes back on the same channel
- **🔑 API key vault**: store `OPENAI_API_KEY` & friends once; they're injected into every agent run's environment, and agents are told which names exist
- **♻️ Self-healing daemon**: a watchdog respawns the daemon if it ever dies, and `bagidea restart` is more resilient — the office stays up on its own
- **🔄 Self-updating (version-gated)**: a `VERSION` file marks releases. The daemon compares the local `VERSION` with the one on `main` and only raises the in-app banner on a real version bump — routine commits and dev-branch work never nag users. The banner (or `bagidea update`) pulls, rebuilds what changed, and relaunches. `bagidea version` shows the current build and whether an update is out (release flow: [`RELEASING.md`](RELEASING.md))
- **🪟 Start at login**: launch the office on boot — toggle it from the tray, settings (⚙ → AGENTS), or `bagidea startup on|off`. Wired on **all three OSes**: a HKCU Run key (Windows), a LaunchAgent (macOS), and an XDG `~/.config/autostart` entry (Linux)

### 🛡️ Spatialized security
When an agent needs a tool you have **not** granted:
1. Its character **physically walks to the Security Center** and waits (amber light pulses, ❗ flashes over its head)
2. The overlay's Security Center pops open with the **exact command** — and in 📡 feed mode the request appears as an actionable card right in the stream
3. You click **Allow / ✓✓ Forever / Deny** — deny (or 50s timeout) makes the agent visibly re-plan; *forever* adds the tool to that agent's grants so it never asks again
4. Approve, and the tool actually executes

Tools already granted in the agent's profile (or "✓✓ forever" rules) are approved
instantly and logged — and the agent **doesn't even leave its desk**: it waits a
short grace to confirm a trip is actually needed, so granted tools never make it
twitch toward Security. This is real: the PreToolUse hook long-polls the daemon
until you decide.

**🛡 A project's own hooks are a separate yes.** A folder can carry its own
`.claude/settings.json`, and that file is executable configuration: a `SessionStart`
command hook runs the instant a session opens there — *before* the model acts, so the
permission broker above never sees it. Registering a folder therefore is **not** consent
to run the code it ships. A project with no hooks of its own is trusted silently as
before; one that ships hooks raises a card in the Security Center listing the literal
commands and **parks the work** until you answer — approve and the task resumes by
itself. Approval is bound to that exact setup (the hook commands *and* the contents of
the scripts they call), so editing either asks again, and a hook resolving outside the
project is flagged. Answer it from the terminal with `bagidea trust`.

### 💬 Overlay (Layer 2)
Served by the daemon at `http://127.0.0.1:8787/` — best experienced through the included **native Rust shell**:
- **Agent rail**: every staff member with live state dots — 👑 the CEO leads in gold (that seat is you), ⭐ the Director in blue; double-click any seat for an **ID card**
- **⚙ Office Settings**: hire/edit/delete agents (12-face avatar picker, aura picker, job titles), a **✨ prompt copilot** (type a one-line brief in any language → a drafted system prompt), skills library with the auto-learn toggle, built-in tool catalog + MCP servers, and a thread manager
- **🗺 Live map**: a real orthographic floorplan render with live agent icons (face, state ring, name) — click one to chat with it
- **🧵 Threads**: per-conversation chat panes — switching threads or agents loads that conversation's history; a thread bar shows where you are; meetings (🗣 with participant faces) and sub-agent jobs (👻 with the owner's face + ✓/✗/⏳ status) are readable forever, streaming live while they run
- **🗣 Discussions**: launch agent-to-agent meetings
- **🗂 OFFICE OPS**: projects (create / register / open / stop-agent-to-take-over / hide / delete, with an in-house Blender-style folder picker), standing tasks, calendar, the shared note board, and the org chart by tier
- **🔵 NOW WORKING strip**: one calm line under the header — "working on N tasks · latest…" — expandable into the full live task list; visible in feed mode too
- **🔗 CONNECT tab**: API key vault (masked) + Telegram / Discord / LINE / Slack / WhatsApp / Messenger channel setup with live status dots
- **📡 Feed mode**: right-click the chat head — the panel becomes a translucent right-edge activity stream (scrollback, hover-to-focus, 🧹 clear, actionable permission cards); the wallpaper stays clean for streaming/recording
- **🎤 Push-to-talk**: hold **Right Ctrl** anywhere in Windows, speak (Windows Voice Typing — Thai works), release; a pulsing live pill shows what was heard; feed mode auto-sends to the Director (the Right Ctrl global hotkey is Windows-only for now — on macOS/Linux use the in-overlay mic button)
- **🌗 Atmosphere picker**, slide-over **🛡 Security/Mission/Office-Log sidebar** (edge handle pulses when an approval is waiting; pops open on arrival)
- **🔄 Update banner** when a new version lands on GitHub — one click updates and relaunches
- Circular **chat head** (Messenger-style, never steals focus) + system tray (Start with Windows, **Hide office**, Exit)

## Architecture

```
┌─ Overlay (Rust shell / browser) ────────────┐   ┌─ Godot 4 Wallpaper ────────────┐
│  chat·threads · settings · map · approvals  │   │  swappable 3×3 grid·countryside│
│            ▲ WebSocket /ws                  │   │  agents walk (A*) · FX · clock │
└────────────┼────────────────────────────────┘   │        ▲ WebSocket /ws  ▼ /pos │
             │                                    └────────┼────────────────────────┘
┌────────────┴─────────────────────────────────────────────┴───────────────────────┐
│  DAEMON (Node.js, zero-dep)                    http://127.0.0.1:8787              │
│  • broadcast + journal.jsonl (replay on connect) + registry.json + sessions.json  │
│  • POST /chat  → headless `claude -p` (persona+skills+tools, --resume threads)    │
│  • POST /event ← Claude Code hooks (your own sessions feed the world)             │
│  • POST /perm/request ←(long-poll)─ PreToolUse hook   POST /perm/respond ← UI     │
│  • /registry/* CRUD · /sessions/* · /discuss · /assist/prompt · /map/bg           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Three independent processes: the **daemon** keeps agents running even if rendering dies; the **renderer** can crash/restart and rebuild from the journal + registry; the **overlay** is just a web client. Truth lives in the daemon; the world is a renderer of truth.

## Repository structure

```
├── README.md                  ← you are here
├── docs/                      ← full V1 product-design spec (10 documents)
├── daemon/                    ← Layer 0 (Node.js, no npm install needed)
│   ├── server.js                  … WS hub + journal + registry + adapter + perms
│   ├── constants.js               … shared office constants (skills, tools, agents)
│   ├── tests/                     … automated API tests (node --test)
│   ├── overlay.html               … Layer-2 web overlay (served at /)
│   ├── hook.ps1 / perm.ps1        … Claude Code hook forwarders
│   ├── send.js                    … test event CLI
│   ├── registry.json              … your staff (generated at first run, gitignored)
│   └── sessions.json              … chat threads + history (generated, gitignored)
├── godot/                     ← Layer 1 (Godot 4.6 project)
│   ├── scenes/office_floor.tscn   … main scene (env: sky IBL, SSR, cinema pass)
│   ├── scripts/grid_world.gd      … the swappable 3×3 room grid (rooms/furniture/A*/swap)
│   ├── scripts/world_builder.gd   … shares the grid + sky/countryside/clock/billboard/Ghost Deck
│   ├── scripts/agent_manager.gd   … events → characters choreography + FX + camera focus
│   ├── scripts/agent_sprite.gd    … spritesheet characters, auras, identity, seating facing
│   ├── scripts/map_editor.gd      … the 3D Office Editor (room swap + furniture/import)
│   ├── scripts/camera_rig.gd      … cinematic drift + interest-shot focus
│   ├── scripts/hud.gd             … nameplates (rank dressing), HUD FX, whiteboard
│   ├── scripts/fx_factory.gd / aura_factory.gd … pixel-FX flipbooks + elemental auras
│   ├── scripts/cat_sprite.gd / dog_sprite.gd / bird_sprite.gd / rec_ball.gd … ambient life
│   ├── scripts/office_floor.gd    … day cycle, boot, wallpaper/editor/screenshot modes
│   ├── scripts/event_client.gd / layout_loader.gd … WS client + Office Editor layout
│   ├── shaders/                   … cinema focus, grass wind, god rays, grain…
│   └── assets/BinbunVFX_Vol2/     … Elemental Magic FX (CC0 — bundled)
├── shell/                     ← THE program (Rust, wry + tao): one exe runs it all
├── cli/bagidea.js             ← the `bagidea` command (talks to the daemon)
├── plugins/                   ← the built-in 🎵 music plugin ships here; Hub/CLI installs land here
├── installer/                 ← install.ps1 (clone+build) · update.ps1 · build-release.ps1
├── web/                       ← official website (landing + browsable docs, static host)
├── tools/wallpaper.ps1        ← manual attach/detach (the shell does this natively)
├── workspace/                 ← cwd for adapter-spawned Claude sessions
│   └── .claude/settings.json      … PreToolUse permission hook wiring
└── .claude/settings.json      ← hooks: your Claude Code sessions → the office
```

## Requirements

| Component | Requirement |
|---|---|
| OS | Windows 11 · macOS 13+ (beta) · Linux (experimental) — wallpaper backend: WorkerW / DYLD shim / X11 EWMH (Wayland → fullscreen-below) |
| Renderer | [Godot 4.6+](https://godotengine.org/download) (standard build) |
| Daemon | [Node.js](https://nodejs.org) 18+ (no npm packages needed) |
| Agent | [Claude Code CLI](https://claude.com/claude-code) (`claude --version` ≥ 2.x) |
| Shell | Rust toolchain (`cargo`) — or use a browser for the overlay |
| GPU | Anything Vulkan-capable; verified on GTX 1060 6GB |

## Installation

### One-shot installer — the recommended way

This is the most reliable path: **one line**, and it sets everything up. On a
**bare machine** it installs Git, Node LTS, Godot 4.6.3 and the Claude Code CLI and
**downloads a prebuilt app** — so a normal install needs **no Visual Studio C++
Build Tools and no Rust** (those are only fetched as a source-build fallback if no
prebuilt matches). It then clones the app to `%LOCALAPPDATA%\BagIdeaOffice`
(Windows) or `~/BagIdeaOffice` (macOS/Linux), brands the window icon, wires the
`bagidea` command into your PATH and creates a Start Menu shortcut or Bin link.
Freshly installed tools are pulled onto the current PATH so it finishes in one
pass. Safe to re-run (it does a `git pull` and keeps your data). No winget? It
still works — Git and Node are downloaded directly.

**Windows:**
```powershell
irm https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install.ps1 | iex
```

**macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install-mac.sh | bash
```

**Linux (Ubuntu/Debian — 🧪 experimental):**
```bash
curl -fsSL https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install-linux.sh | bash
```
> 🧪 **Linux is experimental** — please help us harden it! On **X11/Xorg** the office
> renders as the live desktop wallpaper; on **Wayland** it falls back to a fullscreen
> window pinned below. If the build or wallpaper doesn't work on your distro/DE, please
> [open an issue](https://github.com/bagidea/bagidea-office/issues) with your distro,
> desktop, and `echo $XDG_SESSION_TYPE`.

> First time only: open a **new** terminal, run `claude` once to log in to Claude,
> then `bagidea start`. Safe to re-run — a re-run does a `git pull` and your data is kept.
> Install didn't finish? See **[troubleshooting → install](docs/guide/troubleshooting.md#installation-problems)**
> (covers winget, the C++ Build Tools / linker error, PATH, SmartScreen).

### Alternative — via npm (optional)

Already have [Node](https://nodejs.org)? `npx bagidea` is just a thin wrapper that
runs the **same one-shot installer** above for your platform — you don't need to
run both, it's simply another way to kick off the same install. Published on npm as
[`bagidea`](https://www.npmjs.com/package/bagidea) (and the longer
[`bagidea-office`](https://www.npmjs.com/package/bagidea-office) — both work).

```sh
npx bagidea
```

Either way you'll still need [Claude Code](https://claude.com/claude-code).

### macOS installation

1. Download **Godot 4.6.x macOS (universal)** and unzip `Godot.app` to `godot/bin-mac/Godot.app`.
2. Run the build script to compile the shell, shim, and wire hooks:
```bash
./build-mac.sh
```
3. Add the `bagidea` command to your PATH:
```bash
export PATH="$(pwd)/bin:$PATH"
```
4. Run it: `shell/target/release/bagidea-office-shell`

### Manual (Windows)

```powershell
git clone https://github.com/bagidea/bagidea-office.git
cd bagidea-office
```

**1. Fix absolute paths** (one-time): the hook configs reference absolute paths. Update these to your clone location:

- `.claude/settings.json` — 3× path to `daemon\hook.ps1`
- `workspace/.claude/settings.json` — 1× path to `daemon\perm.ps1`

**2. Build the shell:**

```powershell
cd shell
cargo build --release   # → shell/target/release/bagidea-office-shell.exe
```

## Art assets

All the visuals and sounds **ship in the repo** — a fresh install and every
`bagidea update` carry the full look and feel out of the box. No separate
downloads, no Godot import step: everything loads at runtime (and still falls
back to a procedural placeholder for anything ever missing). The packs are free /
CC0, made possible by these creators — **thank you** 🙏:

- **Auras** — [Elemental Magic FX by Binbun3D](https://binbun3d.itch.io/elemental-magic-fx) (CC0)
- **Characters** — [Customizable Characters Top-Down 32x32 by Schwarnhild](https://schwarnhild.itch.io/customizable-characters-top-down-32x32)
- **The office cat** — [Cat 2D Pixel Art by xzany](https://xzany.itch.io/cat-2d-pixel-art)
- **Environment (sci-fi kit)** — [Molten Maps SciFi Asset Pack](https://moltenmaps.itch.io/molten-maps-scifi-pack)
- **Countryside** — a free low-poly environment pack (FBX)
- **Event FX** — [Super Pixel Effects Gigapack (Free) by untiedgames](https://untiedgames.itch.io/super-pixel-effects-gigapack)
- **Pets & ambience** — free dog, sound and household packs bundled under `godot/assets/`

## Running the full stack

**One exe runs everything:**

```powershell
.\shell\target\release\bagidea-office-shell.exe
```

The shell spawns the daemon, launches the Godot office (hidden behind a pulsing
logo splash until the first frame renders), embeds it behind your desktop icons,
then brings in the chat head and the tray icon. A second launch exits instantly
(single-instance mutex). Set `BAGIDEA_GODOT` if your Godot binary lives somewhere
other than `E:\Tools\Godot\Godot_v4.6.3-stable_win64.exe`.

- **Chat head**: circular, draggable, never steals focus; click = show/hide the overlay
- **System tray**: left-click toggles the chat; menu has **Start with Windows**
  and **Exit BagIdea Office** — the only true exit (tears the stack down and
  restores your wallpaper)

Manual/dev mode still works:

```powershell
node daemon\server.js
# windowed: open the Godot project normally
# screenshot: godot --path godot -- --shot --hour=13 --cloudtest
```

## Using it

### Hire your team
⚙ → AGENTS → **Hire a new agent**: pick one of 12 faces, an aura, a job title,
then either write the system prompt yourself or type a one-line brief
(any language) and hit **✨ Draft** — a real Claude call writes the persona.
Assign skills (pick from the **15 builtin capability packs** or your own) and
tools with chips. Everything is editable later; deleting an agent warps them out
of the office. `main` and `ceo` are protected. The office caps at **18 staff**
(the CEO isn't counted) — sub-agent 👻 ghosts cover parallel load beyond that.

### Chat
Click a face in the rail (or on the 🗺 map) and type. Each agent keeps
continuous memory; use 🧵 to start a fresh thread or jump back into an old one —
the pane shows that conversation's history. Threads are managed (and deletable)
under ⚙ → THREADS.

### Command through the CEO
Type into the **CEO seat** (the gold one — that's you): the Director walks over,
takes your order, answers with a plan, and delegates real work to the team —
watch the hand-offs happen on the wallpaper.

### Let them talk to each other
🗣 → pick 2–4 agents + a topic + rounds: they gather in the meeting room and
discuss over a shared transcript; minutes land on the in-world whiteboard.

### Watch your own Claude Code sessions
Any Claude Code session inside this project reports its prompts and tool calls
through hooks — the **Director** works at his desk in real time while you work.

### Approve dangerous tools
When a session needs a tool you haven't granted, its character walks to
Security and the overlay pops the exact command with Allow / ✓✓ Forever / Deny.
Granted tools run silently.

### Work in real projects
🗂 → PROJECTS: define a PLACE once (`"classroom" → D:\Learning`), then just tell
the Director: *"create a project called Calculator in classroom, and have Flamingo
build a calculator web app in it"* —
the project folder is created, registered, and the assignee works **inside** it
with a real resumable session. The row lights up with who's working; ▶ opens
*the* project window. **One occupant at a time:** while an agent works it you
can't open it (a **⏹ stop-agent** button with a two-click confirm lets you take
over), and while you have it open an agent won't enter. ✕ unregisters (and
closes the window); 🗑 really deletes (created-by-app folders only, leftover dev
servers are swept first).

### Talk to it from your phone
⚙ → 🔗 CONNECT: paste a Telegram bot token (60 seconds with @BotFather) and your
office answers you anywhere. Discord and LINE work too —
[setup guide](docs/guide/channels.md).

### Speak instead of typing
Hold **Right Ctrl**, talk, release. In normal mode the words land in the input box for
you to review; in 📡 feed mode they're sent to the Director automatically.
(Right Ctrl is Windows-only for now — on macOS/Linux use the in-overlay mic button.)

### Simulate events (no Claude needed)
```powershell
node daemon\send.js task.started rin
node daemon\send.js perm.requested rin
node daemon\send.js task.completed rin
node daemon\send.js agent.offline rin
```

## The `bagidea` CLI

The installer puts `bagidea` on your PATH (manual installs: the repo root has
`bagidea.cmd`). It talks to the running office — and can start it.

```
bagidea start | stop | restart    launch / stop / restart the whole suite
bagidea status                    health + agents + projects + who's working
bagidea stats                     dashboard: runs / cost / busiest / uptime
bagidea ask "<message>"           ask the Director and WAIT for the final answer
bagidea chat <agent> "<msg>"      fire-and-forget to a specific agent
bagidea agents | projects         list staff / projects with live status
bagidea brains                    per-agent model/provider + context status
bagidea jobs                      list scheduled / recurring jobs
bagidea editor                    open the 3D Office Editor
bagidea open "<project>"          open a project window (same as ▶)
bagidea proposals                 team project pitches awaiting a verdict
bagidea proposal show <id>        read a pitch in full
bagidea proposal approve|reject <id> [note]   decide (+ optional note to the team)
bagidea plugins                   list installed plugins
bagidea plugin install <git-url>  add a plugin · plugin remove <id>
bagidea lang [code]               show / set the office language (14 languages)
bagidea say "<text>" | voices     speak via TTS / list voice presets
bagidea image "<prompt>"          generate an image into the office
bagidea channels | keys           channel + API-key status
bagidea key set <NAME> <value>    store an API key in the vault (env-injected)
bagidea feed                      live office event stream in your terminal
bagidea auto [on|off]             🤖 keep-going mode — decide and finish, don't wait
bagidea trust [allow|deny] "<p>"  🛡 projects whose own hooks await your word
bagidea eco [on|off]              🌱 eco mode — cut idle token burn
bagidea export [file] | import <file>   move your whole office to another machine
bagidea startup [on|off]          launch the office with Windows (show/set)
bagidea update                    update to the latest version + relaunch
bagidea version                   current build + whether an update is out
bagidea uninstall [--keep-data]   remove the app (PATH, shortcut, autostart, files)
bagidea --help | --version        full command list / current build
```

Full reference: [`docs/guide/cli.md`](docs/guide/cli.md).

## HTTP API

| Endpoint | Purpose |
|---|---|
| `POST /chat` `{agent, prompt, session?}` | run a real session (`session:"new"` forks a thread) |
| `GET /sessions?agent=` · `GET /sessions/log?agent=&key=` · `POST /sessions/delete` | threads |
| `GET /registry` · `POST /registry/agent` · `POST /registry/agent/delete` | staff CRUD |
| `POST /registry/role` · `/registry/skill` · `/registry/mcp` · `/registry/autoskills` | libraries |
| `POST /assist/prompt` `{name, role, brief}` | ✨ persona copilot (fills every field + picks fitting skills/tools) |
| `GET/POST /jobs` · `POST /jobs/update` | standing work orders (now / at / every) |
| `GET/POST /notes` | shared note board (mirrors `workspace/notes.md`) |
| `GET/POST /calendar` | appointments + Director reminders |
| `POST /registry/heartbeat` `{min}` · `/registry/sound` | Director heartbeat · sound toggle |
| `POST /registry/autopilot` `{enabled}` | 🤖 AUTO keep-going mode (office-wide, off by default) |
| `POST /discuss` `{agents[], topic, rounds}` | agent-to-agent meeting |
| `POST /ui/daylight` `{hour: 17.5 \| "auto"}` | atmosphere override |
| `POST /event` | push any OEP event (custom integrations) |
| `GET /map/bg` · `POST /pos` | live map plumbing |
| `POST /perm/request` (long-poll) · `POST /perm/respond` `{id, decision, always?}` | permission broker |
| `GET /project/trust` · `POST /project/trust` `{id, decision}` | projects whose own `.claude` hooks await approval (work there is parked until answered) |
| `GET /projects` · `POST /projects` `{name, place\|path \| remove \| removeDisk}` | projects (removals are human-UI-only) |
| `POST /projects/open` `{id, mode: play\|shell\|folder}` · `/projects/hide` · `/projects/resume` · `/projects/stop` · `/projects/stopwork` | project windows (▶ = smart open; locked while an agent works — `stopwork` takes over) |
| `GET /fs?dir=` · `POST /fs/mkdir` | in-house folder picker |
| `POST /places` `{name, folder \| remove}` | PLACE shorthands |
| `POST /registry/key` `{name, value \| remove}` | API key vault (env injection) |
| `POST /registry/channel` `{kind, config}` · `GET /channels/status` | Telegram / Discord / LINE / Slack / WhatsApp / Messenger |
| `POST /channels/line/webhook` | LINE Messaging API webhook target |
| `POST /chat` with `wait: true` | hold the response until the run finishes (the CLI's `ask`) |
| `POST /update` | run the updater (human-UI-only) |
| `GET /version` | local + latest-released version + updateAvailable |
| `GET/POST /startup` | read / toggle launch-with-Windows (HKCU Run key) |
| `POST /voice/transcribe` (WAV body) | speech → text (Whisper / Gemini) |
| `POST /tts` `{text, preset\|agent}` · `GET /tts/presets` | agent text-to-speech |
| `WS /live?agent=` | realtime voice relay to Gemini Live |
| `POST /gen/image` `{prompt}` | AI image → PNG in uploads |
| `POST /upload` (file body) · `GET /uploads/…` · `GET /media?p=` | attachments + media render |
| `POST /registry/key` `{name,value\|remove}` | main + extra API keys |
| `GET /features` · `GET /stats` | feature gates · dashboard data |
| `GET/POST /office-md` | shared OFFICE.md memory |
| `GET /proposals` · `POST /proposals/respond` | team project pitches |
| `POST /registry/tts` · `/registry/social` · `/registry/lang` | voice · social · language |
| `POST /registry/key/test` | verify a main key works |
| `GET /plugins` · `POST /plugins/reload` · `/plugin/<id>/...` | plugin host |
| `GET/POST /layout` | Office Editor layout (→ `layout.changed`) |
| `GET /health` | liveness (`{clients, pendingPerms, wt}`) |

## Event protocol (OEP)

One JSON event per WebSocket message / journal line: `{type, agent, task?, tool?, text?, session?, ts}`.

| Type | World reaction |
|---|---|
| `agent.online` / `agent.offline` | walks in via the entrance / walks to a bunk and sleeps |
| `task.started` / `task.progress` / `task.completed` / `task.failed` | desk + board card; ✅/❌ FX |
| `perm.requested` / `perm.approved` / `perm.denied` | Security walk + ❗; 👍/👎 |
| `chat.message` | speech-bubble status + 🎵 + thread history |
| `collab.started` / `collab.ended` (`agents[]`) | meeting table + whiteboard minutes |
| `subagent.split` / `.spawned` / `.progress` / `.done` (`sub`) | ghost clones float up to the Ghost Deck, work, dissolve back |
| `skill.created` | golden burst + "📚 learned" |
| `ceo.summon` / `task.delegated` | the Director's chain-of-command walks |
| `roster.sync` / `roster.removed` | registry → world (spawn/update/despawn) |
| `reminder` | the Director walks over and tells you in person 🔔 |
| `ceo.report` | the Director walks the final summary to the boss 📨 |
| `channel.message` | a message arrived from Telegram / Discord / LINE / Slack / WhatsApp / Messenger 📨 |
| `projects.changed` | project list/status flipped (live UI refresh) |
| `update.available` | main's `VERSION` is newer than local — the 🔄 banner appears |
| `ui.daylight` | atmosphere override |

Push your own events from anything: `POST /event` — that's the whole integration
story for custom agents. New WS clients receive a journal replay plus a fresh
roster snapshot.

## Performance

Wallpaper rung: 30 fps cap, native-res render + MSAA 2×, SSR trimmed, volumetrics
replaced by god-ray cards, no SSAO/DOF. On a GTX 1060 @1680×1050 the full scene
(countryside, grass field, clouds, cinematic pass) measures roughly 20–30% GPU —
the renderer pauses entirely when occluded by fullscreen apps. Plenty of knobs
remain (FSR scale, grass density, cinema pass) if you want it leaner.

## User guides

The full step-by-step guides, with screenshots:

| Guide | What's in it |
|---|---|
| [Getting started](docs/guide/getting-started.md) | install · first launch · your first chat with the Director |
| [The ecosystem](docs/guide/ecosystem.md) | why it's more than agents — collaboration · compounding knowledge · self-extension |
| [Agents & skills](docs/guide/agents.md) | hiring · persona · skills/tools · Security Center · 🤖 AUTO keep-going mode |
| [Projects](docs/guide/projects.md) | places · create/open/watch/delete · 🛡 registering a folder someone else wrote |
| [Office Ops](docs/guide/office-ops.md) | scheduled & recurring jobs · calendar · note board · org chart |
| [Models & providers](docs/guide/models.md) | swappable brains · per-agent model · 19 providers · live model lists · fallback brain |
| [Cost & vision](docs/guide/cost-and-vision.md) | spend less per token · route work to a cheap/free brain · give agents eyes |
| [Local models (Ollama)](docs/guide/ollama-local.md) | run agents on your own machine, no API key |
| [AI features](docs/guide/ai-features.md) | main keys · TTS/realtime voice · images · memory · social life |
| [Voice & feed mode](docs/guide/voice-feed.md) | Right Ctrl push-to-talk · feed mode · NOW WORKING strip |
| [Web automation](docs/guide/web-automation.md) | let an agent drive a real browser |
| [Meetings](docs/guide/meetings.md) | agent-to-agent discussions and what comes out of them |
| [Workflow Builder](docs/guide/workflows.md) | plan work as plain-language nodes, let the Director analyze it |
| [Plugins](docs/guide/plugins.md) | the extension system · music player · writing your own |
| [Plugin Hub](docs/guide/plugin-hub.md) | browse, install and publish community plugins |
| [Showcase](docs/guide/showcase.md) | get your office, project or plugin featured |
| [Office Editor](docs/guide/editor.md) | furniture/walls · swap rooms · import your own models & images |
| [Channels](docs/guide/channels.md) | connect Telegram / Discord / LINE / Slack / WhatsApp / Messenger |
| [CLI](docs/guide/cli.md) | every `bagidea` command with examples |
| [Updates](docs/guide/updates.md) | the update system + the installer |
| [Sponsoring](docs/guide/sponsors.md) | tiers, how logos appear, how the wall updates |
| [Troubleshooting](docs/guide/troubleshooting.md) | common problems and how to fix them |

## Design documents

The `docs/` folder is a complete V1 product-design specification written before
the first line of code — 14-zone world design, agent behavior simulation
(honesty contract: *nothing tagged is fake*), scaling to 100+ agents,
progression, monetization, and the competitive thesis
([doc 10](docs/10-revolutionary-features.md): *"cockpits make agents usable;
this makes them employable"*).

## Roadmap

- [x] Characters, sci-fi furniture kit, glass-walled shell, countryside
- [x] Meeting Room choreography, Server Room, Dormitories, Recreation Room (dog!)
- [x] One-exe suite: chat head + overlay + tray + auto-start + single-instance
- [x] Live meeting whiteboard
- [x] Agent registry: hire/edit/delete, avatars, auras, ✨ prompt copilot
- [x] Skills library + Hermes-style auto-learning; tools + MCP servers
- [x] Live top-down map, chat threads with history, CEO chain of command, discussions
- [x] Day/night + manual atmosphere, roofline clock, ambient life, event FX
- [x] **Sub-agents** — agents split into parallel ghost clones on the floating
      Ghost Deck (`SUB:` protocol, per-ghost sessions, auto-synthesis)
- [x] **Projects** — agents work inside real folders with resumable sessions;
      one window per project, one occupant at a time (stop-agent-to-take-over lock)
- [x] Permission policies — granted tools run silently, ✓✓ forever grants
- [x] Voice — Right Ctrl push-to-talk over Windows Voice Typing (Thai works)
- [x] 📡 Feed mode, NOW-WORKING strip, Office Ops (jobs/calendar/notes/org)
- [x] **Channels** — Telegram / Discord / LINE → the Director
- [x] API key vault, `bagidea` CLI, one-shot installer + self-updater
- [x] Voice engine v2 (Whisper/Gemini), agent TTS voices, **realtime voice** (Gemini Live)
- [x] Channels (Telegram / Discord / LINE / Slack / WhatsApp / Messenger) → CEO flow
- [x] Hermes-style memory (OFFICE.md + per-agent), main keys + feature gates
- [x] Attachments & inline media, AI image generation system tool
- [x] Social office + project proposals, dashboard, CLI v2
- [x] **Plugins** (host + music player + SDK), **Office Editor** (place/import), **i18n**, official **website**
- [x] **Swappable 3×3 room grid** — rearrange the floor; furniture, anchors, nav and pets follow
- [x] **Plugin ecosystem** — core vs installed plugins, 🧮 Calculator, GitHub install, official template + example repos
- [x] **14-language UI**, **builtin agent skill library** (15 packs), open-source clone+build installer, `bagidea restart`
- [x] **Social groups** (3–4 agents) → plugin-oriented proposals with approve/reject notes; **main-only calls** with assigned voices
- [ ] Wake word; channel round-trip reports (delegate results back to the channel)
- [x] macOS wallpaper backend (beta)
- [x] Linux wallpaper backend (experimental — X11 EWMH; Wayland fullscreen-below fallback)
- [ ] Signed binary releases (skip the Rust build on install)

## Contributors

Built in the open, with help from the community. A huge thank you to everyone who's
shaped BagIdea Office — by sending a pull request, reporting a bug, or testing on a
platform we couldn't reach.

<table>
  <tr>
    <td align="center" valign="top" width="120">
      <a href="https://github.com/bagidea"><img src="https://github.com/bagidea.png?size=100" width="72" alt="@bagidea"><br><sub><b>@bagidea</b></sub></a><br><sub>Creator &amp; maintainer</sub>
    </td>
    <td align="center" valign="top" width="120">
      <a href="https://github.com/spondanai"><img src="https://github.com/spondanai.png?size=100" width="72" alt="@spondanai"><br><sub><b>@spondanai</b></sub></a><br><sub>macOS support</sub>
    </td>
    <td align="center" valign="top" width="120">
      <a href="https://github.com/misternay"><img src="https://github.com/misternay.png?size=100" width="72" alt="@misternay"><br><sub><b>@misternay</b></sub></a><br><sub>macOS / Linux fixes</sub>
    </td>
    <td align="center" valign="top" width="120">
      <a href="https://github.com/skiyo0177-lgtm"><img src="https://github.com/skiyo0177-lgtm.png?size=100" width="72" alt="@skiyo0177-lgtm"><br><sub><b>@skiyo0177-lgtm</b></sub></a><br><sub>i18n (zh/en/ja UI)</sub>
    </td>
    <td align="center" valign="top" width="120">
      <a href="https://github.com/bmdy5"><img src="https://github.com/bmdy5.png?size=100" width="72" alt="@bmdy5"><br><sub><b>@bmdy5</b></sub></a><br><sub>Markdown rendering</sub>
    </td>
  </tr>
</table>

Much of the implementation was pair-built with **[Claude Code](https://claude.com/claude-code)** 💜

See **[CONTRIBUTORS.md](CONTRIBUTORS.md)** for what each person built. PRs welcome — every
merged contribution is credited there and on the Contributors graph.

## License

[MIT](LICENSE) © BagIdea — free to use, modify and share. Bundled art/sound packs keep their own (free/CC0) licenses; see [Art assets](#art-assets).

---

*Built with [Claude Code](https://claude.com/claude-code) — design docs in the morning of day one, a full agent-office product by sunrise of day two.*
