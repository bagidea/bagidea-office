# 🧰 The Tools Hub — giving agents new abilities

An agent can only do what its tools let it do. The **Tools Hub** is where you
hand it more of them: a browsable catalog of **43 entries** — the 15 abilities
every agent already has, and **28 MCP servers** you can add with one click.

Open it from the **⋯** menu → **🧰 Tools Hub**, or browse the same catalog on the
website: **[bagidea.github.io/bagidea-office/tools.html](https://bagidea.github.io/bagidea-office/tools.html)**

> **What an MCP server is, in one line.** A small program that exposes a set of
> abilities over a standard protocol. Claude Code speaks it, so anything with an
> MCP server — Blender, GitHub, Postgres, your own script — becomes something an
> agent can operate directly, not something it writes instructions about.

---

## The two kinds of entry

| | |
|---|---|
| ⚡ **Built-in** (15) | Already on the machine — Read, Write, Edit, Bash, Grep, Glob, Web Search, Web Fetch, Sub-agents, Task list, Skills, Notebook Edit, Slash Commands, Background Output, Kill Shell. You don't install these; you **allow** them, per agent. |
| 🔌 **MCP server** (28) | An outside program the office launches for the agent. Adding one from the Hub writes the launch command into the office registry; ticking it on an agent injects it into that agent's session. |

Adding a server to the office and **granting** it to an agent are two separate
steps, and deliberately so — one entry in the registry can be given to the one
agent that should have it and to nobody else.

---

## What's in the catalog

**🧭 Browser (4)** — Web Automation (headed and background, both Playwright MCP),
Chrome DevTools, and agent-browser, a native Rust driver that is faster than
Playwright when you don't need the compatibility.

**🤔 Thinking & memory (5)** — Memory, Sequential Thinking, Context7 (fetches a
library's *current* docs, so an agent stops writing against the version it
remembers), Filesystem, Web Fetch.

**🎨 Creative & game dev (7)** — this is the shelf that grew most in v1.0.0:

| | | |
|---|---|---|
| 🧊 | **Blender 3D** | model, light, render — the agent drives Blender itself |
| 🎮 | **Godot Engine** | open scenes, edit nodes, run the project |
| 🕹️ | **Unity Editor** | drive a running Unity Editor |
| 🔺 | **Unreal Engine** | drive the Unreal Editor |
| 🟥 | **Roblox Studio** | read and write a live Studio session |
| 🎨 | **Figma** | read a design file (needs a Figma token) |
| 🔊 | **ElevenLabs** | high-end voice generation (needs a key) |

**🔮 Knowledge (3)** — Exa Search, Firecrawl, Brave Search.

**💼 Work & data (9)** — GitHub, Google Workspace, Notion, Linear, Slack, Sentry,
PostgreSQL, SQLite, and **➕ Any MCP server** for anything not listed.

---

## Adding one

1. **⋯ → 🧰 Tools Hub**, find the entry, press **Add**. The launch
   command and its name land in ⚙ → **🔌 MCP SERVERS**.
2. If the card says it needs a key or a path, fill it in. A `<folder>` or
   `<path-to-db-file>` in the command is a placeholder — replace it.
3. Open the agent that should have it (⚙ → AGENTS → edit) and tick it under
   its tools.

Nothing is granted office-wide by adding it. An agent with no tick sees no
difference.

### Keys: name them, don't paste them

Prefer a server that reads its credential from the environment over one that
wants the secret inside the command string. Store the key once in
**⚙ → 🔗 CONNECT** and reference it by **name**; the office injects it into the
run's environment. The command string is saved in the office registry — the
environment is not.

This is also why the GitHub entry is the Docker one: `-e GITHUB_PERSONAL_ACCESS_TOKEN`
passes the *name*, so the value travels in Docker's own environment and never
appears in a process listing.

---

## Read the risk line before you press Add

Every card carries a plain-language **risk** line, because these are not equal.
A search server reads public pages. A Postgres server can run statements against
your database. A Slack server can post as you. The Hub says which is which
instead of presenting 28 identical buttons.

Two rules that survive every convenient exception:

- **Grant per agent, not per office.** The agent that needs Postgres is rarely
  the agent that needs Slack.
- **The Security Center still applies.** An MCP tool an agent hasn't been
  granted still raises a card and still waits for you.

---

## The catalog is a file, fetched live

The catalog lives in **[`web/tools.json`](../../web/tools.json)** and the office
fetches it at runtime rather than baking it into a release. A package that gets
renamed is a pull request, not a version bump — offices pick up the correction
without updating.

`GET /tools/catalog` on the daemon returns the same data (with a bundled copy as
the fallback, so the Hub works offline).

### Submitting an entry

Open a PR against `web/tools.json`. An entry is:

```json
{
  "id": "my-server",
  "kind": "mcp",
  "group": "work",
  "icon": "🔧",
  "name": "My Server",
  "cmd": "npx -y my-mcp-server",
  "repo": "https://github.com/me/my-mcp-server",
  "en": { "desc": "…", "risk": "…", "needs": "…" },
  "th": { "desc": "…", "risk": "…", "needs": "…" }
}
```

`en` is required and canonical. `th` is kept alongside it in the same file; the
other twelve languages live in [`web/assets/tools-i18n/`](../../web/assets/tools-i18n/)
as per-language overlay files keyed by the English string — a catalog string with
no translation there fails the test suite, because a page that renders English
inside a Japanese layout is not a supported language.

**Every entry is verified before it merges** — the package must exist under
exactly that name, and its `repository.url` and maintainers must match the
project it claims to be. In the v1.0.0 rebuild seven entries were removed for
pointing at packages npm had deprecated, and one for pointing at a package that
had never existed at all. A one-click catalog is a supply chain; name-squatting
on a popular project's obvious npm name is a known trick.

---

## Beyond the catalog

**➕ Any MCP server** takes anything: ⚙ → TOOLS → 🔌 MCP SERVERS, give it a name
and a launch command. An `https://` URL is connected as a hosted HTTP server;
anything else is run as a command with its arguments. Nothing else to choose.

And when nothing that exists is right, an agent can propose the tool or plugin
that would be — see [the ecosystem](ecosystem.md) and [plugins.md](plugins.md).

---

## See also

- [Agents & skills](agents.md) — granting tools, and where an agent's run happens
- [Web automation](web-automation.md) — the browser servers in depth
- [Plugins](plugins.md) — extending the office itself, not just an agent
