# Research decisions and production readiness

A research packet explains a design choice. It does not establish that the design has been implemented, tested or approved for release. Define release criteria from the product workload before running the evaluation.

| Gate | Example evidence to collect |
| --- | --- |
| Quality | Versioned representative tasks, baseline comparison, accepted/failed counts and reviewer notes. Explain uncertainty and critical failures separately from average scores. |
| Performance | Declared hardware, artifact/runtime versions, cold/warm latency, concurrency, memory limits and overload behavior. Use an explicit interactive or batch budget. |
| Security | Relevant threat model, data flows, tool/process boundaries, credential handling, negative tests and dependency advisories. An in-process extension is a trusted dependency unless isolation is independently established. |
| License | Exact artifact inventory, applicable license texts, intended use and reviewed restrictions or unresolved questions. |
| Integration | Text and required tool/structured-output contracts, Unicode, partial responses, timeouts, cancellation and fallback behavior. |
| Recovery | Restore and rollback exercise, interrupted-write behavior and protection against duplicate irreversible effects. Preserve authoritative data and make derived indexes rebuildable. |
| Observability | Useful failure/timing/resource evidence, sensitive-data handling, an operator runbook and bounded retention. |

For a local-only requirement, preload authorized artifacts and measure the complete process tree with external access denied. Record attempted egress and degraded behavior; a local model route is only one part of the workflow.

Pin the tested configuration and retain the previous working version. Changed artifacts, runtime versions, hardware or requirements trigger the relevant evaluation again. Keep proposed checks, completed measurements and release approval as separate records.
