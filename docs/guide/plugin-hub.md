# Submitting a plugin to the Plugins Hub

The **Plugins Hub** is the curated catalog of community plugins — browsable on the
[website](https://github.com/bagidea/bagidea-office) and inside the office
(**⋯ → 🧩 Plugins Hub**), where anyone can install a plugin with one click.

This page is for **authors** who want their plugin listed. (To *build* a plugin,
see [plugins.md](plugins.md) first.)

> ⚠️ **Why it's curated.** Installing a plugin runs the author's real code on a
> user's machine. So the catalog is reviewed: you publish your plugin in your own
> GitHub repo and open a pull request to add it here — the maintainers review
> every submission before it appears. Nobody gets write access to the catalog.

---

## How it works

A catalog entry is just a pointer to **your** public GitHub repo. Installing =
the office `git clone`s your repo into `plugins/<id>/` and loads it. You keep full
ownership; updates you push are picked up when a user reinstalls.

```
your repo (plugin.json + code)  ──PR──▶  web/plugins.json  ──▶  Plugins Hub  ──install──▶  user's office
```

## What's on the Hub today

| | plugin | by |
|---|---|---|
| 🕊️ | **Emmaus** — a Bible-counsel companion: tell Selah, a 3D counselor, what you're going through and get Scripture-grounded guidance, practical steps and a prayer, spoken aloud in Thai or English; every quoted verse is checked against the bundled corpus. The Hub's first **official** companion plugin (MIT; the bundled Bible texts keep their own terms) | [bagidea/emmaus](https://github.com/bagidea/emmaus) |
| 🧪 | **Agent Workbench** — test and benchmark agents, save cases for regression | misternay |
| 🎵 | **Music Player** · 🧮 **Calculator** · 👋 **Hello** (the starter template) · 🌐 **Web View** | bagidea |
| 🪙 | **WAX Wallet** — a self-custody wallet for Antelope chains | bagidea |

Not to be confused with the [official plugin **library**](library.md): those eight
ship *with* the office (Campaign Board, Content Pipeline, GitHub Triage, …) and
install by copy; Hub plugins live in their authors' repos and install by clone.

---

## 1 · Build & publish

1. Build your plugin following [plugins.md](plugins.md) — start from the official
   template: `github.com/bagidea/bagidea-office-template`.
2. Make sure your repo's root has a valid **`plugin.json`** with a stable `id`,
   a clear `name`, `version`, and `description`.
3. Push it to a **public** GitHub repo.
4. Install it once in your own office (**🧩 Plugins → paste the GitHub URL**) to
   confirm it clones and loads cleanly.

## 2 · Open a PR to the catalog

Add one entry to [`web/plugins.json`](../../web/plugins.json) and open a pull
request. The `id` **must match your plugin's `plugin.json` `id`** (that's how the
office knows whether it's already installed):

```json
{
  "id": "my-plugin",
  "name": "✨ My Plugin",
  "author": "your-github-handle",
  "repo": "https://github.com/you/my-office-plugin",
  "tags": ["tool"],
  "th": { "desc": "อธิบายสั้นๆ ว่ามันทำอะไร ใครได้ใช้" },
  "en": { "desc": "A short line on what it does and who it's for." }
}
```

| field | required | notes |
|---|---|---|
| `id` | ✅ | matches your `plugin.json` `id`; lowercase, `[a-z0-9_-]` |
| `name` | ✅ | display name (an emoji prefix is nice) |
| `author` | ✅ | your GitHub handle |
| `repo` | ✅ | public `https://github.com/…` URL the office clones |
| `tags` | – | e.g. `tool`, `fun`, `board`, `automation` |
| `th` / `en` | ✅ | a one-line `desc` per language (EN required; TH appreciated — the project is global). Other languages fall back to EN. |
| `official` | – | reserved for plugins the BagIdea team maintains; leave it off |

## 3 · Review

A maintainer reviews the PR — a quick look at the repo for anything obviously
unsafe, that it loads, and that the entry is well-formed. Once merged it shows up
in the Hub for everyone (the in-office Hub fetches the live catalog, so no app
update is needed to see new plugins).

---

## Good citizenship

- **Be honest in the description** — say what it does and what it touches.
- **Don't touch the core.** Plugins must not modify `daemon/`, `godot/`, `shell/`
  or `cli/`. Extend the office through the plugin API (routes, panel, commands).
  See [plugins.md](plugins.md).
- **Keep secrets out** of the repo; read keys from the office at runtime.
- **Version your releases** so users can tell when something changed.

Questions? Open an issue: `github.com/bagidea/bagidea-office/issues`.
