# BagIdea Office — Demo Storyboard (local notes, do not commit/publish)

The single most important launch asset. Goal: a clip whose **first 3 seconds** make a
stranger think *"wait, that's my actual wallpaper?"* and whose payoff proves **truth,
not theatre** (a real permission prompt firing as an agent walks to Security).

Produce **two cuts from one recording**:
- **Hero GIF — 12–18s, silent, autoplay-loop** → README top, npm page, X/Reddit/PH gallery slot 1.
- **Full demo — 45–75s, with VO or captions** → YouTube, Product Hunt video, LinkedIn.

Record at **1920×1080, 60fps** if possible (smooth agent walking). Capture the **whole
desktop** (icons visible — that's the whole point), not just the overlay window.

---

## The Hero cut (12–18s) — shot list

| # | Time | Shot | On-screen caption |
|---|------|------|-------------------|
| 1 | 0:00–0:03 | The desktop as a **living wallpaper** — your real icons on top, agents idling at desks, day/night lighting. Slow, no UI yet. | `This is my desktop wallpaper.` |
| 2 | 0:03–0:06 | You type one order into the chat head (e.g. *"Research X and write a summary"*) and hit enter. | `I gave it one order.` |
| 3 | 0:06–0:10 | The **Director walks** across the floor to an agent's desk and hands off — the camera follows the walk. | `The team takes it.` |
| 4 | 0:10–0:14 | **The payoff:** an agent **walks to Security** and a **real OS permission prompt** pops. Approve it on camera. | `Truth, not theatre — that's a real permission prompt.` |
| 5 | 0:14–0:18 | A monitor **glows** (live tool call) → a finished task card. End on the wide office. | `npx bagidea-office` |

The walk-to-Security + permission prompt (shot 4) is **the** moment. If you only nail one
shot, nail that one — it's the proof the visual maps to something real.

---

## The Full cut (45–75s) — adds, in this order

1. **Hook (0:00–0:08):** the hero shots 1–4 above, tightened.
2. **You're the CEO (0:08–0:20):** show the chat head, give an order in your own words,
   the Director's delegate hand-off, a meeting forming.
3. **It's real (0:20–0:35):** glowing screens = live tool calls; the Security walk =
   permission; a task card going from running → done. Say the line: *"if it's on screen,
   it's really happening."*
4. **It's yours (0:35–0:55):** quick flashes — the 🧩 plugin Hub, swappable model brains
   (Claude → a local model), 14-language switch, voice (F6 push-to-talk).
5. **Close (0:55–0:75):** the wide office at golden hour. Captions:
   `Open source · npx bagidea-office · github.com/bagidea/bagidea-office`

---

## Voiceover / caption script (full cut)

> My desktop wallpaper is an office of real AI agents.
> I'm the CEO — I give one order, and a Director delegates it to the team.
> Nothing here is faked: a glowing screen is a live tool call, and when an agent walks to
> Security, that's a real permission prompt I approve.
> Every character is a real Claude Code session doing real work in real project folders.
> It's open source, speaks 14 languages, and you can swap each agent's brain — Claude, or a
> local model. Install is one line: npx bagidea-office.

Keep VO calm and factual — the "truth, not theatre" angle lands harder understated than hyped.

---

## Capture checklist
- [ ] Clean desktop (a few real icons visible; hide anything private).
- [ ] Office seeded with **3–6 agents** so the floor looks alive (not empty, not a mob).
- [ ] A real project registered so the delegate → work flow is genuine.
- [ ] Trigger a tool that **actually requests permission** so shot 4 is real (not staged).
- [ ] Record 2–3 takes of the Security walk; it's the keeper.
- [ ] Tools: OBS (1080p60) for capture; trim in any editor; GIF via the editor or `ffmpeg`
      (`ffmpeg -i clip.mp4 -vf "fps=20,scale=960:-1" hero.gif`), keep the GIF < ~8 MB for README/npm.

## Where each file goes
- `hero.gif` → `web/img/` (commit) → reference in README top + npm/README.md (absolute Pages URL).
- Full `.mp4` → YouTube (you have the channel) → embed/link on the site + Product Hunt video slot.
- First frame of the Security-prompt moment → a still for the Reddit/HN first comment.
