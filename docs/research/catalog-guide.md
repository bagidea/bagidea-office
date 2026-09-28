# Open-source AI discovery catalog

This inventory covers every project/resource link in the 14 numbered sections of the [f2dac discovery list](https://github.com/f2dac/awesome-opensource-ai/blob/main/README.md). It gives Office Leads a broad starting point before architecture or design decisions. The [Office research protocol](RESEARCH_PROTOCOL.md) determines what evidence a Lead must collect before proceeding.

The checked-in snapshot contains **781 category placements and 738 distinct URLs**, retrieved at `2026-09-28T05:01:37.814Z`. The README itself says **Updated April 29, 2026**. Its latest README commit returned by GitHub was [`b655d7e800736f88020aa36ce6198329be0b4519`](https://github.com/f2dac/awesome-opensource-ai/commit/b655d7e800736f88020aa36ce6198329be0b4519), dated `2026-04-29T06:18:07Z`. Read `catalog.json` for provenance after subsequent refreshes. A fresh fetch does not make the listed projects or model recommendations current.

## Refresh and offline use

From the Office application directory, with Node.js 18 or newer:

```powershell
node scripts/research-catalog.js
node --test daemon/tests/research-catalog.test.js
```

The refresh has no package dependencies. It obtains the most recent README commit from GitHub's API, downloads that exact commit's README, and writes `docs/research/catalog.json`. It does not install, execute, scrape, or contact any listed project. Run it before preparing a new research brief, then independently check the shortlisted projects' primary sources on the actual research date. The command uses the system clock and records the complete UTC timestamp; it has no hard-coded current year or recommended model version.

For an offline README or test fixture:

```powershell
node scripts/research-catalog.js --input path/to/README.md --output tmp/catalog-fixture.json
```

An offline import is explicitly marked `local-input`. It is not evidence that GitHub was checked. Use a separate output when experimenting with fixtures. Live refresh requires all 14 non-empty categories; offline imports may contain a subset for tests.

## What is recorded

`catalog.json` is a discovery inventory, not an approved stack:

- `schemaVersion`: currently `1`.
- `source`: the requested source URL, exact fetched raw URL, README commit SHA/status, metadata check time, content SHA-256, and the README's own declared update date when present.
- `checkedAt`: when a successful content refresh was completed, in UTC.
- `entries`: name, URL, category, and subcategory. Descriptions and badge claims are excluded.
- `categories`: section number, section name, and number of placements.
- `changes`: additions/removals since the previous output and its check time. First import treats all entries as additions. A rename or category move appears as a removal and addition. The same project can legitimately occur in different categories.

Commit status `verified` means that the README was pinned to a valid commit returned by GitHub. It does **not** verify a project's license, security, benchmark, release, local operation, or production readiness. `unavailable` means that README content was fetched but commit metadata could not be obtained; the reason is recorded as `commitError`. `local-input` denotes a supplied local document.

Requests have a 15-second deadline each, a 2 MiB README limit, a 512 KiB metadata limit, and at most three redirects. Only HTTPS on `api.github.com`, `raw.githubusercontent.com`, or `github.com` is allowed for refresh requests and redirects. Remote content is parsed as data. An unsuccessful content fetch, incomplete live category set, parsing error, or unreadable previous cache exits nonzero and leaves the previous cache and its freshness timestamp intact. Writes use a temporary file followed by an atomic rename. There is no background scheduler in this command.

## Category coverage and Lead research scope

Counts below describe the checked-in snapshot. Later refreshes update `catalog.json`; consult that file for new counts. Assign a reviewer appropriate to the task; the [research protocol](RESEARCH_PROTOCOL.md) defines the evidence record.

| # | Source category | Placements | Lead research before design |
|---|---|---:|---|
| 1 | Core Frameworks & Libraries | 118 | Engineering: language/runtime fit, CPU/GPU backends, maintained versions, packaging and reproducibility. |
| 2 | Open Foundation Models | 54 | Engineering; Creative for creative models: exact checkpoint/revision, model card and weight license, local hardware fit, quantization, tool use, multilingual quality. |
| 3 | Inference Engines & Serving | 40 | Engineering with Operations for readiness: OS and accelerator support, memory/context budget, concurrency, cancellation, structured output and measured latency. |
| 4 | Agentic AI & Multi-Agent Systems | 89 | Engineering: durable state, delegation boundaries, tool authorization, retry/idempotency behavior, recovery and tracing. |
| 5 | Retrieval-Augmented Generation (RAG) & Knowledge | 84 | Engineering: ingestion fidelity, embedding/reranker revisions, provenance, access control, deletion, retrieval quality and restore. |
| 6 | Generative Media Tools | 38 | Creative: exact model/workflow licensing, local compute/storage needs, deterministic assets, quality checks and content provenance. |
| 7 | Training & Fine-tuning Ecosystem | 54 | Engineering; Creative for creative outcomes: whether tuning is needed, data rights, reproducible training, evaluation regressions, adapter/runtime compatibility. |
| 8 | MLOps / LLMOps & Production | 66 | Operations with Engineering for technical design: observability, health checks, backup/restore, deployment/migration, incident recovery, service objectives and operational cost. |
| 9 | Evaluation, Benchmarks & Datasets | 32 | Engineering for technical evaluation; Creative with reviewer for creative criteria: task-specific offline fixtures, comparable hardware/settings and regression thresholds. |
| 10 | AI Safety, Alignment & Interpretability | 29 | Engineering: threat model, prompt injection, sandbox permissions, secrets, dependency advisories and adversarial tests. |
| 11 | Specialized Domains | 57 | Cross-discipline team: domain validity, data sensitivity, expert review needs and domain-specific failure criteria. |
| 12 | User Interfaces & Self-hosted Platforms | 40 | Engineering with Creative for creative interface requirements: actual local operation, account/telemetry requirements, authentication, accessibility, upgrades and data export. |
| 13 | Developer Tools & Integrations | 50 | Engineering: protocol compatibility, dependency maintenance, tool scope, deterministic builds and supply-chain review. |
| 14 | Resources & Learning | 30 | Each accountable Lead: discover primary references and reproducible examples; corroborate community/tutorial claims before recommending a stack. |
| | **Total** | **781** | **Every relevant Lead owns the evidence for their design choice.** |

## From discovery to a production decision

Select the relevant category/subcategory and compare a small set of viable candidates against the project baseline. Record exact versions and model revisions, official repository/release/model-card/license URLs, retrieval dates, support status, local hardware/OS compatibility, required network access, limitations, and a reasoned selection. Keep the distinction between open-source software, open weights, source-available software, and a proprietary dependency explicit.

The list's names, license labels, maintenance claims, production claims and superlatives are third-party assertions. None are inherited as approval. This list is broad but not exhaustive of the AI ecosystem; it can omit new releases, include stale projects, or mix projects that cannot satisfy a local-only design. Use it to discover candidates, expand with current primary-source research, and evaluate the actual Office workload before adoption.

For a local production choice, measure the target machine and workload: model/task quality, p50/p95 latency, time to first token, throughput at expected concurrency, peak RAM/VRAM, context settings, tool-call correctness and failure recovery. An unavailable network or unresolved license/hardware result belongs in the brief as an unknown; it must not be replaced with a claim of current verification. The [main research guide](README.md) and [research protocol](RESEARCH_PROTOCOL.md) explain the evidence checker and evaluation worksheets.
