# Unified Agent Telemetry Implementation Plan
**Goal:** Automatic model-call accounting and execution history for all current Agent entry points.
**Architecture:** Shared model telemetry owns agent_usage writes; execution service owns lifecycle and AsyncLocalStorage context. Existing domain proposal ledger remains distinct.
**Tech Stack:** TypeScript, Drizzle/Postgres, pi-ai/pi-agent-core, React Query.
**Spec:** ../specs/2026-09-10-agent-telemetry-design.md

## Tasks
- [ ] Schema/contracts: add agent_executions, extend agent_usage with lifecycle/status/correlation and nullable usage, preserve legacy rows. Generate ordered migration. Add execution endpoint/client DTO and tests.
- [ ] Shared execution/model telemetry: begin records before calls, settle in success/error paths, isolate async contexts, safe reason codes. Test provider error, unknown usage, multi-turn and retry correlation.
- [ ] Route completeText, connection testing, harness streams, task creation, background dispatch through telemetry. Remove business-level recordUsage calls. Test current task parsing and Agent suites; ensure no double counts.
- [ ] UI (delegated): execution history states and retained proposal feedback; actual request/legacy/unknown usage counters and regression tests.
- [ ] Verify: migration, server/web type checks and lint; model/task/Agent integration tests, UI tests, boundary architecture test ensuring centralized model transport.
