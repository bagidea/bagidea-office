# Changelog

All notable changes to BagIdea Office. A **release** is a deliberate `VERSION`
bump on `main` (see [RELEASING.md](RELEASING.md)) — that's what triggers the
in-app 🔄 update banner. Versions follow [semver](https://semver.org).

## [1.0.4] — 🛠 A blank window that finally says what's wrong

From a real deployment: a machine built for a customer to run local LLMs came up
with a chat window that showed **nothing at all**. Two separate things were
wrong, and neither of them said a word on screen. The engineer who set it up had
installed on dozens of machines without ever hitting either, and had to go
through the firewall and the proxy by hand while the customer sat in front of an
empty window.

**Fixed**
- **The installer could finish “successfully” with no Claude Code CLI at all.**
  PowerShell's *default* execution policy is `Restricted`, and in PowerShell
  `npm` resolves to **`npm.ps1` — a script**, so `npm install -g
  @anthropic-ai/claude-code` was refused outright:
  *“npm.ps1 cannot be loaded because running scripts is disabled on this
  system.”* The installer then printed **“+ installed”** regardless. Every agent
  in the office is a claude session, so that is the entire product failing to
  install and being reported as a success. It now calls **`npm.cmd`** (which no
  policy can block), lifts the policy for its **own process only** (never
  written to the registry, machine untouched), and **verifies `claude` is
  actually on PATH** before saying anything — with the real fix printed if it
  isn't.
- **A window that could not reach the daemon showed an empty rectangle.** The
  whole UI is served from `127.0.0.1:8787`; if something on the machine stands
  between the two, the window painted nothing — no text, no error, no hint. It
  now waits up to 25s for a slow daemon (a cold boot must never be reported as a
  blocked machine) and otherwise shows an **embedded** page naming the three
  causes — proxy, firewall, daemon not started — and pointing at `bagidea
  doctor`. It retries on its own with a backoff, so a daemon that was merely
  slow heals with nobody touching it.

**Added**
- **`bagidea doctor`** — the diagnostic that support call needed. It checks
  whether anything answers on `127.0.0.1:8787` (and tells a *refused* connection
  apart from a *hang* — they mean different things), whether a system proxy or
  PAC script covers local addresses, whether `HTTP_PROXY` is set without
  `NO_PROXY`, whether the execution policy will refuse `claude` and `npm`, and
  whether the Claude Code CLI is installed at all. Each finding prints the fix
  beside it. It runs **without the daemon** — that is the case it exists for.
- **The installer asks about the persistent policy.** Your terminal still needs
  it for `claude`/`npm` afterwards, so it explains the two ways out and offers
  to set `RemoteSigned` for **your user only**. It never lowers a machine's
  script policy silently — on a customer's machine that is not even the
  installer's call to make. `BAGIDEA_SET_EXECUTION_POLICY=1` for unattended runs.
- **`daemon/tests/unreachable-office.test.js`** — nine tests over the two
  failures: no bare `npm` in the installer, the policy lifted at process scope
  only, the success message guarded by a real check, the daemon given time
  before being declared unreachable, the offline page naming the causes without
  fetching anything, and doctor's bypass-list parsing (`<local>`, `127.0.0.1`,
  `localhost` — but not a list that only covers the corporate network, which is
  the configuration that breaks it). Run against the pre-fix code: **six of the
  nine fail.**

**Docs** — troubleshooting now opens with `bagidea doctor`, adds a section on the
blank window (proxy, PAC, firewall, `NO_PROXY`), and documents the
“running scripts is disabled” symptom for `claude`/`npm`.

## [1.0.3] — 🔎 The endpoint box you couldn't type in

Reported from a real office, with a screenshot: the 🔎 SEMANTIC RECALL row in
⚙ → SKILLS had an endpoint field squeezed to nothing and a Save button hanging
off the edge of the panel. Both true, both measured.

**Fixed**
- **The SEMANTIC RECALL endpoint field rendered at 22px — and the row ran 26px
  past the panel.** `.assistrow` is a flex row that cannot wrap; the model and
  key inputs were pinned with `flex: 0 0 190px` and `0 0 150px`, so **340px of
  that row could not give ground**. The panel is `min(470px, 92vw)` with 16px
  padding — about 426px — so the one flexible child, the endpoint, absorbed the
  entire shortfall and collapsed. At 22px it could not even show its own
  placeholder (`http://localhost:11434/v1`), so nothing on screen said what to
  type into the field the feature needs; and what was left over pushed
  บันทึก outside the panel. The endpoint is a URL, so it now takes a line of
  its own (392px), and the model, key and Save share the next one.
- **📦 RUN LOCATION had the same bug one field along.** Choosing **ssh**
  reveals a fourth input, and the host and the office path ended up at **77px
  each** — too narrow to read either placeholder, let alone a real path. It did
  not overflow, which is why nobody caught it. They are now 185px and 343px.

**Added**
- **`daemon/tests/overlay-layout.test.js`** — four tests that compute, from the
  markup, whether a settings row pins more width than the panel can give it
  while being unable to wrap. Checked against the broken markup first: it fails
  three of the four, so it is a guard and not decoration.

Nothing else changed. The daemon reads `overlay.html` from disk on every
request, so **tray → Reload chat window** is enough to pick this up — no
restart, no update.

## [1.0.2] — 📖 The documentation catches up with the product

v1.0.0 shipped five real capabilities and v1.0.1 made the office speak fourteen
languages properly. Neither of them reached the surfaces most people actually
read: the website's feature grid, the docs site, and the guide set had no idea
any of it existed. A capability nobody can find is a capability nobody has.

Nothing here changes behaviour. It changes what the product tells you, and in
how many languages it tells you.

**Added**
- **The website now describes what v1.0 added.** Four new cards on the landing
  page — 📦 *Run it somewhere else*, 🔎 *Recall by meaning*, 🎨 *Media
  Studio* and 📚 *Skills that correct themselves* — and six new sections on the
  docs page: where agents run, ghosts that don't overwrite each other, recall by
  meaning, self-correcting skills, the Tools Hub and the Media Studio. Each one
  cites the **ALL-CAPS English setting name** the app itself shows, so the page
  and the office agree on what a thing is called.
- **All of it in all fourteen languages, on the same commit.** 24 new site
  strings × 14 languages, written rather than left to fall back — English,
  ไทย, 中文, Español, हिन्दी, العربية, Português, Русский, 日本語, Deutsch,
  Français, 한국어, Indonesia, Tiếng Việt.
- **The Plugins Hub read English in 12 of the 14 languages** — the last known
  gap of this kind. `web/plugins.json` carried English and Thai, and the page
  collapsed every other language to one of those two before rendering, so a
  reader in Korean got a fully translated page wrapped around English plugin
  cards. The catalog now has per-language overlays
  (`web/assets/plugins-i18n/<lang>.json`, keyed by the English source, fetched
  on demand) and `plugins.html` reads the real document language. Guarded by
  `daemon/tests/plugins-catalog.test.js` — eight tests, including one that
  fails if the page stops fetching the overlays, because twelve translated
  files no page loads is twelve files of dead weight and the bug still ships.
- **A guide for the 🧰 Tools Hub** ([`docs/guide/tools-hub.md`](docs/guide/tools-hub.md)):
  the 43 entries and what separates the 15 built-in abilities from the 28 MCP
  servers, the creative shelf (Blender, Godot, Unity, Unreal Engine, Roblox
  Studio), why keys should be named rather than pasted, how to read the risk
  line, and how to submit an entry — including why every one is checked against
  the registry before it merges. Linked from the README, the docs site and the
  tools page.
- **`daemon/tests/site-i18n.test.js` — the website's i18n is now checkable.**
  Eight tests: every advertised language has a table, every English key is
  translated everywhere, no language carries a key English has dropped, no
  *paragraph* is the English left in place, every `data-i18n` key on every page
  has an English source, the v1.0 capabilities are present in all 14 languages,
  and the ALL-CAPS setting names the docs cite still exist in the app. With the
  eight plugin-catalog tests, the suite goes from 242 to 258.

**Changed**
- **README.** The daemon feature list now documents 📦 run location and 🔎
  semantic recall as their own entries, and the ghost, skills and tools entries
  say what v1.0.0 actually did to them. Eight new HTTP API rows
  (`/registry/backend`, `/registry/ghostworktrees`, `/registry/semantic`,
  `/registry/skill/revert`, `/gen/image/edit`, `/gen/video`, `/studio`,
  `/tools/catalog`), the Media Studio in the media section, the Tools Hub guide
  in the guide table, and seven v1.0 items on the roadmap.
- **The ghost card on the landing page** stopped describing only the part that
  was true before v1.0.0 — it now mentions the private `git worktree` each
  ghost gets and the branches its work comes back as.

## [1.0.1] — 🌐 Fourteen languages, actually

This office ships worldwide, and 1.0.0 quietly assumed otherwise in three
places. Nothing here changes behaviour; it changes what the product says, and
to whom.

**Fixed**
- **The Tools page read English in 12 of the 14 languages.** The site's language
  files cover page *chrome*; the tool descriptions live in the catalog, which
  only ever carried English and Thai — so a reader in Japanese or Arabic got a
  translated page wrapped around English cards. All 79 catalog strings are now
  translated into every supported language (`web/assets/tools-i18n/<lang>.json`,
  fetched on demand, English as the fallback). "Falls back to English" is not
  the same as "supported".
- **Three new settings had no stable name outside Thai.** Every field in the
  chat window leads with an ALL-CAPS English term — 🔌 MCP SERVERS, ⚡ SYSTEM
  TOOLS, 🔑 API KEYS — with the Thai after it. That is not decoration: the
  window is Thai-source and a DOM pass machine-translates it at runtime, so the
  English term is the part that survives unchanged. It is the name an English
  office shows and the only name the docs can cite. The 1.0.0 additions were
  Thai-only; they are now **📦 RUN LOCATION**, **🔎 SEMANTIC RECALL** and
  **👻 GHOST ISOLATION**.
- **The English guide cited Thai labels.** Doubly wrong: a reader of an English
  page is running an English office and would never see them. Those pages now
  cite the English names, and the example of a word-match failure that ran in
  Thai runs in English on the English-facing pages.

**Added**
- **Tests that keep it true.** The catalog now fails CI if a language is
  missing an overlay file, if any English string is untranslated in any
  language, if a "translation" is just the English copied through — the failure
  that looks like success — or if a file carries a string the catalog no longer
  has.

## [1.0.0] — 🏢 An office that can run anywhere, recall what you meant, and correct itself

> **On the version number:** nothing here breaks. Every addition is opt-in and an
> office that updates and changes no settings behaves exactly as it did on
> 0.9.54. `1.0.0` is a statement about the product being ready, not the semver
> rule about breaking changes — the one deliberate exception to the table below.

**Added — the five things the field had and we didn't**

A survey of where the open-source agent projects have got to (OpenClaw,
Hermes Agent, thClaws, ARRA Oracle) found five real gaps once the ones we had
already closed were set aside. All five are here.

- **📦 An agent can run somewhere that isn't your desktop.** Every run was
  `claude -p` on this machine, so an agent that went wrong went wrong on the
  real computer and the office could never be bigger than one of them. ⚙ →
  TOOLS now takes a **Docker** image or an **SSH** host; set it for the office
  or per agent. A container gets the office read-only at `/office` and the
  working directory at `/work`, and nothing else on the disk exists as far as
  that agent is concerned. Keys pass by *name*, so values never appear in a
  process listing. A backend that cannot be built correctly is **refused, not
  downgraded** — most importantly when `--settings` cannot be placed, because
  that is what installs the permission broker, and a run that quietly loses it
  works fine with nobody watching.
- **👻 Ghost clones stop overwriting each other.** Parallel ghosts have always
  shared one directory. Each can now get its own `git worktree`, with the work
  coming back as `office/ghost-<id>` branches to review. Your checkout is never
  touched, a ghost that changed nothing leaves nothing, and a ghost that failed
  still keeps what it wrote. Off by default: it moves where a ghost's edits
  land.
- **🔎 Recall by meaning, not only by words.** Memory search matched words —
  ask *"why did the wallpaper vanish"* and a note reading *"WorkerW teardown kills
  the embedded world"* shares no meaningful token with the question and never came
  back. Point ⚙ → SKILLS → **🔎 SEMANTIC RECALL** at any OpenAI-shaped `/embeddings` (a local Ollama costs nothing
  and keeps your memory on the machine) and both rankings are fused. Off by
  default; word search is untouched and still runs alone.
- **📚 Skills that fix themselves.** The office wrote itself new skills and never
  revised one, so a skill with subtly wrong steps stayed wrong forever and got
  handed to more agents over time. Reflection can now correct one — and it runs
  after **failures** too, which is the strongest evidence a skill is wrong and
  was previously thrown away. Never a built-in, never one you have edited, and
  the previous version is kept.
- **🎨 Media Studio.** The office could make a picture but not change one, so
  any real production job left halfway through. Make, change and animate in one
  window; an edit never overwrites its input and its result becomes the
  selection, so the next instruction refines rather than restarts. Agents can
  make and edit pictures; video is owner-only and says its price on the button.

**Added — the engines, and a tool catalog that resolves**
- **The engines are in the office.** 🧰 Tools Hub gains a *Creative & game dev*
  tier — **Blender**, **Godot**, **Unity**, **Unreal Engine** and **Roblox
  Studio** — so an agent can model, light and render, run a scene and read the
  debug output back, or edit a script and playtest it, inside the real tool
  instead of only writing files and hoping. Plus **Figma** (read the actual
  layout, not a screenshot of it) and **ElevenLabs** (voice) for the rest of a
  production.
- **Chrome DevTools, Context7, Exa and Firecrawl.** DevTools gives an agent a
  performance trace and the console when a page is broken; Context7 pulls the
  *current* docs for the library being written against — the cure for
  confidently-wrong code from a stale memory of an API.
- **A hosted MCP server can now be added by pasting its URL.** An `https://…`
  goes in the same one-line box as a launch command and connects over HTTP;
  anything else is still run as a program. Nothing extra to choose. Linear ships
  as the first entry of that kind.
- **New builtin skill: 3D & Game Production** — how to work through an engine:
  check the tool is actually connected before planning around it, read the scene
  before changing it, change small and then *look* (render, run, screenshot,
  read the output), and never claim what you have not seen.

**Fixed — a tool catalog half of which could only fail**
- **Seven Tools Hub entries were dead buttons.** npm has deprecated the
  reference servers for GitHub, Brave Search, Postgres, Slack, Puppeteer and
  Google Drive, and `@google-workspace/mcp-server` — offered for one-click
  install — **never existed at all**; it 404s. Every command in the catalog was
  re-checked against the live npm / PyPI / GHCR registries and replaced with the
  maintained server (GitHub's own, Brave's own, Notion's own, and so on).
  Puppeteer and the separate Drive server are gone, covered by Playwright +
  Chrome DevTools and by Google Workspace.
- **The hub called the built-in browser `browser`; the registry calls it `web`.**
  So the Playwright card never showed as installed even though every office
  ships with it seeded, and pressing Add created a *second* copy under the other
  name. Card ids now come from the catalog, which is the same file the rest of
  the office reads.
- **A server you added by hand was invisible here** — the hub only listed what it
  had a card for, so a custom MCP could be added from this page and then never
  removed from it. Anything in the registry the catalog does not describe now
  gets a card of its own.

**Changed**
- **The tool catalog is data, not markup.** It lived hard-coded inside
  `toolshub.html`, which is why it could rot for months behind Add buttons that
  could only fail. It now lives in `web/tools.json` — one source of truth shared
  by the website's Tools page and the in-office hub, fetched live (bundled copy
  offline) exactly like the plugin catalog. A renamed package is now a PR, not a
  release. The hub also groups cards by what they are *for*, and prints the one
  setup step each server needs, in the office's language.

