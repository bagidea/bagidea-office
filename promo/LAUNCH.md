# BagIdea Office — Launch Copy Pack

> **Local-only working notes — do NOT commit/publish.** Ready-to-paste copy for each
> channel. Keep the phrase **"truth, not theatre"** consistent everywhere — it's the
> sharpest differentiator and pre-empts the "is this a gimmick?" reaction. Always keep
> the honest-limitations line (Claude key needed; macOS/Linux beta) — on HN and
> r/LocalLLaMA it buys more credibility than it costs.

> **Demo media (do this first):** the single most important asset is a **15–30s GIF/MP4**
> showing (1) the wallpaper office with characters at desks, (2) a character *walking to
> Security* and a real OS permission prompt popping, (3) a glowing screen = a live tool
> call. That clip is the whole pitch. Drop it where each section says `[DEMO]`.

---

## 1. Show HN

**Title** (strongest first, ≤80 chars):
> Show HN: BagIdea Office – my desktop wallpaper is a team of real Claude Code agents

Alternates:
- Show HN: An HD-2D office on your wallpaper where each character is a Claude Code session
- Show HN: Turn your desktop wallpaper into an AI agent office (open source)

**Body:**

```
I built an open-source app that renders an HD-2D "office" as your actual desktop
wallpaper — behind your icons — where every character is a real Claude Code
session. You're the CEO. You give an order, a Director agent breaks it down and
delegates to the team, and you watch the actual work happen: characters walk to
desks, open files, and run tools in real project folders.

The thing I cared most about is "truth, not theatre." Nothing on screen is a
canned animation. A glowing monitor means a live tool call is running. When a
character walks over to "Security," that's a real permission request — the same
prompt you'd get approving a tool in Claude Code, just dramatized as someone
asking the boss. If a meeting happens, it's because agents are actually
coordinating. I didn't want a fake Tamagotchi; I wanted the wallpaper to be an
honest window into what the agents are really doing.

You can talk to it by voice (F6 push-to-talk) or message it from Telegram,
Discord, or LINE, so you can kick off work from your phone and check the
wallpaper later.

Tech / how it's built:
- The agents are literally Claude Code sessions running headless; the wallpaper
  is a rendered scene layered behind the desktop.
- Extensible: a plugin Hub, MCP tools, an agent skill library, and swappable
  model "brains" per agent (Claude, plus GLM / DeepSeek / Qwen / OpenAI /
  Gemini, and local models via Ollama / LM Studio).
- 14 languages — I built this for a global release from day one.
- MIT licensed. It was itself built with Claude Code.

Honest current limitations:
- You need a Claude subscription or API key for the agents to actually do work.
  (Model brains are swappable, so you can route agents to other providers or
  local models, but the default experience assumes Claude.)
- Windows is the fully-supported target. macOS and Linux are in beta — the
  wallpaper integration is the rough part there.
- It's young. Expect sharp edges, and I'd genuinely value bug reports.

Repo: https://github.com/bagidea/bagidea-office
Site: https://bagidea.github.io/bagidea-office/
Discord: https://discord.gg/WpgGTzApw5

Happy to answer anything about the architecture, the permission model, or the
"is this actually useful or just cool" question (I think it's both, but I'll
take the skepticism).
```

`[DEMO]` — post the GIF as the **first comment** from your own account: "Short clip of a permission prompt firing as an agent walks to Security."

---

## 2. Product Hunt

**Name:** BagIdea Office

**Tagline (~60 chars):**
> Your desktop wallpaper, run by real Claude Code agents

Alternates:
- An AI agent office that lives on your wallpaper
- Watch real AI agents do real work on your wallpaper

**Description:**

> BagIdea Office turns your desktop wallpaper into a living HD-2D office where every character is a **real Claude Code session** — not an animation. You're the CEO: give an order, the Director delegates to the team, and you watch the actual work happen behind your desktop icons. Characters walk to their desks, run real tools in real project folders, hold meetings, and ask for permission with real prompts.

> The principle is "truth, not theatre." A glowing screen is a live tool call. A walk to Security is a genuine permission request. Talk to your team by voice (F6 push-to-talk) or message them from Telegram, Discord, or LINE.

> Free and open source (MIT), available in 14 languages, and fully extensible — a plugin Hub, MCP tools, a skill library, and swappable model brains per agent (Claude, GLM, DeepSeek, Qwen, OpenAI, Gemini, or local models via Ollama / LM Studio). Windows is fully supported; macOS and Linux are in beta.

