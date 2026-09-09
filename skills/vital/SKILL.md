---
name: vital
description: Operate the user's Vital personal OS (inbox, tasks, lists, tags, reports, search) through its HTTP API. Use when the user asks to add a task, capture a URL, search inbox or reports, write a daily or weekly report, or otherwise manage Vital data. Requires a personal access token from Settings → 令牌. Use when the user runs /vital.
---

# Vital API

Read [references/api.md](references/api.md) before calling any endpoint. That file is generated from server routes and `@vital/dto` (`pnpm gen:vital-skill`). Do not invent fields or paths.

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

Resolve request/response fields from `references/api.md`. Prefer these sequences:

**Today's tasks.** `GET /api/v1/tasks?listId=smart:today`. To add one, `GET /api/v1/lists`, pick the inbox or a user list UUID, then `POST /api/v1/tasks`. Natural language: `POST /api/v1/tasks/from-text` (needs LLM settings).

**Capture a URL.** `POST /api/v1/inbox/extract` with `{ "url" }`, then `POST /api/v1/inbox` with the preview (`title`, `originalUrl`, `extractedHtml` / `extractedText`, `excerpt`, `byline`, `siteName`, `source: "manual"`).

**Search.** `POST /api/v1/search` with `{ "q" }`. Optional `types`: `task`, `inbox`, `report`.

**Daily / weekly report.** `GET /api/v1/reports/current?type=daily` (or `weekly`). Save with `PATCH /api/v1/reports/:id` and the current `revision`.

Do not use register/login/refresh, change-password, or LLM key endpoints unless the user explicitly asks. Do not create extra tokens unless asked.

When the catalog and a live 400 disagree, trust the live error `details` and the generated catalog — not memory.