**Fixed — paths pasted into a language that reads them differently**
- **`bagidea say` was broken on Windows for anyone whose account name has an
  apostrophe.** The WAV's path was interpolated into a single-quoted PowerShell
  string, and `os.tmpdir()` follows `%TEMP%` — which is
  `C:\Users\<account>\AppData\Local\Temp` by default. An account named O'Brien
  closed the string mid-path, PowerShell reported *"The string is missing the
  terminator"*, and nothing played. The same line was a command-injection primitive
  for anything able to influence `TEMP`: one statement parsed as four. The path now
  travels in the **environment**, so there is no string for an apostrophe to close.
- **Three more paths pasted into somebody else's language unquoted**, all carrying
  the install root, which follows the account name the same way: `bagidea uninstall`
  on macOS escaped for the shell and then dropped the result into an **AppleScript**
  string literal without escaping it again (two languages need two quotings); and
  both the macOS and Linux branches of `POST /update` — the in-app 🔄 button —
  interpolated `cd '${root}'` with no escaping at either layer.
- **The in-app 🔄 update button rebuilt nothing on Linux.** It ran `build-mac.sh`.
  Now `build-linux.sh`, which is what every other Linux path in the repo uses.

  All four found while reviewing [#45](https://github.com/bagidea/bagidea-office/pull/45),
  an automated scanner report that flagged a neighbouring line built entirely from a
  constant lookup table — safe — and walked past these.

## [0.9.54] — 🍎 The Mac wallpaper stops crawling, and no PR ships blind

**Fixed**
- **macOS: the wallpaper ran at 2 fps while it was in plain sight.** The occlusion
  monitor that throttles the world when it's hidden had two independent bugs, both
  found and fixed by [@kmmao](https://github.com/kmmao)
  ([#43](https://github.com/bagidea/bagidea-office/pull/43)):
  it skipped the Dock's full-screen window by matching the **localized** process name
  against the literal `"Dock"`, so on any non-English system the match failed and the
  Dock counted as an app covering the whole screen on *every* poll — the throttle flag
  could never clear, and restarting didn't help. It's now matched by bundle id
  (`com.apple.dock`), which is locale-independent. And coverage was always judged on
  `CGMainDisplayID()`, so with two monitors a fullscreen app on the primary throttled
  a wallpaper that was fully visible on the secondary; the monitor now finds the
  world's own desktop-level window and judges both coverage and display-sleep on the
  display it actually overlaps most. Single-monitor English installs are unchanged,
  and real fullscreen occlusion still throttles to 2 fps as before.

**Changed**
- **Every pull request now gets a build signal.** `.github/workflows/ci.yml` builds
  the Rust shell on Windows, macOS and Linux and runs the daemon test suite on Node
  20 and 22, on every PR and every push to `main`. Before this the repo had no CI on
  pull requests at all — and a build on one OS says nothing about the others, because
  `#[cfg(target_os = ...)]` code for a platform you're not on is parsed but never
  type-checked. #43 had to be verified by hand on a throwaway branch; the next one
  won't. `meetings.test.js` is excluded (it drives a real agent conversation and
  needs a brain CI doesn't have) — `RELEASING.md` now names the same bar so a
  release is never held to a weaker standard than a PR.
- **The plugin guide now shows how to edit a record safely.** `docs/guide/plugins.md`
  gained a second `/cmd` worked example — Scar Board's `update`, which locks a record's
  identity and recall history (`id`, `authorId`, `createdAt`, `recallCount`,
  `lastRecalledAt`), refuses an unknown id instead of silently creating one, and writes
  atomically (temp + rename). That lock-immutable-fields + atomic-write pair is the
  template for any plugin that edits records it also appends to.

## [0.9.53] — 📡 The feed goes back to glass, and reads on hover

**Fixed**
- **The 📡 feed strip had a pale frame, a washed-out header and white corners.**
  0.9.52 made the office window per-pixel transparent and handed the fading to the
  page — and a full WebView2 host does not carry that evenly across its layers. The
  feed list reached your desktop at true alpha, but the 6px gutter around it, the
  title bar and everything outside the window's rounded corners landed on an opaque
  backing surface: the edge lit up as a pale frame against a bright wallpaper, the
  header lost its contrast until the text behind it was easier to read than the
  title, and the bottom corners grew white arcs. No arrangement of CSS fixes that,
  so the translucency is **the window's own uniform alpha** again — every pixel
  faded equally, which is what the mode looked like from the beginning.
- **The four corners of every window now match.** Two bugs, both long-standing:
  Windows' `CreateRoundRectRgn` takes the *ellipse* size rather than the radius, so
  the window was being cut with a corner half the size the page draws — leaving an
  opaque nub between the two arcs; and the feed's title bar painted square corners
  of its own over the top two, so the strip had soft corners at the bottom and hard
  ones at the top.

**Added**
- **Point at the feed and it firms up to read.** Resting translucency is unchanged;
  while the pointer is over the strip the window goes nearly solid, then fades back
  when you leave. (The webview covers the whole window, so the native side never
  sees a mouse move — the page reports the pointer and the shell moves the alpha.)

**Changed**
- The freeze mitigations from 0.9.51 that were **not** about the window alpha stay
  exactly as they were: the overlay's resizable style is still never flipped, the
  stale size floor is still cleared on the way out of ⛶ large, and tray → **Reload
  chat window** is still there. The alpha itself is back because the freeze it was
  removed for was never once reproduced — around 30 scripted mode switches then, and
  more since — while the damage it did to the look was visible on every bright
  desktop. The layered style is also flipped far less than it used to be: on once
  when feed starts, off once when it ends, with only the *value* moving in between.

## [0.9.52] — 📡 The feed goes see-through again

**Fixed**
- **Feed mode lost its glass in 0.9.51.** Dropping the layered-window alpha took
  the see-through with it: the office window has always been an *opaque* window, so
  once the OS stopped dimming it, no amount of CSS transparency could show your
  desktop through the strip — the feed became a solid grey panel sitting on your
  wallpaper. The window itself is now **per-pixel transparent** (the same way the
  chat head and the boot splash already were), so the page decides: an opaque
  `body` background in chat and ⛶ large mode, a translucent canvas plus the old
  0.77 fade on cards, avatars and text in 📡 feed. Hovering the strip still brings
  it back to near-solid for reading. The layered-window trick stays gone.

## [0.9.51] — 🪟 A window that comes back

**Fixed**
- **The chat window could come back from a mode switch dead.** Going ⛶ large, then
  📡 feed, then back left the window drawing its last frame forever: the window
  itself resized and moved correctly, but the page inside never repainted again —
  no hover, no new messages, nothing but a restart. Two things this shell did to
  that window are things WebView2 does not support being hosted through, and both
  sat in exactly that path. Both are gone:
  - the window's **resizable style is no longer flipped** on every ⛶ toggle (it is
    born resizable and stays that way — the OS resize handles are unreachable
    behind the webview either way, so large mode's edge strips are still the only
    way to drag it);
  - the feed strip's **see-through look is CSS now**, not a layered-window alpha
    (`WS_EX_LAYERED` on Windows, `NSWindow.alphaValue` on macOS). One look, one
    implementation, every platform.

  Honest caveat: the freeze could not be reproduced on demand — around 30 scripted
  mode switches never triggered it — so this removes the hazards rather than a
  proven cause. Hence the rescue below.

**Added**
- **Tray → "Reload chat window".** First aid for a chat window that has stopped
  responding: it rebuilds the page and puts the window back to its normal size,
  position and mode — **without touching the daemon**, so agents that are mid-task
  keep running. Use it before **Restart office**, which takes the whole stack down.

**Changed**
- Leaving ⛶ large now **clears the size floor** it had set. The floor exists so a
  stretched large window can't be dragged below the normal size; leaving it in
  place afterwards meant mini (390×430) and the feed strip (330 wide) were smaller
  than a minimum that was still nominally in force.

## [0.9.50] — 🌱 Not just agents. An ecosystem.

**Added**
- **The story of what the office has become, written down.** A new guide —
  [A self-evolving, self-extending agentic AI ecosystem](docs/guide/ecosystem.md) —
  covering the four things that make it more than a team of agents: **multi-agent
  collaboration** (many agents, different roles, skills, tools and even different
  brains, coordinating and reporting up the chain), **knowledge that compounds**
  (shared `OFFICE.md` notes, per-agent memory written automatically after real
  work, workflows saved as reusable skills, an archive any agent can search — so a
  new project doesn't start from zero), **self-extension** (an agent that finds its
  current capabilities aren't enough can propose the tool or plugin that would be,
  and with your approval that capability becomes a real part of the running office
  — the shift from *AI that uses tools* to *AI that proposes new tools for
  itself*), and the **human gates** that keep you the CEO. Plus the loop it all
  runs on: `Goal → Think → Act → Learn → Extend → Collaborate → Repeat`.
- **A matching section on the website and the docs site**, linked from the README
  — pre-translated in **all 14 languages** in the same change.

**Fixed**
- **Two UI strings the site referenced but never had.** `inst_s1_win` /
  `inst_s1_mac` (the shell labels above the install commands) were used in the
  markup with no string behind them, so every language quietly fell back to
  English. Added in all 14.
- **The English pack was contradicting the page it renders into.** It still called
  the npm path "quickest" and said the installer compiles with Rust — stale since
  the prebuilt shell landed, and since the English pack overwrites the markup it
  was what English readers actually saw. `en`/`de`/`th` synced to the wording the
  other 11 languages already had.
- **The website scrolled sideways on a phone.** A grid track sized itself to the
  min-content of the long one-line installer URL, and the provider list rendered
  as one unbreakable word — together they dragged the whole page past the viewport.
  The same bug shape made the docs page overflow on narrow screens. Verified at
  390 px and 1280 px: no horizontal overflow left.
- **`daemon/tests/api.test.js` reported a failure it had invented.** `t.skip()`
  marks a test skipped but does **not** stop the body, so the Windows/macOS
  early-out ran the request anyway — against an endpoint that is human-UI only and
  correctly answers `403` without the `x-bagidea-ui` header. The test now returns
  on skip and sends the header the overlay sends.

> Docs, website and a test only — no change to how the office behaves.
> `bagidea update` picks it up.

## [0.9.49] — 🕘 A clock that agrees with your taskbar

**Fixed**
- **The roofline clock drifted minutes behind the real time.** It was driven by an
  accumulated frame-delta timer that only *looked* at the system clock once every
  60 seconds — so the office was stale by up to a minute at the best of times, and
  by however long the renderer had been starved at the worst (an occluded
  wallpaper, a machine back from sleep: the frame timer stops, the wall clock does
  not). The clock now samples the system time **every second** and repaints the
  moment the minute rolls over, so it can't disagree with the clock in the corner
  of the same screen. The daylight/atmosphere pass still runs once a minute, and a
  pinned atmosphere (🌅/☀️/🌇/🌙) is untouched.
- **A stray horizontal scrollbar under 📡 OFFICE FEED.** The feed renders the same
  markdown the chat does, but it never inherited the chat's wrapping rules — so a
  single long line inside a code block (a path, a command) stretched the whole
  stream sideways and left a scrollbar the feed should never have had. Feed
  markdown now wraps like chat markdown, and the feed only scrolls vertically.

> No shell change in this release — `bagidea update` picks it all up.

## [0.9.48] — 🤖 The office stops waiting for you

**Added**
- **🤖 AUTO — the team keeps going without you.** The office used to stop mid-job to
  ask your opinion and then sit there until you came back. With AUTO on, agents
  decide within their remit and **open their own next turn** until the work is
  genuinely finished. It still stops for the things that are actually yours to
  answer: a credential it can't get, or an irreversible/outward action (push,
  deploy, delete, spend) — and a block is pushed to your channels so you hear about
  it wherever you are. Bounded to **8 self-driven rounds per job** so a
  misunderstood task can't loop, and every round is announced in chat. Off by
  default: **⚙ → TOOLS → "🤖 Keep going (AUTO)"** or `bagidea auto on`. It removes the
  wait for an *opinion* — what an agent may DO is still the separate 🔓 auto-approve
  switch.

**Security**
- **Registering a folder no longer means "run whatever code it ships"**
  ([#39](https://github.com/bagidea/bagidea-office/issues/39), reported by
  [@glmgbj233](https://github.com/glmgbj233)). A project can carry its own
  `.claude/settings.json`, and that file is executable configuration: a command hook
  such as `SessionStart` runs the instant a session opens in the folder — before the
  model acts, so the office's permission broker never sees it. The office pre-trusts
  project directories (headless sessions stall forever on the trust dialog they
  can't show), which turned *registering* a folder into a standing yes. Now the
  office reads what would actually run: a project with **no hooks of its own** is
  trusted silently as before, while one that ships hooks raises a 🛡 card listing the
  literal commands and **parks the work** until you answer — approve and the task
  resumes by itself. Approval is bound to that exact setup, so editing the settings
  file *or the script a hook calls* asks again, and a hook resolving outside the
  project is flagged. Answerable from the terminal too: `bagidea trust`.

**Fixed**
- **A scheduled job now actually sets work in motion.** A standing order would fire
  on time, the Director would answer with a plan — and nothing happened, so the
  owner had to come back and give the same order by hand. The job runner was the one
  path in the office that sent the raw prompt with none of the scaffolding every
  other path carries: no dispatch protocol on the way in, and **no `DELEGATE:` parser
  on the way out**, so the lines that hand work to the team were printed as prose and
  thrown away. A fired job is now run exactly like an order you just typed — the
  Director dispatches and the results report back to him — and it carries the
  "act in this turn, don't just acknowledge" mandate plus 🤖 AUTO when that's on. The
  same missing parser is fixed on the resume-after-limit path.
- **Ghost task cards on the board.** A task whose run ended *without a verdict* —
  the brain turned out to be unusable (bad key, dead endpoint) and the office cut
  it off, the CLI crashed, or a limit killed it mid-turn — left its card pinned
  **running** on the wallpaper board and in the NOW-WORKING strip, forever: the row
  only clears on a completed/failed event, and that event was only sent when the
  run reported a proper result. Every ending now emits one, so a card can no longer
  outlive its work while the team sits idle. A run the office killed for a dead
  brain ends **red**, not green.
- **A nameless body could appear on the office floor.** Clearing a task row whose
  process was already gone broadcast the ending with an *empty* agent id — and the
  wallpaper gives a body to whatever id an event names, so an unnamed "Researcher"
  materialised and stayed: the roster reconciler skips ids it can't match and
  nothing else could remove it. Endings now name a real teammate or none at all,
  the renderer resolves the owner from the **task id** instead (so ⏹ on a stale row
  clears the right person), and an empty id is ignored outright.
- **A link in chat no longer swallows the office.** Clicking a URL an agent posted
  (a pull request, a doc) navigated the office *itself* to that page — the whole UI
  was replaced by github.com and only a restart brought it back. The office runs
  inside a webview, where `target="_blank"` is simply ignored. Every `http(s)` link
  — chat, update bar, cards, the MCP hub — now opens in your **real browser** and
  leaves the office where it was. A non-previewable file (pdf…) in chat opens in the
  OS default app instead of navigating away.
- **The 🔓 auto-approve switch looked like a dot, not a switch.** Its label is long
  enough to wrap, and as a sibling flex item it squeezed the 34 px track down to a
  bare circle — unreadable as on/off. The track now keeps its size and the label
  wraps beside it. (The setting itself always worked.)
- **npm bootstrapper republished (0.9.47).** `npx bagidea-office` had been serving
  0.9.39 since the publish step skips versions already on the registry, so the
  TLS-hardened installer fetch (#37) and the winget-free Windows path never reached
  new installs.

**Docs**
- README, the guide set, the website (all **14 languages**) and the pitch deck cover
  AUTO, the project-hook trust card and standing orders. The English surfaces had
  drifted back into Thai in places — the user-guide index, the PLACE examples, the
  NOW-WORKING strip quote, a settings label and a dead Thai anchor into
  troubleshooting — all now English, and the guide index lists every guide instead of
  two thirds of them.

> No shell change in this release — `bagidea update` picks it all up.

## [0.9.47] — ↻ Model lists that stay current · agents that don't stall waiting for you

**Added**
- **↻ Live model lists — Claude included.** The pickers used to show whatever was
  hardcoded on release day, so a model that shipped *today* stayed invisible until
  the next office release. Every provider's list is now pulled from its own
  `/models` **20 s after boot and every 12 h**, plus on demand: **⚙ → CONNECT →
  `↻ Refresh model list`** (all providers at once, with counts + when it last ran)
  and the `↻` beside the **Model** field (that provider only). Claude was the one
  provider with **no live fetch at all** — Anthropic's list needs your own
  credentials rather than a provider key, so the office uses `ANTHROPIC_API_KEY`
  when you've set one and otherwise the Claude Code CLI's existing login on this
  machine (read-only; sent nowhere but `api.anthropic.com`, macOS Keychain
  included). The newest model becomes the pre-selected default — and **no existing
  agent's brain is ever rewritten for you**. New `POST /registry/models/refresh`.
- **🔓 Auto-approve tool permissions (opt-in, ⚙ → TOOLS).** Hand out work, walk
  away: a permission prompt with nobody there to click Allow used to park the job
  for 50 s and then be **denied**. With the switch on, requests are allowed
  automatically. Off by default — it is a real trade-off, so it's your call.
- **Every running task is visible now**, including the ones that used to run
  silently: 👻 **sub-agents (ghosts) get their own live rows**, and meetings /
  coffee breaks report as tasks like everything else.

**Changed**
- **Delegated work is owned end-to-end.** Teammates now carry a `<work-autonomy>`
  mandate: decide what's within your remit and keep going — come back only when
  genuinely blocked (a missing credential, a truly ambiguous requirement, an
  irreversible outward action that needs the owner's call). Work no longer stalls
  on questions the teammate could have answered itself.
- **One agent hitting a limit no longer stops the floor.** A sustained **429**
  (rate/usage ceiling) now triggers the same failover as a sustained 5xx — the task
  moves to the fallback brain if you've set one — and the job pool runs **3 lanes**
  (`reg.maxJobs`; 🌱 eco mode still keeps it to one), so the rest of the team keeps
  working while one agent waits out its limit and comes back by itself.
- **Unified markdown rendering for all agent text** — chat, feed, workflow analysis
  and results, proposals and notes now go through one vendored, XSS-safe `md.js`
  (marked + DOMPurify) instead of showing raw markdown and literal `<b>` tags.
  Thanks **[@bmdy5](https://github.com/bmdy5)**
  ([#36](https://github.com/bagidea/bagidea-office/pull/36)).

**Fixed**
- **The macOS installer could die silently** right after downloading the shell —
  printing a success line while never installing Godot, the Claude hooks or the
  `bagidea` CLI. macOS ships **bash 3.2**, where `.`/`source` is a POSIX *special*
  builtin: sourcing a missing file exits the shell **before `|| true` can catch
  it** — and on the prebuilt-shell path Rust is never installed, so `~/.cargo/env`
  never exists. All four such lines now test the file first. Root-caused, with the
  exact version-independent fix, by
  **[@lyfer-bob](https://github.com/lyfer-bob)**
  ([#38](https://github.com/bagidea/bagidea-office/issues/38)).
- **The team stopped gathering in the CEO's room.** The exec-room fence was only
  enforced on *named* waypoints, so social behaviours (chat, high-five, chase)
  walked agents straight in on raw coordinates. Every destination now passes
  through the fence: non-residents are rerouted to the lobby and only the CEO +
  Director stand there. Walking past is still fine.
- **A missing security light crashed the patrol tween** (`rp_target` on a freed
  object) on world builds that don't have one — now guarded, so the flash is
  skipped instead of erroring.
- **The npm bootstrapper forces HTTPS + TLS 1.2** when fetching the install script,
  so it can't be pulled over a downgraded channel. Thanks
  **[@anupamme](https://github.com/anupamme)**
  ([#37](https://github.com/bagidea/bagidea-office/pull/37)).

> No shell change in this release — `bagidea update` picks it all up.

## [0.9.46] — ⛶ Large window: opens fullscreen, drag any edge to resize

**Changed**
- **Large window mode now opens fullscreen** (was ~86% centered) and you shrink it
  by dragging — same floor as before: it never goes below the normal window size.
- **You can actually resize it now.** The chat webview covers the whole frameless
  window, so the OS never showed native resize handles — dragging an edge did
  nothing. Large mode now has invisible drag strips on all four edges and corners
  that start a real OS resize (`drag_resize_window`), so you can pull it to any
  size you like. Corners round again the moment it's smaller than the full screen.
- **The mini / restore-size button is hidden while large is open** (it's meaningless
  there) and comes back the moment you leave large mode.

> Shell + overlay change — arrives with `bagidea update` (the prebuilt shell from
> this release's assets). 0.9.45's large button on an un-updated shell couldn't
> resize; this is the fix.

## [0.9.45] — zero-Anthropic-account fix · 📦 move-to-a-new-machine · Gemini tool-use fix · large window · two hide levels · 🌱 eco mode

**Added**
- **📦 Move your office to a new machine** — `bagidea export` packs everything that
  makes an office *yours* (agents, roles, skills, brains + keys, agent memory,
  meetings, projects, uploads, plugins) into one `.tgz`; `bagidea import <file>`
  on the new machine restores it (previews contents, asks for `yes`, backs up the
  existing registry first, refuses archives with paths outside the install).
  Zero-dependency — uses the `tar` that ships with Win10+/macOS/Linux.
- **⛶ Large window mode** — a fourth window mode next to normal/mini/feed: a big
  **resizable** chat window (opens at ~86% of your screen, centered) for reading
  long threads and real work. Stretch it to fullscreen; it can never shrink below
  the normal window size. New ⛶ title-bar button; feed mode gracefully exits it.
- **Two hide levels** (tray) — the office keeps working under both:
  **Hide everything** (wallpaper + chat + chat head) and new
  **Hide chat + button (wallpaper stays)** — the world lives on your desktop while
  the chat UI gets out of the way.
- **Work updates now reach your channels** — delegation (🕊), the finished-work
  report (📨) and new team pitches (💡) are pushed to every connected channel
  (Telegram/Discord/LINE/…), so long-running work is followable from the phone.
  Mute with `channelNotify: false` in the registry.
- **🖼 Telegram gets real photos** — when a reply or report references a preview
  image (generated image, uploaded screenshot, any image path), the actual file is
  uploaded via `sendPhoto` after the text — not just a path string.
- **🌱 Eco mode** — `bagidea eco on`: one switch that cuts idle token burn.
  Self-driven rhythms stretch to floors (heartbeat ≥3h, social ≥6h, pitches ≥6h)
  and the delegated-work QA double-pass is skipped. Direct orders are never
  throttled. `POST /registry/eco` for the API-minded.

**Fixed**
- **Gemini brains died with `400 … missing thought_signature in functionCall parts`**
  the moment an agent used a tool. Gemini thinking models sign each tool call and
  REQUIRE the signature echoed back with the conversation history — the built-in
  proxy dropped it in both directions. It now remembers each tool call's
  `thought_signature` and re-attaches it on the history echo (with Google's
  documented `skip_thought_signature_validator` fallback for pre-fix history).
  Gemini-only; other providers get no extra fields.
- **"The 3D Editor won't open on some machines"** — three real causes, all fixed:
  (1) every Godot fallback path pointed at dev-machine locations no install uses —
  the launcher (shell + daemon) now also checks the installer's actual tools dir,
  ignores a `BAGIDEA_GODOT` that points at a missing file (and the installer no
  longer sets it when the download failed); (2) a stale `bagidea_shell_alive` flag
  from a crashed shell muted the daemon's fallback launcher forever — the shell now
  re-touches the flag every 5s and the daemon only trusts a FRESH one; (3) a PID-
  recycling bug could "focus" an unrelated process instead of launching. And when
  no engine exists at all, `bagidea editor` / the UI now say so plainly instead of
  pretending to open.
- **Claude model picker missed the Claude 5 family** — `claude-fable-5` and
  `claude-sonnet-5` added to the hint list (Claude is the one provider with no live
  /models fetch; every other provider pulls its live list on Connect — verified
  across all 19).
- **English-first for fresh installs** — 37 UI strings (meeting controls, permission
  prompts, fallback-brain/connect status, plugin updates, voice hints…) had no
  English seed and stayed Thai for a brand-new EN user without a Gemini key. The
  bundled English seed now covers them; website "First run" copy that still said
  "log in to Claude once" rewritten in all 14 languages.

**Fixed (the headline one)**
- **A user who never logged into Claude couldn't run *any* agent — even one routed
  to GLM, DeepSeek, Qwen, or another provider.** The office's agent runtime is
  always the Claude Code CLI (only the *model behind it* changes — we point
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` at the chosen backend). But the CLI
  runs an **interactive first-run wizard** until `~/.claude.json` marks onboarding
  done — and a headless `claude -p` spawn has no terminal to answer it, so it hangs
  and dies **before it ever reaches the third-party model**. A machine that logged
  into Claude even once (then stopped using it) sailed past this; a never-logged-in
  machine hit it on every single spawn, whatever brain was selected.
- The office now **seeds `hasCompletedOnboarding: true` in `~/.claude.json` on
  daemon boot** (creating the file if absent, never downgrading an existing value),
  so a pure GLM/DeepSeek user with **no Anthropic account at all** can run agents.
  It's exactly the flag the interactive wizard sets on completion.
- Second stall fixed on the same path: `ensureTrusted()` (the folder pre-trust that
  avoids the CLI's "Do you trust this folder?" prompt) used to `JSON.parse` an
  existing `~/.claude.json` and silently no-op when the file was **missing** — so a
  fresh user's project dirs were never pre-trusted either. It now creates the file.
- Installer wording corrected: it no longer implies you must "log in later by
  running: claude". Claude login is **optional** — needed only if you actually run
  Claude models; every other provider needs just its API key in Settings.

## [0.9.44] — 📂 "Open folder" opens the *real* folder again (Windows)

**Fixed**
- **The 📂 button under a media file in chat opened `Documents` instead of the
  folder the file actually lives in** (Windows). It hit any path containing a
  **space** — which is most real media: `uploads/`, an image dropped in from
  elsewhere, a Thai filename, anything ChatGPT generated
  (`ChatGPT Image Jul 1, 2026, 08_10_04 PM.png`). Paths without a space worked,
  which is why this hid for so long.
- Root cause: `explorer.exe` doesn't parse its command line by CRT rules — it
  needs `/select,"C:\dir\file.ext"` with the switch bare and the path quoted.
  We passed `"/select,<path>"` as a single argv token, so Node quoted the
  **whole** token as soon as the path held a space. Explorer then never saw
  `/select` at all and silently fell back to the default folder — `Documents`.
  The line now hands the command line over verbatim, so the quotes land around
  the path only.
- Verified end-to-end against the real shipped line on three paths: spaces +
  commas, a Thai name with spaces, and a plain no-space path (to prove the case
  that already worked still does).
- Scope: Windows `/reveal` only. The **Projects** 📂 button and "open in default
  app" (⤢) use different, already-correct forms; macOS (`open -R`) and Linux
  (`xdg-open`) were never affected.

## [0.9.43] — An opt-in fallback brain: agents survive a provider outage

**Added**
- **🛟 Office-wide fallback brain (opt-in).** When a teammate's brain gets
  *sustainedly* overloaded — repeated `5xx` from the provider (GLM/Z.AI's `529`
  under load is the classic) — the office can now **re-run that same task on a
  fallback brain you chose**, instead of leaving it to die on the retry loop.
  Set it once in **Settings → CONNECT → 🛟 สมองสำรอง** (pick any *connected*
  provider + an optional model). The failed-over run keeps the original task and
  still reports back to whoever delegated it; a one-line note tells you it
  switched and why.
- This is the *right* version of the v0.9.39 auto-failover we deliberately
  reverted in v0.9.40. The revert's objection was "not everyone has a Claude
  brain, and a transient blip shouldn't burn a fallback." Both are addressed:
  it is **off by default** (no fallback set → behavior is byte-for-byte the same
  as before — the same brain just retries hard), it only fires after the
  overload is **sustained** (not a one-off), it only routes to a provider that's
  **actually connected**, and it **never** loops back onto the down brain or
  fails over twice for one task.

**Notes**
- Only server-side overload/unavailability (`5xx`) triggers failover. Bad auth
  (`401/403`) and a dead endpoint still fast-fail with a clear message as before;
  rate/usage limits (`429`) still pause-and-resume — none of those switch brains.

**Known issue (still under investigation)**
- The macOS "stuck on the boot logo" render bug from v0.9.42 is **not** fixed
  here — it's waiting on the boot-log console output from an affected Mac to pin
  shim-vs-renderer before the fix ships.

## [0.9.42] — Docs & website overhaul; a cross-platform ready-flag fix

**Documentation**
- A full accuracy + coverage pass across every doc surface — README, the guide
  set, the website (all 14 languages), and the pitch deck. Provider count
  corrected **18 → 19** (Kimi Code is its own provider), the builtin skill
  library corrected to the real **15 packs**, stale model recommendations
  refreshed (`glm-4.6 → glm-5.2`, `kimi-k2.5 → kimi-k2.6`), and the CLI
  reference completed (`brains`, `jobs`, `key set`, `editor`).
- **The File & Media Toolkit is now documented** as a headline capability —
  every agent can read/convert PDF·Excel·Word·PowerPoint, build slide decks,
  transcribe video, and edit images. It was undocumented before.
- The website's "latest version" badge (stuck on `v0.8.0`) now **self-updates
  from the repo `VERSION`**, and Linux is labelled "experimental" consistently.

**Fixed**
- **macOS/Linux: the world-ready handoff flag lands in the right place.** Godot
  wrote it to `$TEMP` (a Windows-only variable), so on macOS/Linux the shell
  never saw it and fell back to a blind ~9-second timeout to lift the splash.
  It now uses `OS.get_temp_dir()`, which resolves correctly on all three OSes.

**Known issue (under investigation)**
- On some Macs the world can **stay stuck on the boot logo** and never render as
  the wallpaper. Everything else runs (the daemon, agents, networking) — it's
  Godot's first frame not drawing, so the boot splash never clears. This is a
  render-path issue, separate from the flag fix above, and a fix is being
  worked once the Mac-side console output pins the exact cause.

## [0.9.41] — The wallpaper stops vanishing; agents schedule timed work for real

**Fixed**
- **The wallpaper no longer disappears (Windows).** It kept vanishing "for no reason"
  and never came back until a restart — the #1 recurring annoyance. Root cause, proven
  with a live parent probe and a real Explorer restart: Windows destroys and recreates
  the hidden `WorkerW` behind the desktop icons on ordinary events (changing or
  slideshow-rotating the wallpaper, a resolution/DPI/monitor change, an Explorer or DWM
  restart, lock screen / RDP / fast user-switch, exiting a fullscreen game). Our world
  window sat inside that WorkerW's tree, so it was destroyed with it and Godot was left a
  windowless zombie. The shell now runs a **world supervisor**: if the window loses its
  desktop parent it re-embeds into a fresh WorkerW; if the window is destroyed it adopts
  a new one or relaunches the world and re-pins it — automatically, within a couple of
  seconds, no restart needed. It gates on *parent loss* (via `GetAncestor`), never on
  visibility, so Win+D / display-sleep are left completely alone — the regression that
  reverted the two earlier attempts can't recur. Crash-loop guarded.
- **Agents now schedule "do it later" work through the office — and it actually runs.**
  When the CEO asked for work "in an hour", "tomorrow 9am" or "every 30 minutes", it
  quietly never happened: the scheduling skill taught the wrong request shape (so the
  daemon rejected it with a 400) and agents fell back to session-bound timers that die
  when the session closes. The skill now teaches the real `POST /jobs` schema (one-shot
  at a time · daily at a clock time · every N minutes), ships in the builtin library for
  everyone (it was previously never shipped), and is a default every teammate carries —
  so timed and recurring work is booked in the office's own scheduler and fires for real.

**Changed**
- **The executive / CEO room stays the CEO's.** No other teammate gathers, plays, or
  wanders into the exec room in the wallpaper world — it's reserved for the CEO and the
  Main Agent (Director). Staff aimed at an exec spot are rerouted to the lobby.

## [0.9.40] — Install anywhere, always-current model lists, media that renders

**Fixed**
- **The installer no longer hard-fails without winget.** A Windows box without winget
  (Windows Server, fresh Administrator accounts) used to die at `! winget not found`
  before it ever reached the prebuilt-shell path — which needs no winget at all. Now
  winget is optional: Git and Node are downloaded directly (portable MinGit + the
  nodejs.org LTS zip), the prebuilt shell is fetched from the release, and only the
  optional agent CLIs (gh/ffmpeg/…) are skipped when winget is absent.
- **Model lists in the 🧠 brain picker are always current.** The picker carried its own
  hardcoded model list that drifted stale (e.g. it still offered `glm-4.6` long after
  `glm-5.2` shipped). Now the backend catalog is the single source of truth, served to
  the UI, plus a **↻ refresh** button that force-pulls a provider's full live model list
  on demand. Live lists no longer get alphabetically sorted-then-truncated (which buried
  newer ids), and MiniMax fetches its live list too.
- **Chat previews media at ANY absolute path — including paths with spaces.** Files
  outside `workspace/` (e.g. `…/ChatGPT Image Jul 1, 2026, 08_10_04 PM.png`, Thai
  filenames) silently failed to render because the path detector rejected spaces. It now
  accepts spaces and any drive/common absolute root, and covers `svg`/`mov`/`pdf`.
- **A JS-broken plugin is rejected up front** instead of loading as a silent no-op that
  still logged "loaded". `plugins.js` runs `node --check` before requiring a plugin;
  `POST /plugins/reload` answers `400` with the failed list (good plugins still load).

**Changed**
- **Brain-overload policy simplified.** Reverted the v0.9.39 auto-failover-to-Claude: not
  everyone configures a Claude brain, and a transient 529/503 shouldn't burn the Claude
  fallback. The CLI now retries the same brain hard; only bad auth (401/403) and a
  dead/unreachable endpoint fast-fail with a clear message.
- **Docs: the one-shot installer is the primary path**, `npx bagidea` is presented as an
  optional wrapper around the same installer (README, website, and getting-started no
  longer imply "npx first"). Website install headings retranslated across all 11 locales.

**Added**
- **Ollama local-model guide** (`docs/guide/ollama-local.md`) — back an agent with a model
  running locally, no key, no cloud.

---
Daemon + installer + docs change — no shell code change (the prebuilt shell is rebuilt on
the release tag). Update via the in-app 🔄 banner or `bagidea update`.

## [0.9.39] — Fail over to Claude when a brain is SUSTAINEDLY overloaded (529/503)

**Fixed**
- **A sustained provider overload (529 / 503) no longer ends in a raw "API Error: 529".** When a
  non-Claude brain's server is overloaded (common with GLM/Z.AI under load), a one-off hiccup is
  still left to the built-in retries, but once it's retried several times and the provider is still
  down, the office now fails that task over to Claude the same way it does for a dead/bad-auth brain —
  so the work runs instead of stalling on a raw error. The owner is told it fell over. (429 rate-limit
  stays a pause/resume case, not a failover.)

---
Daemon change — no shell rebuild. Update via the in-app 🔄 banner or `bagidea update`.

## [0.9.38] — Wallpaper diagnostic (capture why it sometimes vanishes/shrinks)

**Diagnostics**
- The wallpaper occasionally vanishes or shrinks to a small centered window on some Windows
  setups, and the trigger has been hard to pin down. This release adds an opt-in sampler: with
  the `BAGIDEA_WALLPAPER_DEBUG=1` environment variable set, the shell records the wallpaper
  window's state (visible? minimized? still embedded in the desktop layer? its size? process
  alive?) every 5 seconds to `daemon/wallpaper-debug.log`. The next time it breaks, the log
  shows exactly what changed, so the fix targets the real cause. **Zero cost when the variable
  is off** — nothing changes for normal use.

---
Shell change — prebuilt binaries rebuild for all platforms via CI.

## [0.9.37] — No more phantom agent seats on the wallpaper

**Fixed**
- **Renaming or deleting an agent no longer leaves a ghost of it on the wallpaper.** When an
  agent left the roster (renamed or removed) but the removal event didn't reach the live
  wallpaper, its character used to linger on the floor as a phantom seat (e.g. a leftover
  "Agent" after a rename, still standing there with its nameplate). The wallpaper now drops any
  seat that's missing from the synced roster on every sync, so the floor always matches the real
  team. Reported by the owner.

---
Godot change — ships via `bagidea update` / the 🔄 banner (no shell rebuild).

## [0.9.36] — Linux ARM64 chat via browser, Groq payload recovery, CONNECT scroll

**Fixed**
- **Linux ARM64: the chat finally works.** On setups where the embedded WebKitGTK overlay renders
  blank (confirmed on DGX Spark / ARM64 / X11 — a driver/WM rendering issue, not an app bug),
  "Open Office Chat" now opens the chat in a Chromium app window (or the system browser), re-uses
  that one window on later Opens, restores it from minimized, and the blank overlay + invisible
  click-target are gone. Windows / macOS / x86_64 Linux keep the embedded overlay. Thanks to
  **[@nookpp](https://github.com/nookpp)** for the exhaustive bisect that proved the WebKitGTK
  blank render and the precise focus/hotzone findings (#28, closed).
- **A Groq "Request too large (max 32MB)" no longer dead-ends.** Groq caps a single request at
  32MB; an image-heavy thread crossed it and surfaced as a raw error. That byte-size cap now
  triggers the same summarize-and-restart-on-a-fresh-thread recovery as a context overflow (it
  won't misfire on OpenAI's token-rate limit, which still pauses/resumes).
- **OFFICE SETTINGS → CONNECT no longer jumps to the top** when you connect / test / disconnect /
  save a key — the scroll position is preserved across the re-render (same fix class as the
  OFFICE OPS tabs).

## [0.9.35] — Discoverable uninstall, AV guidance, Linux chat-render fix

**Fixed**
- **You can now uninstall from Windows Settings.** BagIdea Office previously had no entry in
  Windows Settings > Apps, so the only uninstall path was the `bagidea uninstall` CLI command —
  which most people didn't know about and reported as "I can't uninstall". The installer now
  registers an Uninstall entry, so "BagIdea Office" shows up with an Uninstall button that runs
  the real uninstaller; the uninstaller cleans the entry up.
- **Linux: the chat overlay should now render instead of a blank grey panel.** The overlay page
  loaded fully but its body had no opaque background color (only a gradient), so on WebKitGTK it
  painted transparent and showed the grey window behind. Given the body an explicit opaque fill
  under the gradient. Plus a Godot-side i18n fetch race (`HTTPRequest is processing…`) is guarded.
  Thanks to **[@nookpp](https://github.com/nookpp)** for the instrumented-shell diagnostic (#28).

**Changed**
- **Windows Security / Defender guidance.** The wallpaper engine and desktop-wallpaper technique
  are unsigned, so Defender sometimes quarantines the exe (a false positive). The troubleshooting
  guide now spells out how to Restore/Allow it and add a folder exclusion. Code signing is on the
  roadmap.
- **npm `bagidea-office` bootstrapper bumped to 0.9.34** (it always fetches the latest installer
  from `main`, so this is cosmetic — but the version now reflects reality).

---
Installer / daemon / Godot changes — no shell rebuild. Update via the in-app 🔄 banner or
`bagidea update`. (`cd npm && npm publish` to refresh the bootstrapper.)

## [0.9.34] — Linux chat restored + clean child-process shutdown

**Fixed**
- **Linux: opening the chat works again.** The v0.9.31 visibility fix turned out to break Open on
  X11 — `set_visible(true)` doesn't actually re-map the overlay on some window managers, so clicking
  Open (or the orb) did nothing and chat was unreachable. Reverted to the mapped/off-screen approach:
  the chat opens and closes as before. The blank grey panel returns as a side effect (cosmetic); a
  proper "no grey window" fix (creating the overlay on demand) is being worked on with the reporter.
  Thanks to **[@nookpp](https://github.com/nookpp)** for the decisive diagnostic (#28).
- **No more orphan processes when the shell exits.** A crash, `kill`, or `launchctl unload` used to
  leave the Node daemon holding port 8787 and Godot running in the background. The shell now traps
  SIGTERM/SIGINT and kills its children before exiting, and the daemon self-shuts when its parent
  shell is gone. Thanks to **[@misternay](https://github.com/misternay)** (#34, closes #33).

---
Shell (Rust) changes — prebuilt binaries rebuild for all platforms via CI.

## [0.9.33] — Resilient brains, correct context windows, richer meetings

**Fixed**
- **A dead or misconfigured brain no longer hangs the office for ~2 minutes.** When a non-Claude
  backend (GLM / DeepSeek / Kimi …) can't answer — bad/expired key (401/403) or an unreachable
  endpoint — the office now detects it within seconds and tells you plainly which brain failed and
  why, instead of waiting for ~10 silent retries that ended in a raw error.
- **Correct context windows for every model** — so auto-compact fires at the right moment instead
  of too often. GLM-5.2 in particular was falling back to a stale 128k value, so threads on it
  compacted far too frequently and could drop context; it now reports its real 200k (or the full
  1M with the `glm-5.2[1m]` model id). The GLM provider floor and compaction budget were raised to
  match, and each model compacts at ~80% of its own window. *(Want GLM-5.2's full 1M? pick
  `glm-5.2[1m]` in that agent's 🧠 brain field.)*

**Added**
- **Auto-failover to Claude.** When a non-Claude brain dies mid-task, the office automatically
  re-runs that task once on Claude (the always-present default brain) and tells you it fell over —
  so a flaky third-party brain never blocks you. Bounded (never loops), owner-visible on every
  switch, and disable-able via the registry (`brainFailover: false`).
- **Structured, interactive meetings with durable action items** — phases (open → deliberate →
  decide), the owner can speak into a live meeting, live controls (pause / resume / end), and
  action items that persist as validated, assignable records instead of dying with the transcript.
  Thanks to **[@misternay](https://github.com/misternay)** (#32, closes #31).

**Security**
- The live-meeting owner routes (`/discuss/message`, `/discuss/control`) are now restricted to the
  in-app editor, so an agent can't forge a CEO line into a meeting or silently end one — consistent
  with the v0.9.32 hardening.

## [0.9.32] — Agents stay on the brain you gave them

**Fixed**
- **An agent can no longer change which model it (or anyone) runs on.** The endpoints that set
  an agent's brain (provider/model), create or remove agents, and store provider credentials
  weren't restricted to the in-app editor — so a teammate with shell access, when asked to "pick
  the right model," could reassign models itself instead of delegating. They're now owner-only
  (the 🧠 editor), like every other roster and credential setting. Each teammate runs strictly on
  the brain you assigned it, and the Director keeps its own.

**Changed**
- **The Director routes by brain instead of switching models.** Its operating brief now says it
  plainly — every teammate has a fixed brain you chose, so putting "the right model" on a task
  means handing it to the teammate who already has that brain, never changing models — and the
  team roster it works from now shows each member's brain (🧠) so it can match a task to the right
  one at a glance.

## [0.9.31] — Cross-platform project folders + Linux lifecycle fixes

**Added**
- **Native folder picker on every platform.** The PROJECTS tab's 📂 browse button now opens
  your OS's real folder chooser — `choose folder` on macOS, the Windows folder dialog, and
  `zenity` on Linux (falling back to the built-in picker when `zenity` isn't installed). The
  path separator and platform are now reported by the daemon instead of the deprecated
  `navigator.platform`. Thanks to **[@misternay](https://github.com/misternay)** (#30, closes #29).

**Fixed**
- **macOS project terminals.** Opening a project on macOS now reliably tags its Terminal window
  (previously a race when Terminal was busy) and no longer breaks on folder titles that contain
  quotes or backslashes.
- **Linux: no more orphaned daemon.** Closing the office on Linux could leave `daemon/server.js`
  running and holding port 8787. The Linux launcher no longer starts the daemon separately — the
  shell owns the whole stack (daemon + Godot) and shuts it down on quit, like the other launch
  paths already did. Reported by **[@nookpp](https://github.com/nookpp)** (#28).
- **Linux/X11: the stray blank grey window is gone.** The chat overlay hid itself by parking
  off-screen — which X11 window managers clamp back onto the desktop as a blank fixed-size panel.
  On Linux the overlay now hides for real. (#28)

## [0.9.30] — Media from anywhere, baseline skills for everyone, no more scroll jumps

**Fixed**
- **Tasks / Calendar / Notes stop jumping to the top.** Pinning a row, approving or rejecting
  a proposal, or editing a job/event/note in OFFICE OPS re-rendered the whole panel and snapped
  the scrollbar back to the top every time. Each of those tabs now keeps its scroll position
  across those actions (and across the live job refresh), the same way the project list already did.

**Changed**
- **Chat shows media from anywhere on your disk.** Images, video and audio rendered inline only
  when the file lived under the workspace or a registered project — anything on the Desktop, in
  Downloads, or on another drive fell back to a bare path link, so the team copied files in just
  to show them. Now an absolute media path previews inline wherever it lives, and the row's open/
  reveal actions follow. Only media files are ever served this way (never source, `.env`, keys or
  other files) and the office still listens only on your own machine.
- **Every agent starts with three baseline skills.** New and existing teammates now carry
  **archive-search** (recall what the office already knows before guessing), the **file & media
  toolkit** (reach for the bundled tools instead of "I can't"), and **doc-writer** (clean,
  skimmable deliverables) without having to be assigned them — the shared competence a teammate
  should just have. Specialist skills, and tool-granting ones like web automation, stay opt-in.
- **Agents put their tools to visible use when it helps.** Quiet background work stays the default,
  but when seeing something live makes it clearer — or you ask — an agent will open the real
  browser to walk you through a web build, or produce an artifact and show it in chat, instead of
  only describing what it could do.

**Security**
- Hardened `.gitignore` so key material, `.env` files, keystores and `*.bak` runtime logs can't be
  committed by accident.

## [0.9.29] — Uninstall/update any plugin; agents deploy & verify their plugin work

**Fixed**
- **Uninstall and update now work for every plugin.** A plugin whose folder name differed
  from its manifest id (so it lived somewhere other than `plugins/<its-id>`) couldn't be
  removed or updated — the buttons failed with "plugin not found". The office now resolves
  a plugin by its id wherever its folder lives.

**Changed**
- **Agents finish plugin work properly by default.** When the team builds or improves a
  plugin, they now deploy it into the running office and **verify it actually took effect**
  (the office only runs plugins from `plugins/<id>`, so a plugin built in a project or a dev
  copy doesn't count until it's deployed, reloaded, and confirmed at the new version) before
  reporting it done — so a finished-looking plugin can't quietly leave the office running an
  old version. Publishing to a git repo or the Hub stays a separate, owner-approved step.

## [0.9.28] — One-click plugin updates + a default plugin icon

**Added**
- **Update a plugin in one click.** Open the 🧩 Plugins panel and any plugin you installed
  from the Hub that has a newer version now shows an **⬆ update** button — click it and the
  office pulls the latest and reloads it live. The check is read-only (it just compares your
  copy to the plugin's repo), and it only ever touches plugins you installed from the Hub:
  a plugin repo you're developing yourself is never auto-updated, and one with uncommitted
  changes is left alone — so an update can't throw away your own work.

**Fixed**
- **Plugins without an emoji get a default 🧩 icon.** A plugin whose name didn't start with
  an emoji used to render with a blank icon slot in the Plugins panel; it now falls back to
  🧩 so no row looks empty. (Plugin authors: the leading emoji in your manifest `name` is your
  icon — see the plugins guide.)

> The Plugins, Tools, and Showcase pages on the website also gained a **search box** this
> cycle (already live).

## [0.9.27] — A full team always shows up; tidier mini header; smarter persona drafts

**Fixed**
- **All your agents show up when the team is full.** Once the office had a full roster,
  the wallpaper could show **only the CEO** — everyone else was missing (though they still
  chatted and worked). The team roster the daemon sends had outgrown the wallpaper's 64 KB
  WebSocket buffer, so the whole message was dropped and the world never learned who was on
  the team. The buffer is now 1 MB — a full 18-agent office fits with room to spare.
- **Mini window keeps its "BAGIDEA OFFICE" wordmark.** The previous build hid it to protect
  the window buttons on a narrow window; it now stays and simply shrinks (with an `…`) when
  space is tight, so the buttons are still safe but the header no longer looks empty.

**Changed**
- **The ✨ persona copilot drafts with the Director's brain.** When you ask it to draft a new
  agent from a one-line brief, it now uses your Director (main agent)'s configured model —
  predictable, and it works for an office running entirely on a non-Claude provider.

## [0.9.26] — Multi-monitor: the wallpaper can't vanish off a second screen

**Fixed** (reported on Facebook 🙏)
- **Two+ monitors: the wallpaper no longer flashes and disappears.** On some
  multi-monitor setups the desktop's wallpaper layer (WorkerW) only really covers the
  **primary** screen, so moving the office onto a secondary monitor put it off-canvas and
  Windows clipped it away — it appeared for a moment, then vanished. The shell now measures
  that layer and, if the chosen monitor isn't reachable through it, keeps the wallpaper on
  the primary screen (where it's always visible) instead of moving it somewhere it can't be
  seen. The single-monitor path is unchanged. If you hit a multi-monitor placement issue,
  send us `daemon/monitor-debug.log` — the office now records exactly what it detected.

## [0.9.25] — Live chat status + in-chat permissions, meeting brain-routing fix

**Added** (community PRs 🙌 — thanks [@misternay](https://github.com/misternay))
- **Live status in the chat** while an agent works — a typing/▶ bubble shows what it's
  doing right now instead of a silent wait ([#18](https://github.com/bagidea/bagidea-office/pull/18)).
- **Approve permissions right in the chat.** When an agent needs to run a tool, the request
  now appears as an inline card you approve or reject without leaving the conversation
  ([#18](https://github.com/bagidea/bagidea-office/pull/18)).

**Fixed**
- **Meetings & reflection now use each agent's own brain.** When an agent was set to a
  non-Claude provider, group meetings and idle reflection still hit Claude's endpoint and
  failed with a **401** for users running only a proxy / GLM / DeepSeek key. Each agent's
  configured provider is now routed everywhere ([#22](https://github.com/bagidea/bagidea-office/pull/22)).
- **Windows 10: the mini-window restore button no longer clips.** In the narrow mini window
  the logo + "BAGIDEA OFFICE" wordmark + buttons overflowed and the restore button was only
  half visible. The wordmark is now hidden in mini (the logo icon is enough), so the control
  cluster always fits flush-right and fully shows (reported on Discord 🙏).

## [0.9.24] — Windows 10 mini/restore button + tidier mini header

**Fixed** (reported on Discord 🙏)
- **Windows 10: the "restore window size" button is visible again.** The mini/restore icon
  used the `⛶` / `◱` glyphs, which have no font coverage on Windows 10 — so the button
  rendered **empty** and users couldn't get back from the mini window. It's now an inline
  **SVG** icon (shrink ⇄ expand) that renders identically on every Windows.
- **Mini-window header buttons pin to the right.** In the small window the menu / security /
  mini / hide buttons weren't right-aligned (the control carrying the auto-margin is hidden
  in mini, and an inline margin was overriding the fix) — they now sit flush right.

## [0.9.23] — Clearer context: why the office compacts at ~200k

**Added**
- The **🧠 BRAINS** panel now explains its context bar in plain language. The bar fills
  toward the model's *full* window (e.g. 1M), but the office summarizes older history much
  earlier — around **~200k tokens** — on purpose: it's cheaper every turn and keeps the
  agent focused (a stuffed window is expensive and less accurate). It's **not** a limit —
  your files stay on disk and re-readable, and the cap is tunable. A matching FAQ was added
  to the **[Cost & vision](docs/guide/cost-and-vision.md)** guide.

## [0.9.22] — Quieter, smarter voice (TTS)

**Fixed**
- **Transient Gemini TTS hiccups no longer spam the feed.** v0.9.20 began surfacing TTS
  failures, but the preview voice model 500s/overloads now and then — so a passing
  "🗣✗ An internal error has occurred…" chip would pop for a line that simply didn't get
  spoken (the agent's work was never affected). The office now **retries** a transient TTS
  error up to twice and otherwise **skips it quietly**.
- **Voice is simply off when no Gemini key is connected** — silent, with no error chips at
  all. The 🗣✗ chip now appears only for **actionable** problems (missing/revoked key,
  unknown voice, auth/quota). How to turn voice on is shown on the ⚙ Agent-voices toggle,
  the AI-features panel, and the ▶ voice-preview button.

## [0.9.21] — Token economy: cheaper agents by default

**Changed — the office spends far fewer tokens, same smarts**
- **Agents stop fanning out "always."** They now split into parallel sub-agents only when a
  task *genuinely* has independent parallel parts worth it (default is "do it yourself") —
  this was the single biggest multiplier (one order could explode into 15–25 runs).
- **Auto-learn is now adaptive.** Skill reflection (a full extra run) used to fire after
  *every* tool-using task. It's still on by default and **eager while the office is young**
  (so new users see their agents grow skills), then **throttles itself** once there's a
  healthy skill library (≥5 tools, ≤1 / 15 min).
- **Idle social is lighter.** Autonomous group hangouts are rarer and smaller (≤3, one
  round), lean more on free canned banter, and **run with no web tools**; the default cadence
  is 120 min for new offices. (Meetings you trigger yourself still get full tools.)
- **Long Claude threads are compacted proactively** (~200k tokens) instead of growing toward
  the ~1M window before self-compaction. Set `CTX_BUDGET.claude` back to 0 to revert.

Reminder: each agent does its real work on **its own brain** — route worker agents to a
cheap, capable model (GLM / DeepSeek / Qwen / Gemini Flash / Groq) and keep an expensive one
only where it matters. See the new **[Cost, cheap setups & vision](docs/guide/cost-and-vision.md)** guide.

**Added**
- **`npx bagidea`** — a short alias for `npx bagidea-office` (both work). The npm pages now
  carry a hero image + badges, and the site/README lead with the shorter command.
- A detailed **Cost & vision** guide: running cheaply (even with **no Claude** — GLM/DeepSeek
  only, plus a free Gemini key as the office's "eyes"), and how agents read images.

## [0.9.20] — Run-lifecycle safety + TTS hardening

**Fixed** (thanks @misternay 🙏)
- **No more hung runs or proxy zombie/retry loops.** Claude runs now have a wall-clock and
  idle **timeout** (a watchdog reaps a stuck run), the daemon **shuts down gracefully** on
  SIGTERM/SIGINT, and a **cross-platform process-tree kill** (`taskkill /T /F` on Windows,
  SIGKILL elsewhere) reaps the *whole* tree — so a stuck run or a restart no longer leaves
  an orphaned `claude`/proxy process alive ([#16](https://github.com/bagidea/bagidea-office/pull/16),
  fixes [#15](https://github.com/bagidea/bagidea-office/issues/15)). Tunable via
  `OFFICE_RUN_TOTAL_MS` / `OFFICE_RUN_IDLE_MS`.
- **TTS is more robust** — failures surface as a chat chip instead of silence, a double-play
  race is closed, and speak text is JSON-escaped so quotes/newlines don't break the call
  ([#14](https://github.com/bagidea/bagidea-office/pull/14)).

**Under the hood**
- A 120s timeout on proxy (swappable-brain) upstream calls, chained to the client-drop abort.
- npm **Trusted Publishing** workflow groundwork (OIDC) toward auto-publishing the `bagidea-office` npm bootstrapper.

## [0.9.19] — Prebuilt binaries (no more Build Tools!), faster installs, fixes

**Added — the big one: prebuilt shell binaries**
- Installs and updates now **download a prebuilt shell** instead of compiling it. On
  Windows that means **no more ~2-4 GB Visual Studio C++ Build Tools and no Rust** for a
  normal install (the #1 cause of failed installs); macOS/Linux skip the multi-minute
  cargo build. A new CI workflow builds the shell for **Windows x64, macOS universal
  (arm64+x64), and Linux x64** on each release and attaches them (with sha256 checksums).
  Any miss (offline, old version, unsupported distro) **falls back to a source build**.
  Binaries are unsigned for now (a one-time SmartScreen/Gatekeeper prompt).
- The Windows installer now also **ensures the Edge WebView2 runtime** the shell needs.

**Fixed**
- **Windows update no longer hangs** on `Unlink of file '…pack-*.idx' failed (y/n)` — git
  auto-gc is disabled on the deployed checkout so a repack can't fight a locked pack file.
- **Linux builds link correctly** — `libxdo-dev` is now installed (the shell links `-lxdo`),
  which had been silently breaking from-source Linux builds.
- The header window buttons (◱ / ⛶ / ⋯ / —) are **centered** again.

**Web & npm** (already live)
- **`npx bagidea-office`** — the office is now on npm with a one-line installer.
- A **Contributors** section (README + site) and **Discord / YouTube** links on the site.

## [0.9.18] — Mini/restore button shows the right icon; full macOS support; Calculator in the Hub

**Fixed** (reported on Discord 🙏)
- **The mini/restore button no longer gets stuck on ⛶.** v0.9.17 picked the ◱/⛶ icon from
  `window.innerHeight`, which can read `0` before first paint on a window that's born
  full-size and never fires a resize — so the full window wrongly showed ⛶ (Restore). It
  now uses the same media query the mini-mode CSS uses and updates exactly on the mini⇄full
  toggle.

**Added**
- **Full macOS support** — installer/update robustness on a wired install, CLI uninstall,
  and a custom-provider save fix, with Linux support kept intact
  ([#12](https://github.com/bagidea/bagidea-office/pull/12), thanks @misternay).

**Web & docs** (already live at bagidea.github.io)
- The **🧮 Calculator** is a real plugin (safe math evaluator — no `eval`) and is now in the
  **Plugins Hub**, listed as a worked example alongside Music Player and the Hello template.

## [0.9.17] — Reachable menus, a way back from mini, macOS occlusion throttle

**Fixed** (reported on Discord 🙏)
- **The language menu no longer clips.** With 14 languages the dropdown ran off the
  bottom of short / mini / Windows-10 windows, so ไทย / Tiếng Việt / Indonesia were
  unreachable. All header dropdowns now cap to the window height and scroll.
- **Mini window has an obvious way back.** The ◱ button toggles a compact window in the
  shell, but it never changed once shrunk — people couldn't find how to restore. It now
  shows **⛶ "Restore window size"** while the window is small.

**Added**
- **macOS: the wallpaper throttles to 2 fps when fully occluded** (or the display is
  asleep) and recovers automatically — no more burning ~20% CPU rendering frames no one
  sees ([#11](https://github.com/bagidea/bagidea-office/pull/11), thanks @spondanai;
  fixes [#10](https://github.com/bagidea/bagidea-office/issues/10)). macOS-only, cfg-gated.

**Web & docs** (already live at bagidea.github.io)
- Language choice is now **remembered** across pages/refresh, and all **14 site languages
  are 100% complete** (no English fallback). A **Showcase** page, a fuller **Tools** hub
  (incl. agent-browser), the **Hello Office** template + **Web View** plugin in the Hub,
  and the `/docs/guide` guides translated to English.

## [0.9.16] — Tidier settings tabs + much fuller docs

**Changed**
- **The ⚙ settings tabs wrap into balanced rows.** With CHANNELS added the tab row was
  cramped (and "CHANNELS" truncated); now the tabs wrap ~4 per row and each row stretches
  to fill — Settings becomes 4+3, Office Ops 4+2 — with no lone tab spanning a whole row.

**Docs**
- Filled the real gaps so every feature has a how-to (all verified against the code):
  ghost-clone splitting & agent discussions, UI language switch / live map / multi-monitor,
  microphone & ambient mood voices, social & proposal-frequency settings, cancelling a
  running task, per-project MEMORY.md, and a note that realtime calls go to the Director.
  Corrected two stale claims: the Workflow Builder now **runs** workflows (not analysis-only),
  and the office ships with **no bundled plugins** (install the Music Player from the Hub).
- The website **Tools page** is now a full hub — all 15 built-in tools plus popular MCP
  integrations (GitHub, Filesystem, Memory, Postgres, Slack, Brave Search, and more).

## [0.9.15] — More channels + a Channels settings tab

**Added**
- **Three more ways to reach the office — Slack, WhatsApp and Messenger** (experimental 🧪),
  alongside Telegram / Discord / LINE. Each is a webhook adapter (public HTTPS, e.g.
  cloudflared) mirroring LINE: Slack via the Events API (signing-secret verified), WhatsApp
  via the Meta Cloud API, and Messenger via the Meta Graph — both with the standard
  `hub.challenge` verify handshake. Configure a bot token / verify token and the office
  answers from those apps too. See [docs/guide/channels.md](docs/guide/channels.md).
- **Channels get their own ⚙ settings tab.** They moved out of the crowded CONNECT tab
  into a dedicated "📡 CHANNELS" category so they're easy to find as the list grows.

**Fixed**
- Saving a channel no longer drops the `phone` / `verify` fields the new channels need
  (the config whitelist only kept token/secret before).

**Web**
- A new **Tools page** on the site (built-in tools + add-on MCP capabilities) and a
  redesigned, public **pitch deck** with real screenshots — both at bagidea.github.io.

## [0.9.14] — The office browses the web + a batch of polish

**Added**
- **Web automation — agents browse and act on real pages.** A ready-to-use **🔌 web**
  capability (Playwright MCP) lets an agent navigate, click, type, submit forms and
  screenshot live pages. Ships as a one-tick **Web Automation** skill, and the Director
  (Shino) carries it **by default** — so the office can browse from the first run, with
  no setup. Choose **visible** (`web`, watch it work) or **background** (`web-bg`); it
  runs an isolated profile (not logged in) and every action still passes the Security
  Center. See [docs/guide/web-automation.md](docs/guide/web-automation.md).
- **Agents split into ghost-clones far more readily.** The split (`SUB:`) capability is
  now directive — agents parallelize whenever work has 2+ independent parts (research
  multiple sources, check multiple files, compare options), and the Director routes
  parallelizable delegations as splits. The Ghost Deck finally earns its keep.

**Fixed**
- **Agents no longer wander into unrelated projects.** A delegated task with no explicit
  `@ project` used to inherit the Director's currently-open project; and a project name
  was matched as a loose substring (a "build a web scraper" task could enter a project
  named "web"). Now agents only enter a project when routed or clearly named — whole-word
  for Latin, substring for boundary-less Thai/CJK — otherwise they work in the shared
  workspace on a fresh thread.
- **Office Ops: deleting a project no longer glitches** the list into vanishing, doubling
  or flashing the wrong panel. Re-renders carry a token so only the newest commits to the
  DOM, and a transient fetch error keeps the list on screen instead of blanking it.
- **The world behaves.** Staff no longer pile on the world origin during a huddle (a
  missing anchor fell back to (0,0,0)), and they stay out of the CEO's room — it's for the
  CEO and the Director. An agent now **runs** to the Security desk to ask for a permission
  (instead of strolling), and no longer twitches off its desk when a tool it already holds
  is auto-approved.
**Docs**
- A plugin-authoring note against ASCII-stripping filenames/text (it turned Thai names
  into underscores) with a Unicode-safe sanitizer, and a competition pitch deck under
  `pitch/`. (The Music Player's own Thai-names fix shipped in its plugin repo, v1.2.0.)

## [0.9.13] — Installer: the hooks were never wired (perm + task hooks dead)

**Fixed**
- **Permission prompts (Security Center) and the task feed (Mission Control) now work
  after a one-shot install.** The committed `.claude/settings.json` carry the dev
  machine's absolute paths; install.ps1's Step 10 tried to rewrite them, but the regex
  couldn't cross the escaped quotes (`\"`) wrapping the path in the JSON command string,
  so it matched nothing and silently left a non-existent path in place — the `PreToolUse`
  permission hook and the `task.*` hooks then never fired. The installer now **regenerates**
  both `settings.json` from scratch against the real install path via the new
  `installer/wire-hooks.ps1` (Windows) / `installer/wire-hooks.sh` (macOS/Linux, shared
  with build-mac.sh & build-linux.sh). `update.ps1` / `update-linux.sh` check the files out
  before `git pull` (so `--ff-only` can't abort on the per-machine edits) and re-wire right
  after. Reported on Discord by a one-shot-installer user. **Existing users:** run
  `bagidea update` (or re-run the installer) to repair the hooks.

**Docs**
- README, the `/docs` guide, and the website now document the experimental Linux build
  across all 14 UI languages.

## [0.9.12] — Linux support (experimental) + macOS CLI fix

**Added**
- **Linux support — experimental/beta 🧪.** One-line installer for Ubuntu/Debian
  (`installer/install-linux.sh` → apt deps, Node 20, Rust, Godot 4.6, WebKitGTK, X11
  tools, builds the shell, wires hooks, sets up the `bagidea` CLI + login autostart).
  On **X11/Xorg** the office attaches as the live desktop wallpaper (wmctrl below+sticky,
  xprop desktop type); on **Wayland** it falls back to a fullscreen window pinned below.
  Daemon/CLI gained the Linux branches (godot path, XDG autostart, terminal launch, audio
  playback, update/uninstall). **Please report issues** — distro, desktop, `$XDG_SESSION_TYPE`.

**Fixed**
- **macOS: `bagidea start` finds the shell binary** — `findShellExe()` was hardcoded to
  `.exe`; it now resolves the no-extension binary on macOS/Linux (release→debug fallback),
  with cross-platform tests. Thanks @misternay (#9).

## [0.9.11] — Pin favourites

**Added**
- **Pin (📌) your favourites** so they're easy to find in long lists — a per-machine
  toggle that floats them to the top. Available in the **Plugins** panel, **Office Ops →
  Projects** (a "📌 Pinned" group), and **Office Ops → Tasks** (pinned proposals first).

## [0.9.10] — Solid plugin install / uninstall

**Fixed**
- **Uninstalling a plugin is clean** — it no longer pops a stray "unknown plugin" window
  (the trash click used to fall through and open the just-removed plugin's panel). It now
  asks for confirmation first and shows an in-app toast when done.
- **The Plugins panel and Hub stay in sync** — both now refresh on the office's
  `plugins.changed` events, so installing/removing in one place is reflected everywhere
  (no more "not installed" when it is, or "already exists" after a remove).
- **Reinstalling asks what you want** — installing a plugin whose id already exists no
  longer hard-fails; you're asked to **Overwrite** the existing one or install a **new
  copy** (cloned as `id-2`, `id-3`, … with its own manifest id).

## [0.9.9] — Resilient work, smarter brains, a livelier office

**Added**
- **Work resumes after a rate limit or a restart** — a delegated task that hits a
  temporary ceiling (rate/usage limit, 429, overloaded) or gets killed by a restart is
  no longer dropped. It's parked and **auto-resumed on its own thread** (`--resume`, full
  context) once the cooldown passes, with backoff and a give-up after a few tries.
- **Model picker pre-selects the best/newest model** — choosing a provider now suggests
  its flagship (Claude Opus 4.8, GPT-4.1, Gemini 2.5 Pro, Grok-4, DeepSeek V4-Pro, …) — a
  quiet nudge that a newer model exists; older ones stay selectable.

**Improved**
- **Claude agents always have an explicit model** — never the blank/implicit one; they
  default to **Opus 4.8** (flagship, 1M context), editable per agent.
- **Context windows are accurate per model** — Claude shows its real **1M** (was 200k);
  every provider's default model resolves to the correct window.
- **Empty office on install** — no plugins are bundled anymore; add what you want from the
  Plugins Hub (each its own GitHub clone).
- **Plugins Hub is clearer** — the publish flow is spelled out in 3 steps and the
  "submit guide" / "view source" links actually open now (office webviews route external
  links to your system browser).
- **Task board on the wall** — each running task shows the agent's **face** on a square,
  state-coloured tile (running/blocked/done/failed) instead of a text label.
- **Overflow workers sit side by side** — when all desks are taken, extra workers line up
  at the shared ops bench instead of clustering on one point.

**Fixed**
- **Stale "working" cleared after a restart** — the wallpaper no longer shows agents as
  working when nothing is (a journaled `task.reset` clears it on boot).
- **Proposal cards settle everywhere** — approving/rejecting from 🗂 Tasks (or another
  window) now updates the inline proposal card in the chat too.
- **Plugin output no longer turns to "?"** — agents are guided to send non-ASCII plugin
  args via a UTF-8 file (the Windows shell mangled inline non-English to `?`).

## [0.9.8] — Attached images readable by any model

**Fixed**
- **Attached images now work on every model** — attaching an image only passed its file
  path with a "read it" note, so a text-only brain (DeepSeek, GLM, …) replied that it
  couldn't read the image. The daemon now transcribes each attached image to text (visual
  description + verbatim OCR) with a vision model — Gemini Flash first, OpenAI gpt-4o-mini
  fallback — and inlines that into the prompt, so any brain can read it. The original file
  still rides along for natively-multimodal brains to read directly. (Needs a Gemini or
  OpenAI key in ⚙ CONNECT; falls back to the old behaviour without one.)

## [0.9.7] — Agent models in the roster, orb polish

**Added**
- **Each agent's model is shown in the roster** — the agents panel now shows a
  "🧠 &lt;model&gt;" line under every agent (e.g. `deepseek-v4-pro`, `kimi-for-coding`,
  `glm-4.6`; `Claude` for the default brain), with the full provider/model on hover. The
  CEO — your stand-in, not an AI agent — shows none.

**Fixed**
- **Orb edge looks smooth** — the circular clip sat exactly on the orb's glowing rim, so
  its hard edge cut the glow against the colourful wallpaper and looked jagged. The orb art
  is now inset a few pixels, leaving a thin transparent halo so the clip falls on empty
  space instead of the glow.
- **No caption chrome behind the orb on click** — despite being undecorated, the orb
  window still carried a system menu + min/max styles, so clicking it flashed a white
  caption bar and a system icon / window buttons in the corners. Those styles are dropped
  and the non-client area is removed, so nothing draws behind the orb (without disturbing
  the transparent compositing).

## [0.9.6] — Orb click-through

**Fixed**
- **Orb no longer blocks the desktop around it** — the orb's window is wider than the
  visible circle (Windows pads it to a min width) with transparent margins, so anything
  beneath them — e.g. desktop icons — couldn't be clicked, and the orb looked off-centre.
  The window is now clipped to a circle centred on the visible orb (sized from the real
  client rect, re-applied on DPI/monitor changes): the margins are clipped away and click
  straight through to the desktop, the orb sits dead-centre, and a stray title-bar sliver
  on click is gone too.

## [0.9.5] — Per-model context windows, Kimi Code, orb polish

**Added**
- **Kimi Code provider** — the Kimi Code coding plan (kimi.com/code) is a separate
  service from the general Kimi · Moonshot API: its own `sk-kimi-…` keys, its own
  Anthropic-compatible endpoint (`https://api.kimi.com/coding`), and a single model
  (`kimi-for-coding`). It's now a one-click built-in provider — paste the key and
  Connect (verified live). Previously such a key failed against the Moonshot endpoint
  with a confusing 401.

**Improved**
- **Context window is now per-model and auto-detected** — the usage meter and the
  compaction point used one coarse number per provider, so models were badly mis-sized
  (DeepSeek showed 128k and compacted at ~115k despite a real **1M** window). Now each
  model resolves its own window from a researched table (Claude 4.6/4.8 1M, DeepSeek V4
  1M, Gemini 2.5 1M, GPT-4.1 1M, GLM-4.6 200k, Qwen3-Coder 1M, Kimi K2 256k, Grok, Llama,
  Mistral, …) and, where a provider advertises it on its model list (OpenRouter, Groq,
  Together, …), the **live** value wins automatically. The compaction budget is derived
  from that window (~80%), so threads on big-context models run far longer before
  summarizing. Still overridable per provider via `providerConfig.contextWindow` /
  `contextBudget`.

**Fixed**
- **Orb no longer has an invisible grab box** — the chat-head's square window let
  its transparent corners (outside the visible circle) catch clicks and drags. Pointer
  events outside the circle are now ignored, so only the orb itself drags and toggles.

## [0.9.4] — Reliable voice hotkey + gender-aware agents

**Fixed**
- **Voice hotkey (Right Ctrl) no longer wedges** — holding the push-to-talk key
  sometimes did nothing (then started working again after clicking elsewhere). A
  key-up could be missed when window focus shifted around the moment of a press,
  leaving the hotkey "stuck down" so the next press was swallowed as auto-repeat.
  A 150 ms watchdog now reconciles the tracked state against the key's real
  physical state, so the hotkey can never get stuck.
- **Agents now know their gender — voice & words match** — an agent with a male voice
  could still write/speak about itself as female (e.g. saying "ค่ะ"), so the voice you
  heard and the words clashed. The gender is now read straight off the assigned voice
  preset (♀/♂) and stated in the agent's persona, so it refers to itself consistently in
  every language (Thai ครับ/ผม vs ค่ะ/ฉัน, pronouns, honorifics). Applies to both chat and
  realtime calls.

## [0.9.3] — Voice fixes, smarter calls, macOS copy/paste

**Fixed**
- **Voice push-to-talk no longer garbles Thai** — it produced `�` characters (worse the
  longer you spoke) because the transcription response was decoded per network chunk,
  splitting multi-byte characters. Bodies are now decoded as UTF-8 whole. (Same fix applied
  to Claude-written summaries and the auto-translation path.)
- **macOS: copy/paste works** — ⌘C / ⌘V / ⌘X / ⌘A had no effect because the frameless
  window shipped no Edit menu, so the shortcuts never reached text fields. Adds a standard
  Edit menu. (Fixes #8.)

**Improved**
- **Smarter voice calls** — the call agent is now framed as your **Director** and gets a
  live office snapshot (projects in progress, proposals awaiting approval, scheduled jobs)
  on top of the team roster + notes, so it can actually talk about your work and help plan
  (and it takes new orders to delegate after the call). Every call also leaves a chat-app-
  style record in the conversation: "📞 Voice call with <name> · HH:MM · 2m 13s".

Note: a mishearing by the speech model (one Thai word for another) is separate — that's the
accuracy of the underlying Whisper/Gemini transcription, not the corruption fixed above.

## [0.9.2] — Launch with Windows by default

**Fixed**
- A fresh install now **starts automatically with Windows.** Previously nothing wrote the
  auto-start entry, so the office didn't come back after a reboot. The installer enables it
  on first install (without overriding a later "off"), and existing installs get it turned
  on **once** on their next `bagidea update` (marker-guarded, so it's never re-enabled after
  you turn it off). Toggle anytime with `bagidea startup on|off`.

## [0.9.1] — Office files, a tool-aware toolkit skill, and a real license

**Added**
- **Office-file support** — the installer now bundles **LibreOffice**, so agents can read &
  convert **xlsx / docx / pptx** (→ csv / pdf / txt) headlessly via `soffice`. Fills the
  spreadsheet gap (CSV/JSON were already covered).
- **"File & Media Toolkit" built-in skill** — a protected skill that maps each task to the
  right bundled tool, so the office's existing power actually gets used instead of an agent
  saying it "can't": PDF (Read), Office files (LibreOffice), docs/books & slides
  (`pandoc` → pdf/docx/epub/pptx), YouTube/video (`yt-dlp` + transcribe, `ffmpeg` frames),
  images (ImageMagick), data (csv/`jq`). Assign it to your hands-on agents.

**Changed**
- **Added an MIT LICENSE** — the project is now properly open source (it was previously
  missing a license file).

Note: the toolkit skill ships through `bagidea update` (built-ins reseed on restart);
LibreOffice and the other agent CLI tools are installed at install time (a fresh install,
or re-running the installer).

## [0.9.0] — More brains, safer delegation, workflows agents can build

A big follow-up to Swappable Brains: many more models, a quality gate, and a Workflow
Builder the team can drive — plus a redesigned chat-head.

**Added**
- **8 more model providers.** Via the built-in proxy: **Groq, Cerebras, xAI (Grok),
  Mistral, Together AI, Fireworks** — and **local Ollama / LM Studio that need NO API
  key** (just run the server). Plus **Kimi (Moonshot)** talking direct. That's **18
  providers built in**, plus your own custom ones.
- **Live model lists** — provider pickers now fetch each provider's *current* models
  (on Connect, and when you open an agent's brain), so newly-released models always show
  up — no more stale hard-coded list.
- **Verification loop** (opt-in, Settings → Skills) — a skeptical reviewer double-checks
  delegated work before it reaches the CEO, handing it back once for fixes if something's
  off. Off by default (it costs an extra pass).
- **Agents can build workflows.** Ask an agent to capture a plan and it saves an editable
  workflow into the Builder (a new built-in **Build Workflow** skill teaches the syntax);
  and the Builder gains **🪄 Draft with Director** — describe a goal, get a workflow to edit.
- **Approve / reject proposals in-place** — when the team pitches a project, act right in
  the chat *or* the feed; no need to open 🗂 TASKS.
- **`bagidea brains`** CLI — every provider's connect status + each agent's model and live
  context usage.

**Improved**
- **Built-in skills are protected** — the baseline skills (plugin building, office control,
  Build Workflow…) are read-only; only your own / agent-learned skills can be edited or
  deleted. The agent editor's **Skills & Tools** are now searchable **add-dropdowns** that
  show only what's assigned (no more wall of chips).
- **The Director (main) is locked as the office manager** — orchestrate-and-delegate is its
  primary job and survives any prompt edit, so work can always be routed.
- **Workflow Builder**: example workflows are read-only (Save forks an editable copy), a
  save now confirms before overwriting your own, and the confirm dialog is on-brand.
- **Redesigned chat-head orb** — a crisp neon energy-ring (a cyan→purple glow that turns),
  replacing the old jagged edge; easier to spot on the desktop.
- New UI strings translated across all 14 languages.

**Fixed**
- Cold-boot dark / jagged orb and splash — now crisp via per-pixel transparency.
- Server-room fire crackle no longer loops forever after an agent puts it out.
- The editor's save dialog is now an on-brand themed modal, not raw grey Godot chrome.

## [0.8.2] — Cold-boot dark orb: the real fix

**Fixed**
- **The chat-head orb's logo is now embedded in the app**, so it always shows. v0.8.1
  tried to retry the HTTP fetch, but the very first failure on a cold boot could be
  missed (the image started loading before the retry was wired) and the orb stayed dark
  even after the daemon was up. The logo no longer touches the network at all — it's
  baked into the binary as a data URI — so the orb comes up correctly every time,
  regardless of whether the daemon is ready yet.

## [0.8.1] — Fix the cold-boot dark orb

**Fixed**
- **The floating chat-head orb no longer stays dark after a reboot.** On a cold boot
  the shell paints the orb before the daemon's web server is up, so its logo 404'd and
  a one-shot fallback left it dark until a manual `bagidea restart`. The orb now retries
  loading its logo until the daemon answers (then drops the dark fallback) — so it comes
  up correctly on its own.

## [0.8.0] — Swappable brains: run each agent on any model

The big one. Every agent can now run on a different model/provider — keep the
Director on Claude, put the builders on cheaper models, and cut cost without
losing any of Claude Code's tools, skills, or sessions. Claude Code stays the
engine; only the backend model swaps. Defaults to Claude and fails open, so
nothing changes until you opt an agent in.

**Added**
- **Per-agent brain picker** (✏️ edit agent → 🧠 BRAIN): choose the provider +
  model that powers each agent.
- **Providers out of the box:** Claude, GLM, DeepSeek, Qwen, MiniMax (talk
  straight to their Anthropic-compatible endpoints), plus **OpenAI, Gemini,
  OpenRouter, NVIDIA, and your own custom providers** through a **built-in,
  zero-dependency proxy** — no LiteLLM or Python to install.
- **🧠 MODELS / PROVIDERS** section in CONNECT: paste a key → Connect → ✅, with
  sub-categories, masked keys everywhere, a "test & fetch models" check, curated
  usable-model lists, and an auto-picked default model. The Claude card
  auto-detects login vs. API key.
- **🧠 BRAINS monitor** (Security Center sidebar): every provider's connect status
  and every agent's model + a live context-usage bar.
- **Model + context meter in chat:** each agent message is tagged with the model
  that produced it, and the thread bar shows how full that model's context window
  is (e.g. `gpt-4o · 39k/128k`).
- **STATS now covers every provider** — estimated spend per provider (from real
  token usage) folded into the daily total.
- **Typing indicator** — bouncing dots while an agent is spinning up / working, so
  it never looks frozen.
- **Cancel a running task** mid-flight (⏹ in the NOW-WORKING strip).
- **Models & Providers guide** in the docs.

**Improved**
- **Automatic context management for every model**, Claude-Code style: the office
  proactively **auto-compacts** a long thread (summarize → continue on a fresh
  thread) *before* it overflows, and reactively recovers from rate/context limits
  — carrying your view across to the new thread so nothing looks stuck.
- Swapped-in models now answer truthfully about **which model they are**.
- All new UI is translated into the full set of **14 languages**.

**Fixed**
- Rock-solid proxy: buffers the upstream reply, synthesizes clean Anthropic
  streaming, self-heals common OpenAI parameter quirks, and surfaces every error
  instead of hanging. Transient rate-limits now back off and retry rather than
  failing the turn.
- A delegate's report-back stays visible in the CEO pane even when the Director
  auto-compacts onto a new thread.
- Many polish fixes: CONNECT scrollbar jump, cold-boot show/hide handle, themed
  model dropdown, and the thread-bar layout with long model names.

## [0.7.25] — Remove the custom-character experiment

**Removed**
- **The custom (color-tinted) character system** (added in 0.7.23–0.7.24) — it
  didn't work well in practice, so it's gone: avatars are the 12 polished NPC
  designs again. Any agent that was set to a custom look is automatically moved
  back to a normal NPC.

## [0.7.24] — Custom characters: live preview, matching faces & smoother walk

**Fixed**
- **Custom-character colors now show everywhere**, not just on the wallpaper — the
  agents rail, the companion beside the chat, and nameplates all render the same
  tinted character (the overlay composites it just like the office does).
- **Smoother walk** for custom characters — no more jittery stride (their idle art
  keeps a calm cadence with a gentle step-bob instead of flickering).

**Added**
- **A live preview** in the avatar editor — see your custom character update as you
  drag the skin / hair / outfit colors (or roll 🎲), before you save.

## [0.7.23] — Design-your-own characters (custom colors)

**Added**
- **A 🎨 Custom character** in the avatar picker. Pick your own **skin / hair /
  outfit** colors (or hit 🎲 for a random mix) and that agent renders as a unique
  tinted character — unlimited looks, no new art needed. Each agent remembers its
  colors, and the picker speaks all 14 languages.

## [0.7.22] — Tools Hub, Plugins Hub & Workflow Builder speak every language

**Changed**
- **The pop-out windows now translate into all 14 languages**, not just Thai/
  English. The Tools Hub, Plugins Hub and Workflow Builder auto-translate to your
  office language (and ship pre-translated, so they show instantly) — they used to
  fall back to English for everything except Thai.

## [0.7.21] — More of the UI ships pre-translated

**Changed**
- **Newer screens now ship pre-translated** in all 14 languages — the Plugins Hub,
  the display menu, the confirm dialogs and more show in your language instantly,
  instead of waiting for on-the-fly translation the first time.

## [0.7.20] — Workflow Builder polish & friendlier scrolling

**Fixed**
- **The last Thai bit in the Workflow Builder** (the Run / Save-as-Skill help line)
  now translates properly in English offices.
- **No more white resize-grip / scrollbar** on workflow node boxes — the text area
  scrolls with the office’s slim themed scrollbar instead.

**Changed**
- **Scrolling over node text scrolls the text**, not the canvas zoom. (Zoom still
  works over empty canvas.)
- **Right-click anywhere on the workflow canvas** pops the ＋ Node menu at your
  cursor — works on examples too (adding a node + Save just makes an editable copy).
- **No native browser right-click menu** in pop-out windows anymore (Plugins,
  Workflow, Tools/Plugins Hub…). Pages that want their own menu still have one;
  the browser’s default just doesn’t butt in.
- **The agents rail scrolls sideways with the mouse wheel** — no more wrestling the
  thin scrollbar.

## [0.7.19] — Workflow Builder: English-first & right-click to add a node

**Changed**
- **The bundled workflow examples are now all in English** — a clean, global
  default. (Write your own flows in any language you like; the examples just set
  the standard.)
- **No more stray Thai** in the Workflow Builder when the office is in English —
  the new-workflow starter node follows your language too.

**Added**
- **Right-click the canvas to add a node right there.** A ＋ Node menu pops up at
  your cursor and drops the node where you clicked — no hunting for it.

## [0.7.18] — The display menu is always there

**Changed**
- **The 🖥 Display menu now always shows** (in the ⋯ menu), listing exactly the
  screens the office detected — one monitor shows one (ticked), two show two, and
  so on. Switching still remembers your choice and restarts to apply it.

## [0.7.17] — Real multi-monitor detection, its own menu & a tray Restart

**Changed**
- **The display picker is now its own menu**, separate from atmosphere — and it
  only appears when you actually have more than one monitor.
- **Monitors are detected for real.** No more phantom “Display 2/3” on a single
  screen. On a multi-monitor PC the office auto-places the wallpaper on your
  primary screen from the first launch, and lists exactly the screens you have.
- **Switching screens restarts the office for you** — no need to type
  `bagidea restart`; it re-attaches to the chosen monitor automatically.

**Added**
- **A “Restart office” item in the tray menu**, right where you’d expect it.

## [0.7.16] — One-click install straight from the website

**Added**
- **Install from the web with one click.** The “Open in office” button on a plugin’s
  web page now hands the install straight to your running office through a
  `bagidea://` link. The office always **asks you to confirm first** — a web page
  can never install code silently — and the copy-link fallback still works if the
  office isn’t open.

## [0.7.15] — Plugins Hub: a community catalog you can install in one click

**Added**
- **Plugins Hub.** A curated catalog of community plugins — browse them and install
  into your running office with a single click. Open it from **⋯ → 🧩 Plugins Hub**
  (or the button in the Plugins panel). The catalog is fetched live, so newly
  approved plugins show up without an app update.
- **A public Plugins page on the website** to discover plugins, copy an install
  link, and learn how to publish your own.
- **Anyone can submit a plugin.** Publish it as a GitHub repo, then open a PR adding
  it to the catalog — every submission is reviewed (plugins run real code on a
  user's machine). See `docs/guide/plugin-hub.md`.

## [0.7.14] — Safer deletes & clearing team proposals

**Changed**
- **Deleting in Settings now asks first.** Removing a role, skill, or staff member
  pops a clear “are you sure?” confirmation — deleting should be a deliberate act,
  not a stray click.
- **Clear team proposals in bulk.** The 💡 proposals list now lets you tick several
  and clear them at once, or clear them all — quietly, with no message sent to the
  team. Approving still happens one at a time (each spins up a real project).

## [0.7.13] — Shadows back, and crisp at any zoom

**Fixed**
- **Shadows no longer disappear at the normal camera.** The previous tweak cut the
  shadow range too short, so the office sat outside it when zoomed out and lost its
  shadows entirely. The range now covers the whole office, and the shadow map is
  twice as detailed (and a touch sharper) — so shadows stay crisp from the far
  diorama view all the way in to a close-up.

## [0.7.12] — Discussions you can watch, smarter walking & clearer shadows

**Fixed**
- **Agents stop walking through walls.** Pathfinding now always enters and leaves
  a room through its doorway instead of cutting a straight line to the nearest
  point (which could sit on the far side of a wall).
- **Shadows read clearly at the normal camera**, not only when zoomed in — tuned
  the sun’s shadow so it stays crisp at a distance.

**Changed**
- **Discussions are now live huddles.** When the team confers, members actually
  gather in a ring with a floating topic banner over them — and several
  discussions can run at the same time, each in its own spot, so you can watch
  everything on the wallpaper at once.
- **Anyone double-booked splits a stand-in (แยกร่าง).** If a teammate is heads-down
  on a task or already in another meeting, a translucent clone joins the huddle
  while the real one keeps working.
- **Tools Hub:** removed a stray duplicate “＋” icon on the “Add your own MCP” box.

## [0.7.11] — Workflow polish, centered windows, real ghost-splits & a fuller Tools Hub

**Fixed**
- **Workflow side panel no longer overflows.** Long analysis/run output now scrolls
  inside its box, so the Run / Save-as-Skill buttons stay put.
- **Workflows really split into ghosts.** When a flow has parallel branches, the
  team now actually spawns visible ghost clones (via the SUB protocol) instead of
  only *saying* it split.

**Changed**
- **Pop-out windows open centered** on screen (plugins, Workflow Builder, Tools
  Hub) instead of scattering to inconsistent spots.
- **Tools Hub is fuller** — 15 ready MCP servers plus an **“Add your own MCP”**
  box so you can install any server by pasting its command.

## [0.7.10] — Fix the Plugins “open” button

**Fixed**
- The Plugins panel's open button rendered cramped/broken (the “⤢ เปิด” icon+label
  overflowed the small icon button). It's a clean ⤢ icon again — click it or the
  row to open the plugin in its own window.

## [0.7.9] — Workflows you can run, a richer Tools Hub & full-language windows

**Added**
- **Workflows do things now.** After you build a flow, **▶️ Run now** hands it to
  the team to execute (with parallel branches & “wait for all” merges), and **🧠
  Save as Skill** turns it into a reusable skill you assign to an agent (or just
  tell an agent to “run &lt;name&gt;”). Dragging to connect nodes is fixed.
- **Workflow tabs + read-only examples.** Open several workflows in tabs and
  switch between them. **7 worked examples** (basic→advanced: PDF summary, GitHub
  triage, competitor watch, research→draft→review…) are read-only templates —
  save one to fork your own editable copy. Your test workflows are kept clean.
- **Tools Hub: more & clearer.** 12 popular MCP servers (Browser, Memory,
  Sequential-Thinking, Filesystem, Fetch, GitHub, Google Workspace, Google Maps,
  Brave Search, Postgres, Slack, Notion), installed ones grouped on top, plus a
  plain-language **“What is MCP?”** explainer and how-to.

**Changed**
- **New windows speak your language.** The Workflow Builder and Tools Hub now
  follow the office language (Thai/English; other languages fall back to English)
  instead of always showing Thai.
- **Plugins open one way** — as their own window (so they can't be open two ways
  at once), and the chat tucks aside for any new window / opened image or folder.
- **Warmer agent voices** — every spoken line now carries a lively, natural,
  anime-flavored delivery instead of a flat read.

## [0.7.8] — Visual Workflow canvas, Tools Hub & a wallpaper-stability fix

**Fixed**
- **Wallpaper no longer vanishes on Win+D / desktop click.** A v0.7.7 change
  (multi-monitor repositioning + a re-pin watcher) regressed the embed on some
  setups, making the office disappear when showing the desktop. Reverted to the
  original rock-solid embed; the monitor reposition now only runs when you've
  explicitly picked a monitor. **Recommended update for anyone on v0.7.7.**

**Added**
- **🔀 Workflow Builder is now a real graph canvas** (n8n-style): pan, zoom,
  draw arrows between nodes, **branch one→many (parallel) and merge many→one
  (wait for all)** — not just a top-to-bottom list. The Director's analysis
  understands the branches and merges.
- **🧰 Tools Hub** (⋯ menu → Tools Hub): a one-click MCP-server catalog —
  **Browser automation (Playwright)** so agents can open & drive a real browser
  for you, plus Web Fetch, Filesystem, GitHub, Slack, Google Workspace.
- **Bundled CLI tools** for agents: the installer now sets up `gh`, `ffmpeg`,
  `yt-dlp`, `jq`, `pandoc` and ImageMagick (best-effort), widening what the
  office can actually do.

## [0.7.7] — Workflow Builder, louder channels & a sturdier wallpaper

A big update — a whole new way to plan work, channels that talk back, and fixes
for the multi-monitor / desktop-click wallpaper reports.

**Added**
- **🔀 Workflow Builder.** A drag-drop canvas (⋯ menu → Workflow Builder) where
  each node is a plain-language step (trigger / fetch / action / decision /
  output / note) and the flow reads top→bottom. Hit **Analyze** and the Director
  reads your plan and tells you which skills/tools to use, what permissions or
  agents are needed, and what's still open — so non-technical users can plan work
  and let the team figure out execution. Ships with three example workflows to
  learn from. (Guide: docs/guide/workflows.md)
- **Channels do more.** Conversations at the CEO seat now **mirror out** to your
  connected Telegram / Discord / LINE; agents show a **“typing…”** indicator
  while they think; and **slash commands** (`/status`, `/agents`, `/projects`,
  `/who`, `/help`) answer instantly from any channel.
- **Pick the wallpaper monitor.** A monitor picker in the display menu (and a
  `BAGIDEA_MONITOR` override) for multi-monitor setups.
- **More agent tools & gimmicks.** Exposed `Skill` / `BashOutput` / `KillShell` /
  `SlashCommand` to the tool catalog; new idle moments (yawn, lightbulb idea,
  high-five, group selfie) so the office feels livelier.

**Changed**
- **Wallpaper sits on the right monitor.** On multi-monitor desktops it now lands
  on your primary (or chosen) screen instead of missing the screen entirely.
- **Meeting board scales with zoom** — it no longer looms oversized when zoomed
  out. The server-room incident is now a **rare** treat (cooldown), not frequent.
- **Leaner tokens** — trimmed the per-turn media note and skip it for ghost
  sub-agents.

**Fixed**
- **Wallpaper no longer detaches on a desktop click** (a re-pin watcher keeps it
  embedded; it respects an intentional Hide-office). *(GitHub #7)*
- **All staff now appear in the 3D office**, not just the CEO — a roster
  reconcile re-ensures every teammate has a body. *(GitHub #6)*
- **Multi-monitor blank wallpaper** (secondary monitor at a negative X) now
  embeds correctly. *(GitHub #5)*

## [0.7.6] — Media shows inline & your atmosphere sticks

**Fixed**
- **Agents now show media inline.** When an agent shares an image, video or audio,
  it appears right in the chat as a viewer/player — click to enlarge, ⤢ pop out,
  📂 reveal in the folder — instead of replying with a raw file path. Agents are
  told to send the file itself, and the chat now recognises more path styles
  (forward-slash and macOS paths, not just backslash and uploads).
- **Your manual day/night choice sticks.** Pinning a fixed atmosphere (e.g. 🌅
  morning) no longer snaps back to the real-time clock when the wallpaper
  reconnects or restarts — the choice is now saved and restored on every reconnect.

## [0.7.5] — Smoother wallpaper, a livelier world & sponsors

**Added**
- **Sponsor the project.** A real sponsor wall with four tiers — 💛 Supporter,
  🥉 Bronze / Backer, 🥈 Silver, 👑 Gold — powered by **GitHub Sponsors**
  (recurring monthly). Sponsors appear automatically on the website and README,
  sorted by tier (amounts never shown). See the **Sponsors** page on the site.

**Changed**
- **Shadows stay crisp at the normal wallpaper zoom.** They used to nearly vanish
  unless you zoomed right in — now they read clearly and softly without zooming.
- **Warmer noon light.** Midday was a washed-out white; it's now warm daylight
  (in the wallpaper and the 3D Office Editor).
- **Smoother chase.** Agents no longer jitter before a chase — there's a quick
  "spotted you 👀" beat, then a clean dash.
- **More cinematic server-room incident.** When the server room blows, the camera
  now focuses on it with two real explosions, fire, and matching sound.

**Fixed**
- **Hiding the office no longer stutters the wallpaper.** "Hide office" hides only
  the overlay UI — your wallpaper is still the live desktop — so it now keeps
  rendering smoothly at 30 FPS instead of crawling to ~2 FPS (which looked like a
  frozen, choppy wallpaper). Agents keep working either way.

## [0.7.4] — Pop-out windows + smarter Office Ops

**Added**
- **Pop-out plugin windows.** Open any plugin's panel as its **own window** (the
  ⤢ button) — a custom dark title bar with **minimize / maximize / close**, drag
  to move, resize from the edges. Each plugin opens one window (re-clicking just
  focuses it); different plugins open side by side. Plugins can set their default
  size (and lock it) via `plugin.json` — Calculator & Music are fixed-size. The
  first step toward plugins as real standalone apps.
- **Watch an agent live.** A 👁 button on a working project opens a read-only
  window that streams what the agent is doing right now — without interrupting it.
- **Search box on the Plugins panel** (and it was already added to Projects).

**Changed**
- **Tasks tidy themselves.** A run-now or one-time scheduled task now disappears
  once it finishes (it used to linger forever); repeating tasks stay and are now
  **editable in place**. A running task shows "working on this…".
- **Project proposals moved below your task form** so they stop covering it.
- **Calendar clarity.** Past entries grey out with a ✓, a fired reminder turns
  **yellow** ("almost due"), and any upcoming entry is editable.

**Fixed**
- The date/time picker's calendar **icon is now visible** (white) on the dark
  theme, and its popup is dark-themed.

## [0.7.3] — Dogs back on the ground

**Fixed**
- **Dogs (and the cat) no longer look like they're floating.** Their billboards
  were casting a drifting shadow that read as "airborne" (more obvious after the
  v0.7.2 shadow upgrade); they now skip shadow-casting like every other character.

## [0.7.2] — Media, project fixes, a livelier office

**Added**
- **Open chat media in a real window / its folder.** Every image & file in chat
  now has **⤢** (open in a separate, resizable window — the OS viewer/player) and
  **📂** (reveal in the file manager). Click an image for a quick in-app preview,
  or ⤢ for the big window.
- **Search box on the projects list** (OFFICE OPS → Projects) — find a project
  fast as the list grows.
- **Server-room emergencies 🔥.** The server room now occasionally blows up /
  catches fire and an agent **sprints over to put it out** — a little drama that
  finally gives the room a purpose.

**Fixed**
- **Audio & video now play (and seek) in chat** — media is served with HTTP Range,
  which Chromium/WebView2 needs for `<video>`; before, clips often wouldn't play.
- **Project ⏹ Stop now really closes the work window.** It used to leave the
  window lingering so the project looked "still open" and any click re-flagged it
  as active.
- **The 📂 open-folder button works** (it was passing the path to Explorer wrong).
- **Shadows cleaned up** — the hard, jagged, striping/cut-off look is gone
  (orthogonal shadows sized to the room, higher-res map, tuned bias).
- **The projects list stops jumping to the top** every time a status icon
  changes — it remembers your scroll position (and your search).

**Changed**
- **Agents aim for useful work, not junk.** The team now builds genuinely useful
  plugins/apps (no more throwaway-plugin spam), is more selective, and explains
  proposals in enough detail for you to decide.
- **The chase/tag game actually sprints** room-to-room now (you'll see it), with
  effects — instead of a barely-visible shuffle.

**Removed** — nothing.

## [0.7.1] — Voice input fix + audio device settings

**Fixed**
- **Voice dictation now grows the chat box.** A long spoken message used to land
  as multiple lines crammed into one unreadable row (the box only auto-grew while
  *typing*). Dictated text now expands the box exactly like typing does.

**Added**
- **Audio device settings** (⚙ → AGENTS): choose which **microphone** the office
  records your voice from and which **speaker** agent voices + sound effects play
  through — fixes cases where the wrong or too-quiet mic was being used. Your
  choice is remembered. (Speaker selection needs platform support; where it isn't
  available — e.g. macOS — it's disabled with a note pointing to the OS settings.)

## [0.7.0] — Leaner & smarter: Hermes-style memory + native skills

A big efficiency pass. The office is **exactly as capable** — every feature is
still here, agents are as smart, and they keep learning — it just uses far fewer
tokens and stays fast no matter how long it runs. Everything new is reversible
behind a setting (`retrieval`, `nativeSkills`) and falls back to the old
behavior if anything goes wrong.

**Added**
- **Relevance memory (the "Hermes" way).** Instead of pasting an agent's last few
  memories into every prompt, the office now *retrieves only the memories
  relevant to the task at hand* — so answers are better-grounded and cheaper.
- **Per-project memory.** Each project grows its own memory file; agents working
  in a project recall that project's facts specifically.
- **Archive search.** A new `archive-search` skill + a `/recall` lookup let
  agents search past conversations, meetings and notes before answering, instead
  of guessing. Pure on-device keyword search — no extra API cost.
- **Chat timestamps.** Every message now shows its date & time.
- **Click an image to view it full-size**, right inside the chat.

**Changed / Upgraded**
- **Skills are now delivered natively & on demand.** Agents still learn new
  skills automatically (nothing about learning changed), but skill instructions
  are now disclosed only when a skill is actually relevant — they no longer fill
  up every prompt. Same skills, far less overhead. Skills now also reach resumed
  sessions and sub-agents (they didn't before).
- **Lighter team meetings.** Agents discuss using a rolling window of the recent
  exchange instead of re-reading the entire growing transcript each turn (the
  full minutes are still saved). This was the single biggest token drain.
- **Cheaper Director check-ins.** The hourly overview is skipped when nothing has
  changed since the last one, and the default interval moved 30 → 60 minutes.

**Fixed / Performance**
- **The activity log no longer grows forever.** `journal.jsonl` is trimmed to a
  healthy size on startup (it was read in full on every reconnect, which got
  slow over time), and stale chat threads are pruned — your latest thread per
  agent is always kept.
- Overall: dramatically fewer tokens spent during autonomous agent-to-agent
  chatter, delegation and idle check-ins.

**Removed** — nothing. All features are intact.

## [0.6.4] — Director's desk + Thai in the Security Center

- **Fixed — agents stopped stealing the Director's desk.** Freed desks were
  recycled into the shared Ops pool *including the Director's private
  workstation* (`lead_desk`). Since the host session (main) finishes work
  constantly, that desk kept re-entering the pool and other agents would sit at
  it. The Director's desk is now excluded from the pool, so staff reliably use
  the shared Ops desks and only the Director uses the Exec workstation.
- **Fixed — Thai (and other non-ASCII) text rendered as mojibake** in the
  Windows permission card. The `PreToolUse` hook now reads stdin and POSTs its
  body as UTF-8 end-to-end, and the daemon decodes request bodies as UTF-8 in a
  single pass (so multibyte characters that straddle a TCP chunk survive too).

## [0.6.3] — Right Ctrl push-to-talk

- **Changed — Right Ctrl is the default push-to-talk hotkey.** It's rarely typed,
  which makes it ideal for hold-to-talk without clashing with normal typing.

## [0.6.2] — Smooth wallpaper

- **Fixed — wallpaper stutter / idle GPU.** A mis-firing occlusion throttle was
  pinning the renderer at ~2 fps; it's disabled until it can be made reliable.

## [0.6.1] — macOS install & CLI fixes

- **Fixed — macOS installer and path execution** issues (#2, #3) and a stray
  token that broke the `bagidea` CLI on every platform (PR #4 follow-up).
- Groundwork for auto-throttling the wallpaper when it's fully covered.

## [0.6.0] — Usability, office life & cost visibility

- Multiline chat and note inputs; notes can be opened and edited in place.
- More playful ambient life and clearer hotkey discoverability.
- Cost visibility: estimated Claude / Gemini / OpenAI spend surfaced in stats.

## [0.5.0] — First macOS support (beta)

- **First macOS build (beta)** alongside Windows.
- Full internationalization across 14 languages with resilient seed loading and
  atomic i18n cache writes.
- Daemon watchdog so the office never sits brainless after a crash.
- Localized wallpaper agent status plates to match the chosen language.

## [0.4.0] — Translations, sponsors & voices

- Ship UI translations (14 languages).
- Sponsors section (WARRIX as Gold Partner).
- More agent voices and an orb watchdog.

## [0.3.1] — Uninstall & story

- `bagidea uninstall` command.
- Sharpened the product story across README and the website.

## [0.3.0] — Art in the box

- Bundle the free / CC0 art packs (characters, 3D models, sounds) directly in
  the repo, so a fresh install and `bagidea update` carry the full look out of
  the box.

---

*Earlier history predates this changelog — see `git log` for the full record.*

[0.7.4]: https://github.com/bagidea/bagidea-office/releases/tag/v0.7.4
[0.7.3]: https://github.com/bagidea/bagidea-office/releases/tag/v0.7.3
[0.7.2]: https://github.com/bagidea/bagidea-office/releases/tag/v0.7.2
[0.7.1]: https://github.com/bagidea/bagidea-office/releases/tag/v0.7.1
[0.7.0]: https://github.com/bagidea/bagidea-office/releases/tag/v0.7.0
[0.6.4]: https://github.com/bagidea/bagidea-office/releases/tag/v0.6.4
[0.6.3]: https://github.com/bagidea/bagidea-office/releases/tag/v0.6.3
[0.6.2]: https://github.com/bagidea/bagidea-office/releases/tag/v0.6.2
[0.6.1]: https://github.com/bagidea/bagidea-office/releases/tag/v0.6.1
[0.6.0]: https://github.com/bagidea/bagidea-office/releases/tag/v0.6.0
[0.5.0]: https://github.com/bagidea/bagidea-office/releases/tag/v0.5.0
[0.4.0]: https://github.com/bagidea/bagidea-office/releases/tag/v0.4.0
[0.3.1]: https://github.com/bagidea/bagidea-office/releases/tag/v0.3.1
[0.3.0]: https://github.com/bagidea/bagidea-office/releases/tag/v0.3.0
