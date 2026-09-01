# BagIdea Office — Launch Sequence & Timing (local notes)

Copy for every post lives in `promo/LAUNCH.md`. Demo shot list in `promo/DEMO-STORYBOARD.md`.
Times below: **ICT** (your time, UTC+7) with **PT** (US Pacific) in brackets — most dev/tech
audiences peak on US clocks.

## ⛔ The one gate: the demo video/GIF
Nothing launches before the **15–30s demo clip** exists (the wallpaper → agent walks to
Security → real permission prompt → glowing screen). It's the hook for *every* channel.
Record it first (storyboard ready). Everything below assumes it's done + uploaded to YouTube,
and a hero GIF is in `web/img/` + the README/npm pages.

## Pick the day
- **Best: Tuesday or Wednesday.** Avoid Mon (inbox catch-up), Fri/weekends (low dev traffic).
- One **primary launch day**, then stagger the rest over the following ~week so you're not
  firing everything into one hour and so each post gets real engagement.
- You must be **awake and replying for the whole launch day** — maker engagement is what
  ranks HN/PH. The slots below fall in your waking hours (good).

## The sequence

### T-3 → T-1 (prep)
- Finish the demo (YouTube unlisted→public on launch), hero GIF into the repo.
- Re-read each post in `promo/LAUNCH.md`; tweak in your own voice.
- **Warm up Reddit** — some subs auto-remove zero-history accounts. Comment genuinely in
  r/LocalLLaMA / r/selfhosted for a few days first.
- (Optional) line up a **Product Hunt hunter** with a following, or self-launch.
- Prep the PH page: tagline, gallery (GIF first slot!), description, first maker comment,
  topics. PH lets you **schedule**.

### Launch Day (Tue/Wed)
| Time (ICT) | (PT) | Action |
|---|---|---|
| **14:01** | 00:01 | **Product Hunt goes live** (PH day starts midnight PT). Post the maker's-first-comment immediately. |
| 14:10 | 00:10 | Share the PH link to **Discord + Facebook + X** — "we're live on PH, would love your thoughts" (NOT "upvote me" — against PH rules). Your FB buzz is the early-momentum engine. |
| **20:00–21:00** | 06:00–07:00 | **Show HN** post (HN peaks US morning). Title must start `Show HN:`. Post the demo GIF as your **first comment**. |
| 20:15 | 06:15 | **X/Twitter thread** (the 5-tweet thread), linking the HN + PH + repo. |
| all day/evening | | **Reply to every comment within minutes** on HN + PH. This is the single biggest ranking lever. Stay honest about the beta/limitations. |
| ~22:00 | 08:00 | **LinkedIn** one-liner + demo video. |

### Day +1 → +5 (stagger Reddit + content; one per day, US morning ≈ 20:00–23:00 ICT)
- **Day +1:** r/LocalLLaMA (lead with the swappable **local models** angle).
- **Day +2:** r/selfhosted (privacy / runs-on-your-machine angle).
- **Day +3:** r/SideProject (the solo builder story).
- **Day +4:** r/commandline (the headless-agents / `npx` angle).
- **Day +5:** dev.to / Hashnode "How I built an AI agent office on my wallpaper with Claude
  Code" + a YouTube **Short / TikTok / Reel** cut of the demo.
- Each Reddit post is **tailored** (already written per-sub in LAUNCH.md) — never identical
  cross-posts (Reddit flags that), and respect each sub's self-promo rules.

## Rules that keep you from getting nuked
- **Never ask for upvotes** on HN or PH (instant penalty). Share the link; let people decide.
- **Lead with the honest limitations** (Claude key needed, macOS/Linux beta) — on HN and
  r/LocalLLaMA this *buys* credibility.
- **Engagement > blast.** A post you reply to for 6 hours beats five posts you ignore.
- Keep **"truth, not theatre"** consistent everywhere — it's the line people will repeat.

## After the spike
- Pin the best thread; add a "As seen on HN/PH" note to the site if it does well.
- Watch GitHub stars + npm downloads + Discord joins — that's the real signal.
- Submit to **awesome-claude / awesome-ai-agents** lists once you have some stars.
- A v0.9.x release timed ~the launch (fresh release = "actively maintained" signal).
