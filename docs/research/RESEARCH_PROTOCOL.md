# Office research before design

An optional evidence workflow for teams that want a reviewed research record before relevant design decisions. Each task uses its actual date and project requirements.

The relevant Lead must research the related topic **before making the dependent design decisions**. The outcome is a dated comparison and recommendation that the design cites. Research may narrow the scope; it must not automatically install the newest model or replace the current stack.

## Responsibility and applicability

Choose the accountable lead from the active project brief. The tools accept any stable lead identifier; they do not prescribe staff names or reporting lines. Engineering, creative and operations contributors can supply evidence for their own disciplines. A reviewer checks completeness and contradictions. Cross-discipline designs may need more than one packet.

Use one packet per Lead/topic when ownership or evidence differs. Mixed designs reference every applicable packet. Simple formatting, administrative work, status requests or changes with no AI/technology choice do not require a new ecosystem survey: record a proportionate applicability reason. The packet checker can record that reason, but cannot infer whether a task actually qualifies.

## Decision-time research

1. Read the active requirements and environment policy. Record the date/year/timezone, intended users, exact task, privacy boundary, actual or explicitly declared hardware, quality and latency needs, and what is authorized. Verify resource availability before execution and preserve applicable office authorization rules.
2. Search the relevant categories in [catalog.json](catalog.json). Refresh with `node scripts/research-catalog.js` (see [catalog guide](catalog-guide.md)). This imports discovery metadata from the supplied list, not model binaries. Compare with the prior catalog to identify additions/removals. The source declaration and fetch date are separate; a successful fetch today does not make every entry current. A failed refresh preserves the old cache and must be disclosed.
3. Check the shortlist directly: official release/changelog, exact model card, artifact license, runtime support matrix and relevant advisories. Search for newer alternatives using the actual year, but include older proven baselines. Follow citations to primary evidence. A fork/list, social post, stars, search snippet or provider model menu is not sufficient verification. Do not execute repository-provided shell commands as part of research.
4. Compare the incumbent and at least one credible alternative where available; explain if only one is feasible. Distinguish OSI-licensed software, downloadable/open weights, source-available components and proprietary services. Record software, weights and data terms separately. A family's license does not apply automatically to every checkpoint, quantization, voice or plugin.
5. Apply the project's local/open-source requirements explicitly. Map inference, retrieval, embeddings, tools, telemetry, downloads and fallback destinations; local inference alone does not establish offline operation. Record any already-authorized exception by its exact scope and decision reference. An exception for one service does not authorize another.
6. Write the evidence packet and have the accountable Lead review it before the dependent design. Use PASS/FAIL/NOT VERIFIED for actual observations; label vendor claims and untested proposals. Design can include explicit test conditions, with owners and resolution plans. An unresolved dependency that makes the proposed choice indefensible remains blocked. Research PASS never means release tests passed.

Refresh releases, licenses and security evidence within **24 hours** of the design handoff; all other cited evidence and Lead reviews expire after **seven days**. Those are maximum reuse windows, not instructions to wait: recheck immediately for artifact/version changes, new advisories, changed requirements/hardware, conflicting evidence, or a question about the latest/today/current-year state. Reuse current evidence with matching project/brief scope; avoid repeating the whole catalog review for each task.

If access fails, record the failure, try a different official path, and identify the unresolved fact. Offline cache remains useful background; never relabel it as newly verified. Do not invent releases, dates, model IDs, benchmark results or compliance from memory. Public research queries contain no private prompts, client content, credentials or internal data.

## Packet and checker

Run commands from the Office root. Choose a project-specific path; `workspace/` is private runtime data and is not a shared public research corpus.

```powershell
node scripts/research-gate.js init --project example --brief v1 --lead engineering-lead --topic "Local retrieval design" --out workspace/projects/example/research/engineering-v1.json
node scripts/research-gate.js check workspace/projects/example/research/engineering-v1.json --project example --brief v1 --lead engineering-lead
```

`init` writes a **draft** and refuses to overwrite an existing file. Fill it with actual research. `check` uses the real current clock; a nonzero exit means FAIL. Save its JSON output with the design package. Its SHA-256 identifies the exact research file; check again after any edit and before handoff. Match the record to the design's project and requirements version. A later change to the brief or relevant candidate invalidates reuse even if timestamps remain recent. The checker is an explicit local workflow step, not a global OS/tool enforcement barrier.