**Topics / tags:** Artificial Intelligence · Developer Tools · Open Source · Productivity · Desktop · GitHub · Bots

**Maker's first comment:**

> Hey Product Hunt 👋
>
> I'm the maker. I kept seeing AI-agent demos that *looked* alive but were mostly scripted theatre, so I built the opposite: an office on my wallpaper where everything on screen maps to something real. The agents are actual Claude Code sessions. The glowing screens are real tool calls. The "walk to Security" is a real permission prompt — I just dramatized approving a tool as a character asking the boss.
>
> It's MIT-licensed and built with Claude Code itself. You'll need a Claude subscription or API key for the agents to work (though brains are swappable — you can route agents to other providers or local models via Ollama/LM Studio). Windows is the solid path right now; macOS and Linux are in beta and I'd love testers there.
>
> Repo: https://github.com/bagidea/bagidea-office · Discord: https://discord.gg/WpgGTzApw5
>
> Brutally honest feedback very welcome — especially on whether the wallpaper format makes the work *clearer* or just prettier.

`[DEMO]` — PH lives or dies on the gallery. First media slot = autoplay GIF (permission-prompt moment in the first 3 seconds). Slots 2–4: office wide shot, the model-brain switcher UI, the Telegram/Discord control.

---

## 3. Reddit

### r/LocalLLaMA

**Title:**
> I built an open-source "AI office" on my desktop wallpaper — agents are swappable, so you can run the whole team on local models (Ollama / LM Studio)

**Body:**

```
Most of what I see in agent-orchestration demos assumes a cloud frontier model.
I wanted something where the *brains are swappable per agent*, including local
ones, so I'm posting here first.

What it is: an HD-2D office rendered as your actual desktop wallpaper, where each
character is a real agent session doing real work in real project folders. A
Director delegates tasks to the team and you watch it happen behind your icons —
glowing screen = live tool call, not a canned animation.

The local-model bit you'll care about: each agent has a "brain" you can swap.
Out of the box it supports Claude, GLM, DeepSeek, Qwen, OpenAI, Gemini — and
local models served via Ollama or LM Studio. So you can keep sensitive project
work on a local model and only route specific agents to a cloud model if you
want, or go fully local.

It's MIT, 14 languages, extensible via a plugin Hub + MCP tools + a skill
library.

Honest notes: the default/best-tested path uses Claude (it was built with Claude
Code), so the local-only experience is newer and I'd love feedback on which
local models actually hold up for multi-step tool use here. Windows full; macOS
and Linux beta.

Repo: https://github.com/bagidea/bagidea-office

If you run it fully local, tell me which Ollama/LM Studio model you used and how
it did with the tool-calling — that's the data I most want.
```

`[DEMO]` — drop the GIF, plus a still of the **brain/model picker** with a local model selected. This sub respects config detail over eye-candy.

---

### r/selfhosted

**Title:**
> Open-source AI agent "office" that runs on your own machine, in your own project folders — swappable to local models, MIT licensed

**Body:**

```
Sharing a project that fits the self-hosted ethos: it runs locally on your
machine, works on your own project folders, and you can swap every agent's model
brain to a local one (Ollama / LM Studio) so nothing has to leave your box.

It renders an HD-2D "office" as your desktop wallpaper where each character is a
real agent session. You're the CEO; a Director delegates work to the team and
you watch the real work happen. The honest part I care about: a glowing screen
is a live tool call, and when a character "walks to Security" that's an actual
permission request — you approve what agents are allowed to do, not a fake
animation.

Self-hosting / privacy specifics:
- Runs on your own hardware; agents operate in your real local project folders.
- Model brains are swappable per agent — route everything to local models via
  Ollama/LM Studio if you don't want cloud calls.
- Control it locally by voice (F6) or wire it to your own Telegram/Discord/LINE.
- MIT licensed, 14 languages, extensible (plugin Hub, MCP tools, skill library).

Caveats to be upfront about: the best-tested default uses Claude (needs a sub or
API key), so a fully-local setup is the newer path. Windows is fully supported;
macOS and Linux are in beta.

Repo: https://github.com/bagidea/bagidea-office

Would love feedback on the permission model specifically — that's the part that
matters most for letting agents touch real files.
```

`[DEMO]` — GIF plus one line: "No account, no hosted backend — it's a local app; the repo is the whole thing."

---

### r/SideProject

**Title:**
> I turned my desktop wallpaper into an office of AI agents that do real work — built it solo with Claude Code, now open source

**Body:**

