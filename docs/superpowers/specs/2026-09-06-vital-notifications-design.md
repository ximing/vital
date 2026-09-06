# Vital task notifications (MeoW + worker)

Supersedes v1 “reminders stored, no push / no worker” for this slice only. Inbox extract stays in-process.

## Goal

Users configure **push channels** in Settings. First channel: **MeoW**. A dedicated worker process delivers due-soon task notifications without going through a shared HTTP proxy.

## Key Decisions

1. **Same image, second process.** `apps/server` `src/worker.ts` → `node dist/worker.js`. Compose service `worker`. No Redis, no new package.
2. **Transactional outbox + per-channel deliveries.** API writes/cancels rows in the same transaction as task mutations. Worker claims with `FOR UPDATE SKIP LOCKED`.
3. **Fan-out at send time.** One outbox row per event. Deliveries table is per `(outbox, channel)` so a later channel does not double-send MeoW.
4. **Trigger policy (option 2).** If `remindAt` is set and `notifications.taskRemind` → fire at `remindAt` (`task.remind`). Else if `dueAt` is set and `notifications.taskDue` → timed fire at `dueAt`, all-day fire at local `allDayNotifyTime` (default 09:00) on the due date (`task.due`).
5. **MeoW: POST JSON only.** `POST {MEOW_BASE_URL}/{nickname}?msgType=text`. Trust JSON `status`, not HTTP. Dedicated undici `Agent` (no proxy). Nickname is a capability; never log it.
6. **Quiet hours** in `users.timezone`. If the fire instant falls inside the window, delay to `quietHoursEnd`.
7. **Web settings first.** Mobile uses the same API later.

## Out of scope

APNs / FCM / Web Push / email / Bark / ntfy / in-app inbox / HTML MeoW / digests / snooze.

## Data

### `users` (prefs)

| Column | Default | Notes |
|---|---|---|
| `notify_task_remind` | true | |
| `notify_task_due` | true | due fallback when no remind |
| `quiet_hours_start` | null | `HH:MM` or null (off) |
| `quiet_hours_end` | null | required if start set |
| `all_day_notify_time` | `09:00` | local in **task** timezone |

Exposed on `UserProfile.notifications` and `PATCH /auth/me`.

### `notification_channels`

`id`, `user_id`, `type` (`meow` only in this slice), `enabled`, `config` jsonb (`{ nickname }` for MeoW), `last_success_at`, `last_error`, timestamps. Unique `(user_id, type)`.

### `notification_outbox`

One row per event. Unique `idempotency_key` = `{eventType}:{taskId}:{occurrenceAt ISO}`. `occurrenceAt` is current `dueAt` if present, else `remindAt`. Status: `pending | sending | sent | failed | cancelled`. `scheduled_at`, `next_attempt_at`, `attempt_count`, `payload` jsonb, `last_error`.

### `notification_deliveries`

Unique `(outbox_id, channel_id)`. Status `sent` or `failed`. `permanent` boolean. Retry skips `sent` and `permanent` failures.

## Scheduling

Open (`todo`/`doing`), not deleted:

1. `remindAt && taskRemind` → `{ eventType: task.remind, scheduledAt: remindAt, occurrenceAt: dueAt ?? remindAt }`
2. else `dueAt && taskDue`:
   - all-day: local start-of-due-day + `allDayNotifyTime`. If that instant is already past **and** local date is still today (or future), `scheduledAt = now`. Past calendar days are not enqueued.
   - timed: `scheduledAt = dueAt`. Instants older than **15 minutes** are not enqueued (missed).
3. else cancel pending for the task.

Complete / delete / cancel → cancel pending. Recurrence advance → cancel old keys, insert the new occurrence. PATCH of dates → upsert by key (update `scheduled_at` if still pending). Uncomplete / restore → sync again.

Worker start: reset `sending` older than 5 minutes back to `pending`.

No enabled channels at dispatch: leave `pending` (user may add MeoW). Heal every 5 minutes: open dated/reminded tasks in `[now-15m, now+14d]` get `sync`.

Retries: 30s, 2m, 5m, 15m, 1h, 4h, 12h, then `failed` (8 attempts). MeoW JSON 404/403/400 → permanent for that channel; 429/5xx/network → retry.

## MeoW

- Base: `MEOW_BASE_URL` default `https://api.chuckfang.com`.
- Nickname: 1–64 chars, no `/`, no whitespace.
- Body: `{ title, msg, url, imgUrl }`. `url` = `{WEB_ORIGIN}/todos/lists/{listId}?task={taskId}`. `imgUrl` = `NOTIFY_ICON_URL` or `{WEB_ORIGIN}/meow-icon.png` (216×216 PNG).
- Title: `任务提醒` / `任务到期`. Msg: task title + formatted time in task tz.
- Test send from settings does **not** write outbox.

## API

| Method | Path | Body |
|---|---|---|
| GET | `/api/v1/notification-channels` | `{ items: Channel[] }` |
| POST | `/api/v1/notification-channels` | `{ type: 'meow', config: { nickname }, enabled? }` 201; duplicate type 409 `CHANNEL_EXISTS` |
| PATCH | `/api/v1/notification-channels/:id` | `{ enabled?, config? }` |
| DELETE | `/api/v1/notification-channels/:id` | 204 |
| POST | `/api/v1/notification-channels/:id/test` | 204 or 400 `CHANNEL_DELIVERY_FAILED` |

`PATCH /auth/me` accepts `notifications: { taskRemind?, taskDue?, quietHoursStart?, quietHoursEnd?, allDayNotifyTime? }`. Clearing quiet hours: both start and end `null`.

Error codes: `CHANNEL_NOT_FOUND`, `CHANNEL_EXISTS`, `CHANNEL_TYPE_UNSUPPORTED`, `MEOW_NICKNAME_INVALID`, `CHANNEL_DELIVERY_FAILED`.

## Worker / ops

- `pnpm --filter @vital/server worker` (tsx) / `start:worker` (node dist).
- `WORKER_POLL_MS` default 15000, `WORKER_CLAIM_LIMIT` 20, `WORKER_HEAL_INTERVAL_MS` 300000.
- Compose `worker` service: same image, `command: ['node', 'dist/worker.js']`, empty `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`. VPS egress must be a **stable dedicated IP** (MeoW anti-abuse).
- `dev.sh` starts the worker next to the API.

## Settings (web)

Section **通知**: event toggles, all-day time, quiet hours, MeoW nickname + enable + 发送测试 + last error.

## Tests

Unit: schedule matrix (remind vs due vs all-day 09:00 vs disabled vs missed), quiet hours including overnight, MeoW JSON status / 404 permanent / proxy-free dispatcher. Flow: channel CRUD + test seam, create task writes outbox, complete cancels, worker tick sends via mock transport, duplicate type 409.