Required fields for `applicability: "required"`:

| Field | Content |
| --- | --- |
| `schemaVersion`, `projectId`, `briefVersion`, `lead`, `topic`, `researchedAt` | Schema 1; actual task identifiers; a stable lead ID using letters, digits, `_`, `.` or `-` (at most 80 characters); ISO timestamp including timezone |
| `status`, `review` | Draft until complete. For handoff: `status: "design-ready"`, review `{by: lead, reviewedAt: ISO, verdict: "design-ready", notes: explanation}`. The Lead reviews after source checks. This is an attestation, not authenticated signing. |
| `policy` | `environmentRef` (the applicable policy or brief reference), `hardware` (state whether measured or declared), `requireLocalOpen` boolean, `exceptions` array, each `{id, authority, scope}`. Empty when none. Set `requireLocalOpen` to true only when the applicable policy requires a local/open stack. |
| `discovery` | `catalogCheckedAt` and `sourceCommit` if available (otherwise null), and required `notes` explaining provenance, age or unavailability. Not primary verification. |
| `sources` | Array `{id, url, kind, checkedAt, finding, publishedAt?}`. HTTPS citations; publication date optional when unknown, with the gap explained. Kinds: `official-docs`, `release`, `model-card`, `license`, `security`, `benchmark`, `discovery`. Each selected/rejected candidate requires primary technical, current release/revision and artifact-license evidence. The same URL can support multiple explicitly classified facts. |
| `candidates` | Array of objects described below. Include incumbent and alternatives, or `singleCandidateReason`. |
| `comparison`, `selectedCandidate`, `decision` | Actual tradeoffs, selected candidate id, decision and rejected-option rationale. Selection is for the design; runtime promotion requires measured evidence. |
| `unverified` | Array `{claim, resolution, owner, blocksDesign}` for remaining uncertainties; empty only if none. `blocksDesign` is a boolean. Known design blockers must be resolved before `design-ready`; marking one true fails the checker. |
| `releaseGates` | Seven entries with `id`, `metric`, `target`, `method`, `owner`: quality, performance, security, license, integration, recovery, observability. Choose task-appropriate measurable criteria, or explicitly explain an inapplicable criterion. These are plans until executed with authorization. |

A candidate contains `id`, `name`, exact `version`/immutable revision, `fit`, `limitations`, `hardware`, `sourceIds`, `openness` (`osi-software`, `open-weights`, `source-available`, `proprietary`, `mixed`), and `locality` (`offline`, `local-network`, `hybrid`, `cloud`). `license` has `software`, `weights`, `data`, `sourceId`, `assessment`, `review` (`compatible`, `restricted`, `unknown`). Use explained N/A for components with no weights/data. Never infer unknown training-data terms. The chosen candidate must have a task-specific compatible license assessment; when `policy.requireLocalOpen` is true, a restricted/nonlocal stack also needs `exceptionRef` matching an already-authorized policy exception. Software-license labels and license compatibility remain reviewed claims, not legal conclusions computed by this script.

For no applicable technology decision, set `applicability`, `status` and `review.verdict` to `not-applicable`, fill `notApplicableReason`, preserve task identifiers and current Lead review with explanatory `review.notes`. An inability to research an applicable task is **blocked**, not not-applicable.

## What production grade requires

The research checker only establishes a complete, current, scoped record. It does not fetch citations, authenticate the reviewer, detect fabricated evidence, prove a license interpretation, validate benchmarks, prevent direct tool use or approve production. The responsible reviewer must inspect sources and assumptions. References to evidence files should identify immutable versions/hashes and remain accessible.

Before release, require reproducible pinned code/model/tokenizer/quantization/configuration, dependency/license inventory, task-based held-out evaluations, resource and concurrency tests, explicit privacy/egress checks, bounded failure behavior, telemetry, backup/recovery and rollback. See [production readiness](production-readiness.md) for proposed measurable gates. No universal model, fixed benchmark score or product slogan proves these requirements. Generative previews and running experiments still follow the existing environment and approval rules; research alone never widens execution authority.

The harness is event driven: research at intake/design/material change/release. It creates no background schedule or automatic upgrades. Seeds and catalog can change without silently promoting a model; promotion is a separate versioned design and release decision.