```
Builder story. I kept getting distracted by how "alive" AI-agent demos looked
while doing very little real work, and I wanted to flip that: make the
nice-looking thing also be the *honest* thing.

So I built an HD-2D office that renders as my actual desktop wallpaper, behind my
icons. Every character is a real agent session. I'm the CEO — I give an order, a
Director agent delegates to the team, and I literally watch the work happen:
characters walk to desks, run tools in real project folders, hold meetings, and
ask permission with real prompts. The rule I held myself to was "truth, not
theatre" — a glowing screen has to mean a real tool call, or it doesn't glow.

Some things I'm proud of shipping solo:
- Voice control (F6 push-to-talk) + control from Telegram/Discord/LINE.
- 14 languages from launch, because I wanted a global release.
- Swappable model brains per agent + a plugin Hub, MCP tools, a skill library.
- It's MIT, and it was itself built with Claude Code, which felt fitting.

Where it honestly stands: Windows is solid, macOS/Linux are in beta, and you
need a Claude sub or API key for the default experience (brains are swappable to
local/other models though).

Repo: https://github.com/bagidea/bagidea-office
Site: https://bagidea.github.io/bagidea-office/

Happy to share how the "agent → wallpaper render" loop works if anyone's curious.
What would you build with a team of agents on your wallpaper?
```

`[DEMO]` — lead the post with the GIF; the wallpaper "behind the icons" moment is the hook.

---

### r/commandline

**Title:**
> An agent "office" you drive from the terminal — each character is a headless Claude Code session running in your real project dirs

**Body:**

```
Posting here for the CLI angle. Under the pretty wallpaper, this is really a
fleet of headless agent sessions running in your actual project directories — so
the terminal/CLI side may interest this crowd more than the graphics.

What it is: an HD-2D office rendered as your desktop wallpaper where each
character is a real agent session. You issue an order, a Director delegates, and
the agents run real tools in real folders. The visual is just an honest readout
of CLI work — glowing screen = live tool call, "walk to Security" = a real
permission prompt.

CLI-relevant bits:
- The agents are headless sessions operating on your real project dirs, not a
  sandbox toy.
- Real permission gating on tool use (the thing that lets you actually trust an
  agent near your files).
- Extensible with MCP tools and a skill library, and you can swap each agent's
  model brain (Claude / local via Ollama or LM Studio / others).
- Control it by voice (F6) or pipe orders in from Telegram/Discord/LINE.

Straight talk: default path uses Claude (needs a sub/API key). Windows is fully
supported; macOS/Linux beta. MIT licensed.

Repo: https://github.com/bagidea/bagidea-office

Curious what the CLI folks think of the permission-prompt-as-character idea — too
cute, or a genuinely clearer way to see what agents are asking for?
```

`[DEMO]` — pair the GIF with a plain text/asciinema snippet of an agent session if you have one.

---

## 4. X/Twitter + LinkedIn

### X / Twitter thread (5 tweets)

**1/** My desktop wallpaper is now an office of real AI agents.
Not an animation — every character is a live Claude Code session doing real work in real project folders, rendered behind my icons.
Open source. 🧵
`[DEMO GIF — the wide office shot]`

**2/** The rule I built it on: truth, not theatre.
A glowing screen = a real tool call running.
A character walking to "Security" = an actual permission prompt.
If it's on screen, it's really happening.
`[DEMO GIF — the permission-prompt moment]`

**3/** You're the CEO.
Give an order → a Director agent delegates to the team → you watch the work happen on the wallpaper.
Talk to it by voice (F6 push-to-talk), or fire off orders from Telegram / Discord / LINE.

**4/** Under the hood it's open and swappable:
• per-agent model brains (Claude, GLM, DeepSeek, Qwen, OpenAI, Gemini)
• local models via Ollama / LM Studio
• plugin Hub + MCP tools + skill library
• 14 languages
• MIT, built with Claude Code

**5/** Honest status: Windows is solid, macOS + Linux are in beta, and the default experience needs a Claude sub/API key.
Repo 👉 https://github.com/bagidea/bagidea-office
Discord 👉 https://discord.gg/WpgGTzApw5
Tell me what you'd have your agent team build.

### LinkedIn (1-liner)

> I made my desktop wallpaper into a live office of real AI agents — every character is an actual Claude Code session doing real work in real project folders, with real permission prompts ("truth, not theatre"). Open source (MIT), 14 languages, swappable model brains incl. local via Ollama/LM Studio. Windows full; macOS/Linux in beta → https://github.com/bagidea/bagidea-office `[attach the demo video]`
