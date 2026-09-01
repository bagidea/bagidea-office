# Discord — setup to receive a launch wave (copy-paste ready)

Server invite: **https://discord.gg/WpgGTzApw5**. Goal: when people arrive from HN/PH/
Reddit/X/Facebook, they instantly get what it is, how to install, where to ask, and feel
it's alive. Keep it lean — a small server with 8–10 good channels beats 20 empty ones.

---

## 1. Server identity
- **Name:** BagIdea Office
- **Icon:** the logo (web/img/logo.png).
- **About / description:** `A living HD-2D office where every AI agent is a real Claude Code session — on your desktop wallpaper. Open source.`
- Enable **Community** mode (Server Settings → Enable Community) → unlocks announcement channels, welcome screen, rules screening.

## 2. Channels (create these)
**INFO**
- `📢-announcements` (announcement channel, read-only) — releases + launch news
- `👋-start-here` (read-only) — the welcome message below + install + links
- `📜-rules` (or use the Community Rules screen)

**COMMUNITY**
- `💬-general` — main chat
- `🆘-help` — install / usage problems
- `🐛-bug-reports`
- `💡-ideas-feedback` — feature requests, suggestions
- `🎨-showcase` — share your office / screenshots / what your agents built
- `🔌-plugins` — plugin dev + sharing

**REGIONAL / OFF-TOPIC**
- `🌍-international` (English) and `🇹🇭-ไทย` (Thai community)
- `☕-off-topic`

**(optional) DEV**
- `🔧-contributors` — for PR/contributor talk

## 3. Roles
- **@Maintainer** (you) — admin, colored.
- **@Contributor** — merged a PR (color, e.g. green). Hand out as people contribute.
- **@Early Supporter** — anyone who joined around launch (a nice badge to reward early folks).
- **@Member** — default.
- (optional) reaction-role for `@announcements ping` so people opt into release pings.

## 4. `👋-start-here` welcome message (pin this)

```
# 👋 Welcome to BagIdea Office

Your **desktop wallpaper** becomes a living HD-2D office where every AI agent is a real
**Claude Code** session — they walk to their desks, run real tools in real project folders,
hold meetings, and ask permission with real prompts. You're the CEO. **Truth, not theatre.**

**▶ See it in action:** https://bagidea.github.io/bagidea-office/

**⚡ Install (one line):**
```
npx bagidea
```
Windows (full) · macOS / Linux (beta). You'll need Claude Code (a Claude subscription or API
key). Brains are swappable per agent — Claude, GLM, DeepSeek, Qwen, OpenAI, Gemini, or local
via Ollama / LM Studio. Free & open source (MIT).

**🔗 Links**
• Website — https://bagidea.github.io/bagidea-office/
• GitHub — https://github.com/bagidea/bagidea-office
• Docs — https://github.com/bagidea/bagidea-office/tree/main/docs/guide
• YouTube — https://www.youtube.com/bagidea

**Where to go**
• 🆘 `#help` — stuck installing or using it
• 🐛 `#bug-reports` — found a bug
• 💡 `#ideas-feedback` — want a feature
• 🎨 `#showcase` — show off your office!
• 🔌 `#plugins` — build/share plugins

Glad you're here — drop a 👋 in `#general` and tell us what you'll have your agents build.
```

## 5. `📜-rules`
```
1. Be kind and helpful — we're all here to build cool things.
2. English in the main channels; Thai in #🇹🇭-ไทย.
3. Use the right channel (help vs bug vs idea) so nothing gets lost.
4. No spam, no self-promo of unrelated products, no NSFW.
5. Search/skim before asking — but don't be shy, we're friendly.
6. Bug reports: include your OS, what you did, and any error text.
```

## 6. `📢-announcements` — launch-day post
```
@everyone 🚀 **BagIdea Office is live!**

Your desktop wallpaper is now an office of real AI agents — open source, 14 languages,
one-line install: `npx bagidea`

We're posting around the web today — if you like it, a comment/upvote means the world 🙏
• Product Hunt: <PH link>
• Show HN: <HN link>
• Demo: https://www.youtube.com/bagidea

Hang out in `#general`, share what you build in `#showcase`, and ping `#help` if you get stuck.
Thank you for being here early 💜
```
> Drop the PH/HN links in once they're live. (On HN/PH never *ask* for upvotes publicly —
> but in your own Discord it's fine to say "we'd love your support.")

## 7. Before you open the doors (5-min checklist)
- [ ] Community mode on; welcome screen points to `#start-here`.
- [ ] `#start-here` + `#rules` posted & pinned.
- [ ] A few channels seeded with a first message (so it's not empty when people arrive).
- [ ] Invite link set to **never expire** (discord.gg/WpgGTzApw5 ✓).
- [ ] You (and any helpers) online to greet the first arrivals on launch day.
- [ ] The Discord link is in every launch post + the website footer (✓ already on the site).
