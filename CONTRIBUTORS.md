# Contributors

BagIdea Office is built in the open. Huge thanks to everyone who has helped — by
sending a pull request, reporting an issue, or testing on a platform we couldn't.

## Maintainer

- **[@bagidea](https://github.com/bagidea)** — creator & maintainer (BagIdea Innovation Co., Ltd.)

## Community contributors

Thank you for the pull requests that made the office better — especially the
early macOS support, when the project was Windows-only:

- **[@spondanai](https://github.com/spondanai)** — macOS support & installer resilience
  ([#4](https://github.com/bagidea/bagidea-office/pull/4)), an early refactor +
  automated tests pass ([#1](https://github.com/bagidea/bagidea-office/pull/1)), and the
  macOS occlusion FPS throttle — 30→2 fps when the wallpaper is hidden
  ([#11](https://github.com/bagidea/bagidea-office/pull/11)).
- **[@misternay](https://github.com/misternay)** (Ritthikiat Jindajak) — a prolific
  contributor across the stack: the macOS/Linux CLI shell-finder
  ([#9](https://github.com/bagidea/bagidea-office/pull/9)), **full macOS support**
  ([#12](https://github.com/bagidea/bagidea-office/pull/12)), TTS hardening
  ([#14](https://github.com/bagidea/bagidea-office/pull/14)), run-lifecycle safety —
  timeouts, graceful shutdown, cross-platform process-tree kill
  ([#16](https://github.com/bagidea/bagidea-office/pull/16)), live chat status +
  inline permission approval ([#18](https://github.com/bagidea/bagidea-office/pull/18)),
  routing each agent's brain in meetings/reflection — the 401 fix
  ([#22](https://github.com/bagidea/bagidea-office/pull/22)), and stopping phantom
  agent seats after hire→delete ([#25](https://github.com/bagidea/bagidea-office/pull/25)).
- **[@skiyo0177-lgtm](https://github.com/skiyo0177-lgtm)** — i18n: the tool-status
  labels in the overlay now respect the selected UI language (zh/en/ja) — translating
  the whole status string before splitting, a `loadTR()` priority fix so the dictionary
  wins over a stale cache, and the missing status-label seed entries
  ([#35](https://github.com/bagidea/bagidea-office/pull/35)).
- **[@bmdy5](https://github.com/bmdy5)** — unified agent-text rendering: a shared
  vendored `md.js` (marked + DOMPurify) served at `/md.js`, so agent output (chat,
  feed, workflow analysis/results, proposals, notes) renders as real markdown through
  one XSS-safe path instead of showing raw markdown and stray `<b>` tags as literal
  text ([#36](https://github.com/bagidea/bagidea-office/pull/36)).
- **[@anupamme](https://github.com/anupamme)** — TLS-hardened the npm bootstrapper:
  the installer fetch now forces HTTPS + TLS 1.2 (`curl --proto '=https' --tlsv1.2`),
  so the install script can't be pulled over a downgraded channel
  ([#37](https://github.com/bagidea/bagidea-office/pull/37)).
- **[@lyfer-bob](https://github.com/lyfer-bob)** — pinpointed the silent macOS install
  failure with a full root-cause: on system bash 3.2 `.`/`source` is a POSIX *special*
  builtin, so `source ~/.cargo/env || true` on the prebuilt-shell path (where Rust is
  never installed) aborts the whole installer before `|| true` can run — plus the exact
  version-independent fix ([#38](https://github.com/bagidea/bagidea-office/issues/38),
  a bug report + diagnosis).
- **[@kmmao](https://github.com/kmmao)** (allen) — unpinned the macOS wallpaper from
  2 fps *while it was fully visible*, with two independent root causes found on their
  own hardware: the occlusion monitor matched the Dock by its **localized** process
  name, so on a non-English system it never matched and the Dock's own full-screen
  window counted as occlusion on every poll; and coverage was judged on
  `CGMainDisplayID()`, so a fullscreen app on the primary throttled a wallpaper living
  on a second monitor ([#43](https://github.com/bagidea/bagidea-office/pull/43)).

> Want to be on this list? Open a PR — see [docs/guide/plugin-hub.md](docs/guide/plugin-hub.md)
> for plugins, or fix anything in the repo. Every merged contribution is credited here
> and on GitHub's Contributors graph.

## Plugin authors

Submitting a plugin to the [Plugins Hub](https://bagidea.github.io/bagidea-office/plugins.html)
means opening a PR that adds your plugin to `web/plugins.json`. When we merge it
(preserving your authorship), you're credited in **three** places:

1. **GitHub Contributors graph** — your catalog PR is a commit authored by you.
2. **The Plugins page** — your plugin card shows `@your-handle` (the `author` field).
3. **This file** — we add you below.

Your plugin's own code lives in your own repo, where you're of course the author.

- **[@misternay](https://github.com/misternay)** — **🧪 Agent Workbench**
  ([repo](https://github.com/misternay/bagidea-office-agent-workbench-plugin),
  [#26](https://github.com/bagidea/bagidea-office/pull/26)) — the **first community plugin**
  in the Hub: test & benchmark agents — run prompts, capture responses, measure token usage,
  and save runs as reusable regression test cases.

## Built with Claude Code

Much of the implementation was pair-built with **Claude** (Anthropic) via Claude Code.
Commits carry a `Co-Authored-By: Claude …` trailer to credit that honestly — which is
why **Claude** appears on the Contributors graph.

---

## For maintainers — merging PRs so credit is preserved

GitHub only lists someone as a contributor when a commit **authored by them** (with a
GitHub-linked email) lands on the default branch. A squash-merge that re-authors the
commit to the maintainer **erases the contributor's credit** (this is why an earlier
merged PR didn't show up).

When merging a community PR, preserve authorship:

- **Preferred — a real merge commit** (keeps every original commit + author):
  ```bash
  gh pr merge <num> --merge
  ```
- **If you squash**, make sure the contributor is still credited — squash keeps the
  PR author as the commit author by default, but verify, and keep any
  `Co-authored-by:` trailers in the squashed message:
  ```bash
  gh pr merge <num> --squash   # then check `git log -1 --format='%an <%ae>'`
  ```
- Never hand-cherry-pick a contributor's work into a commit authored by you without a
  `Co-authored-by: Name <email>` trailer.
