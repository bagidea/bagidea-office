# Install the optional research skill

Run from the Office installation root with Node.js 18 or newer and its daemon running locally:

```powershell
node scripts/install-research-harness.js --plan
node scripts/install-research-harness.js --apply
```

The default is a read-only plan. Applying adds `co-pre-design-research` and a short research rule to each nonhuman employee, including the director. It preserves prompts, other persona fields, tools, models, providers and the human owner. It writes the skill definition to `workspace/research/skills/` and synchronizes its assigned native copies. It does not require a fixed roster size or existing private harness files.

The root must contain this toolset and belong to the daemon selected by `--url`. A custom installation and port can be selected explicitly:

```powershell
node scripts/install-research-harness.js --plan --root C:/Offices/example --url http://127.0.0.1:18787 --config research-install.json
```

Only a loopback HTTP origin is accepted. The tool refuses HTTP redirects. `--root` defaults to the script's installation root; `--url` defaults to `http://127.0.0.1:8787`. Config paths are relative to the command's working directory; paths inside the config are relative to `--root`.

Optional JSON configuration:

```json
{
  "agentIds": ["main", "researcher"],
  "expectedCount": 2,
  "extendSkills": ["requirements-review"],
  "files": ["workspace/OFFICE.md", "workspace/harnesses/researcher.md"],
  "environmentRef": "workspace/ENVIRONMENT_POLICY.md"
}
```

Omit `agentIds` to select all current nonhuman employees. `expectedCount` is an optional guard for the selected set. `extendSkills` appends the same research pointer to explicitly selected editable skills; those skills must exist. These are shared library definitions, so the changed instructions also apply to any other employees assigned those skills. `agentIds` limits profile changes and immediate native synchronization, not the shared library. `files` lists existing Markdown files to update. `environmentRef` points to an existing policy and is referenced without modifying it unless also listed in `files`. No extra skill, file or environment reference is required by default. Paths must be relative `workspace/*.md` paths and may include subdirectories.

Run the plan first with the same options intended for apply. The installer refuses overlong content instead of truncating it, protected skill collisions, unexpected API normalization and stale or missing unrelated native skill copies. Resolve those differences deliberately before retrying; it will not prune native skill directories to make a plan pass.

Before writing, it saves only affected persona/assignment/skill fields and file contents under `workspace/backups/research-harness-*/previous.json`. The full credential-bearing registry is never saved or printed. A step receipt and readback summary are written to `workspace/research/research-install-report.json`. Keep these files private: selected profiles and skills can contain internal instructions.

An interrupted or uncertain write produces an `incomplete` report and is not automatically retried or rolled back. Inspect completed/uncertain steps and subsequent office changes before restoring affected records from the backup. A second successful plan is idempotent. The installer does not run research tasks, modify workflows, restart the daemon or change model/tool/provider assignments.

Organization-specific migration scripts, historic live installation receipts and dated workstation policies are intentionally outside this reusable package.
