# Durable Agent Scheduling Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review each task.

**Goal:** Deliver approved per-user proactive Agent scheduling with restart-safe execution.
**Architecture:** PostgreSQL durable jobs, fenced execution leases and persistent event generations. Separate model proposals from transactional effects; incremental memory provenance and atomic budget reservations.
**Tech Stack:** TypeScript, Drizzle, PostgreSQL, Vitest.
**Spec:** docs/superpowers/specs/2026-09-10-agent-durable-scheduling-design.md

## Global Constraints
- Scope every operation to userId; no cross-user contexts.
- No external infrastructure or compatibility layer.
- Pending/debounced/cooldown/retry work survives process restart.
- Do not deploy or modify production data during implementation.

## Task 1: Durable execution
Files: agent/jobs.ts, worker.ts, new agent/job-runtime.ts and schema extension, tests/agent/jobs.test.ts.
- [x] Add failing tests for lease recovery, stale owner fencing, retrigger during run, and restart.
- [x] Implement durable generations, token leases, heartbeat, bounded claiming, transactional effect guard and graceful drain.
- [x] Verify queue tests and review.
Interface: preserve enqueueAgentJob(db,input), processDueAgentJobs(now); expose transaction helper for fenced/idempotent business writes and runtime shutdown.

## Task 2: Per-user events and scheduler
Files: agent/scheduler.ts, new agent/scheduling.ts, tasks/tasks.service.ts, agent/actions.service.ts, agent/routes.ts, configuration, scheduling schema/tests.
- [x] Add tests for event thresholds, persisted deadlines, cooldown retriggers and two-user isolation.
- [x] Persist user-scoped scheduling changes in mutation transactions; replace weekly-only scheduling with event policy and paginated reconciliation.
- [x] Add manual operations and verify scheduling tests.

## Task 3: Transactional results and incremental memory
Files: agent/processors.ts, memory schema/history, memory tests.
- [x] Add tests for feedback-time cursor, unchanged input, protected memory, actual effect counts and task eligibility changes.
- [x] Apply job domain writes through fenced transactions; notification intents use a per-intent lease guard and durable fallback. Store feedback provenance and revisions; distinguish daily maintenance from incremental learning.
- [x] Verify processors and memory tests.

## Task 4: Cost and observability
Files: notifications/insights.ts, llm/model-transport.ts, llm/telemetry.ts, agent/executions.service.ts, retry policy, DTO/UI if required.
- [x] Test intent-before-rewrite, crash recovery, per-user budget concurrency, retry classification and orphan request reconciliation.
- [x] Implement reservation-before-model and persisted budget deferral; stable trigger/result/recovery metadata.
- [x] Generate schema migration after all schema edits; run targeted integration tests, server/web typecheck and lint, final whole-change review.

## Progress
- Plan approved in conversation; implementing on feat/agent-durable-scheduling in current checkout to retain existing installed tooling.
- Migration 0026 generated and applied to test only. Journal timestamp follows the existing maximum so Drizzle will execute it despite older entries carrying future timestamps.
- Server regression: 22 files / 126 tests passed. Final targeted recheck: 7 files / 45 tests passed. Web settings: 3 files / 22 tests passed. Server/web typecheck and lint passed.
- Actual SIGKILL subprocess test confirms committed effects survive termination and are not applied twice.
- Review corrected lock ordering, scheduler/processor eligibility mismatch, reflection bypassing cooldown, manual requests blocked behind budget deferral, and feedback-version identity. No production deployment performed.
