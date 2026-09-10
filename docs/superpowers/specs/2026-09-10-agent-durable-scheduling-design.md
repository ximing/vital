# Durable per-user Agent scheduling

Approved in conversation: four-phase architecture plan, with explicit requirement that service restarts never lose queued work. All reads, tools, mutations, memories and telemetry are scoped to the initiating user. PostgreSQL remains the durable queue; no new infrastructure.

Execution uses expiring leases with heartbeats and fencing tokens. Persist event generations so events arriving during execution remain pending. Apply domain effects and record their generation atomically; replay skips already committed effects. Graceful shutdown stops claiming and drains active work; forced termination is recovered after lease expiry. Delivery is at least once; external model requests interrupted after dispatch may be billed again, with unknown usage preserved.

Scheduling: task mutations debounce cluster for 2 minutes, minimum 4 eligible tasks, 30-minute user cooldown. Thread refresh debounces 30 seconds. New feedback distills after 3 entries or one edited/dismissed entry, 5-minute debounce, 30-minute cooldown; smaller batches run after 24 hours. Daily memory maintenance only runs when data changed. Manual cluster/memory requests bypass cooldown but retain concurrency and idempotency. Persist every deadline and pending change; periodic paginated scans reconcile missing events.

Memory uses feedback-time incremental provenance and immutable revision history; manual entries are protected. Transactions revalidate owned task eligibility, require at least 2 actually attached tasks for a new thread, and record actual effects. Notification intent is reserved before model rewriting with durable recovery.

Observability includes trigger, scope, skips, actual results and correlated model usage. Recover interrupted executions and requests using leases, classify retryable failures and enforce bounded attempts/time. A configurable per-user daily background model-call budget defers autonomous work; manual work remains explicit. Budget reservations must be atomic across workers.

Acceptance: user isolation, event-during-run, pending/cooldown/retry survival, crash after domain commit, stale worker fencing, duplicate notification generation suppression, incremental feedback, and type/lint checks.
