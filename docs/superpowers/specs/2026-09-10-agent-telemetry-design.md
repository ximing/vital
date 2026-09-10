# Unified Agent telemetry
User approved the two-layer design in conversation.

## Contract
- Every application model request is recorded at the shared transport boundary, before sending it. Finalize success/error/abort/truncation with latency, model, provider, tokens/cost when returned. Missing usage is unknown, never fabricated zero. SDK-internal HTTP retries remain part of their SDK request.
- Each execution is running, succeeded, failed, or skipped. Record parent execution, job and attempt; AsyncLocalStorage propagates correlation without business callers writing usage.
- Wrap synchronous task creation, connection tests, background dispatch, and proposal passes (including critic). Failure to submit a proposal still retains every model call.
- Preserve proposal/feedback APIs; add execution listing independently. Link outputs through execution context and action references.
- Existing agent_usage rows are legacy aggregates. Preserve totals but expose legacy counts separately from new per-request counts.
- Central records store safe reason codes, never credentials, prompts, provider response bodies or arbitrary errors.
- Existing unrelated workspace changes remain untouched. No deployment or shared-branch actions.

## UI
System behavior shows execution history plus existing actionable proposals. Usage shows model request count, failure count, unknown-usage count and legacy counts alongside known token/cost sums.
