---
name: vital
description: Operate the user's Vital personal OS (today, inbox, tasks, threads, habits, days, lists, tags, reports, search) through its HTTP API. Use when the user asks to add a task, capture a URL, tick a habit, manage threads or 日子, search inbox or reports, write a daily or weekly report, or otherwise manage Vital data. Requires a personal access token from Settings → 令牌. Use when the user runs /vital.
---

# Vital API

Load **one** module from [references/](references/index.md) for the domain you are calling. Do not open every file. Catalog is generated (`pnpm gen:vital-skill`); do not invent fields or paths.

| If you are… | Open |
| --- | --- |
| Today board | [references/today.md](references/today.md) |
| Tasks (list / create / complete) | [references/tasks.md](references/tasks.md); also [lists.md](references/lists.md) when creating |
| Threads | [references/outcomes.md](references/outcomes.md) |
| Inbox capture / read body | [references/inbox.md](references/inbox.md) |
| Habits | [references/habits.md](references/habits.md) |
| Days / 日子 | [references/days.md](references/days.md) |
| Search | [references/search.md](references/search.md) |
| Daily / weekly report | [references/reports.md](references/reports.md) |
| Unknown error `code` | [references/common.md](references/common.md) |
| Anything else | [references/index.md](references/index.md), then that one module |

## Auth

1. If `VITAL_TOKEN` is missing, ask the user to create one in **设置 → 令牌** and paste it (or export the env var). Never ask them to paste their login password.
2. Base URL: `VITAL_API_URL` if set, otherwise `https://vital.aimo.plus`. Local dev is `http://127.0.0.1:3010`.
3. Send `Authorization: Bearer $VITAL_TOKEN` on every `/api/v1` call. Tokens start with `vt_`, do not expire until revoked, and do not use `/auth/refresh`.
4. Never print the full token in logs, commits, or chat. Refer to it by prefix only (`vt_xxxxxxxx`).

```bash
curl -sS -H "Authorization: Bearer $VITAL_TOKEN" -H "Content-Type: application/json" \
  "$VITAL_API_URL/api/v1/auth/me"
```

Errors are `{ "error": { "code": "...", "message": "...", "details": ... } }`. `401 INVALID_TOKEN` means the token is missing, revoked, or wrong.

## Workflows

Resolve request/response fields from the **one** module in the table above. Prefer these sequences:

**Today.** `GET /api/v1/today` — open threads, tasks, pulse, and now-recommendations.

**Tasks.** `GET /api/v1/tasks?listId=smart:today`. To add one, `GET /api/v1/lists`, pick the inbox or a user list UUID, then `POST /api/v1/tasks`. All-day due date: `dueYmd` as `YYYY-MM-DD` in the account timezone (do not send `dueAt` at the same time). Natural language: `POST /api/v1/tasks/from-text` (needs LLM settings). Complete with `POST /api/v1/tasks/:id/complete`.

**Threads.** `GET /api/v1/outcomes?status=open`. Create with `POST /api/v1/outcomes`. Drill-down: `GET /api/v1/outcomes/:id/detail`.

**Capture a document.** `POST /api/v1/inbox` with `title` and `markdown` or `extractedHtml`. The server stores TipTap `contentJson`. Read the body as Markdown: `GET /api/v1/inbox/:id/markdown` (list/sync omit the body). URL capture: `POST /api/v1/inbox/extract` then `POST /api/v1/inbox` with the preview. Convert to a task: `POST /api/v1/inbox/:id/convert`.

**Habits.** `GET /api/v1/habits`, then `POST /api/v1/habits/:id/tick`.

**Days.** `GET /api/v1/days`. Create with `POST /api/v1/days`.

**Search.** `POST /api/v1/search` with `{ "q" }`. Optional `types`: `task`, `inbox`, `report`. Grouped quick search: `GET /api/v1/search?q=`.

**Daily / weekly report.** `GET /api/v1/reports/current?type=daily` (or `weekly`). Save with `PATCH /api/v1/reports/:id` and the current `revision`. Agent notes (daily only): `POST /api/v1/reports/:id/generate`.

Do not use register/login/refresh, change-password, or LLM key endpoints unless the user explicitly asks. Do not create extra tokens unless asked.

When the catalog and a live 400 disagree, trust the live error `details` and the generated catalog — not memory.
