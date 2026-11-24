# Model evaluation worksheet

Use this worksheet with the active project brief and [research protocol](RESEARCH_PROTOCOL.md). It contains evaluation questions, not a current shortlist or a claim that a particular model fits the user's machine.

| Area | Evidence to record |
| --- | --- |
| Artifact | Publisher, exact repository/model ID, immutable revision, code and weights hashes, tokenizer/chat template, quantization source/method and runtime version. |
| License | Exact artifact's software, weights and data terms; intended use; unresolved restrictions; reviewer and primary citation. Do not inherit a family's license across all checkpoints. |
| Hardware | Actual or explicitly declared OS, accelerator, available RAM/VRAM, drivers, context size, batch and concurrency; measure memory under the intended workload. |
| Language/modality | Required input/output languages and modalities, representative local fixtures and known unsupported cases. An audio-input model is not necessarily a speech generator. |
| Tools and structured output | Schema validity, multiple tool calls, tool-result recovery, multi-turn behavior, refusals, context overflow and interrupted responses. |
| Retrieval | Recall/ranking quality, grounded citations, access filtering, document updates/deletions and embedding/index version compatibility. |
| Specialist quality | OCR reading order/tables, speech error/timing, media consistency or other task-specific measures. Define thresholds before comparing results. |
| Performance | Cold/warm latency, first visible output, full completion, throughput and peak memory at declared concurrency. Distinguish buffered output from genuine streaming. |
| Operations | Bounded queues, deadlines, cancellation, retry behavior, failure visibility, backup/recovery and exact rollback artifact. |

Compare the incumbent and at least one feasible alternative under equal budgets. Separate publisher claims from measurements on the target workload. Parameter counts, active mixture-of-experts parameters, nominal context length and downloadability do not establish resident memory, quality or offline operation.

Trace every network dependency: inference, compaction, embeddings, OCR, speech, tools, telemetry and fallback routes. A loopback inference server alone does not prove that the full agent workflow is offline.

Record any missing evidence as an owned uncertainty. Select the exact evaluated revision; a mutable alias or newer release is a reason to review, not an automatic promotion.
