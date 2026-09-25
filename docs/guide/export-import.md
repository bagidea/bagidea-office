# 📦 Export / Import BAGIDEA OFFICE

Move an office's reusable configuration to another installation with a ZIP.
Open **⚙ → AGENTS → 📦 EXPORT / IMPORT BAGIDEA OFFICE**, below
**HIRE A TEAM** and its expanded team list.

The archive carries selected office definitions and Markdown instructions. It
does not back up the whole computer, user profile, project files or conversation
history.

## Choose what to transfer

| Category | Contents |
|---|---|
| **Agent team** | Portable agent definitions, personas, roles and skill/tool assignments. |
| **Skills** | Skill definitions and their `SKILL.md` instructions. |
| **MCP tools** | Portable MCP server definitions; credentials must be supplied on the destination. |
| **Workflows** | Workflow definitions. Imported triggers stay disabled until you enable them. |
| **Settings & Markdown** | Supported portable office settings and eligible Markdown files in the working folders. |

Eligible Markdown includes `.md` files at the working-folder root and below
`settings/`, `rules/`, `instructions/`, `skills/`, `workflows/`, `.claude/`,
`.codex/` and `.agents/`.
Notes, memory, projects, history and generated per-agent directories are excluded.
The preview shows the destination for every imported item; it does not offer
arbitrary extraction to another path.

## Export

1. Open **Export / Import**. The export section loads counts from the current office.
2. Leave all categories selected for a complete portable configuration, or select
   only the categories you need.
3. Click **Download ZIP** and save the archive from your browser or desktop
   WebView's downloads. Use **Refresh contents** after changing the office.

Provider credentials, API keys and connection secrets are excluded. Credentials
embedded in custom prose are not a supported way to configure a service; review
your own Markdown before sharing an archive.

## Import

1. Open the destination office's **Export / Import** menu and choose a BAGIDEA
   OFFICE `.zip` under **Import ZIP**.
2. Review the preview's category counts, item names, destination paths, warnings,
   existing-item conflicts and protected items. Choosing a ZIP only previews it;
   nothing is applied at this stage.
3. Select the categories to import and choose how to handle existing items:
   **Keep existing items** is the default and skips conflicts. **Replace existing
   items from this ZIP** updates matching items in the selected categories.
4. Click **Import selected items**. Check the imported/skipped counts and any
   warnings, then use **Back to agents** to inspect the team.
5. Reconnect required services, check local MCP commands and dependencies, and
   review imported workflows before enabling their triggers.

The human CEO, protected teammates and built-in skills are kept even when
**Replace** is selected. The Director (`main`) is an exception: its portable
profile can be replaced explicitly, while its core protection remains enabled.
Destination credentials, security and approval flags, and machine-specific
settings stay in place. Replacement is limited to matching selected items; it
does not remove unrelated destination items to make the destination an exact
copy of the source.

Previews expire after ten minutes and are used once. If a preview expires or an
import cannot be confirmed, refresh the contents and choose the ZIP again before
retrying. Existing-item conflicts are checked again when applying the import.

## Partial transfers and dependencies

Categories are selectable independently, but their contents can refer to one
another. An agent can reference a skill or MCP server, and a workflow can refer
to an agent, project, plugin or external service. Include the corresponding
categories, or make sure those dependencies already exist at the destination.
Project data, plugin installations, executables and service logins are not added
by importing an office archive.

For example, transferring **Agent team** without **Skills** requires the assigned
skills to exist in the destination office. Transferring a workflow that refers to
a local project requires that project and its paths to be set up separately.
Keeping an existing item can also mean that dependent imported items use the
destination's version instead of the source's version. Check the preview and
import warnings for anything that needs attention.

Imported skill definitions are materialized through the office's native skill
sync into assigned agents' `.claude/skills/<skill-id>/SKILL.md` folders. Generated
agent folders are rebuilt from the destination registry; they are not restored
as raw source-machine directories.

## Archive format and limits

The ZIP uses the `bagidea-office` format, version **1**. It contains
`manifest.json` for the archive format and contents, `office.json` for portable
configuration, and the selected Markdown and skill `SKILL.md` files. Use this
feature's export to create a compatible archive; an arbitrary folder ZIP is not
an office archive.

| Limit | Maximum |
|---|---:|
| ZIP file size | 20 MiB |
| Total unpacked content | 64 MiB |
| Each unpacked file | 8 MiB |
| Archive entries | 2,000 |

The importer validates the ZIP and its paths before showing the preview. Entries
cannot escape the supported destination folders. Imported workflow triggers are
disabled regardless of whether they were enabled in the source office.
