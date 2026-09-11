# Vital

A personal operating system: **Capture (Inbox) → Execute (Todos) → Reflect (Reports)**.

Vital is a Chinese-first (`zh-CN`), single-user, self-hosted personal productivity system — todos, read-later, habits, and reviews live together in one calm workspace. No collaboration features to chase, no anxiety to manufacture.

> [中文文档](README.md)

## Philosophy

Vital pursues **Calm Productivity**: when you open it, the first thing you see is "what to do next" — not the system itself.

- **One loop, not a pile of tools.** Drop a link into the inbox, read it later, convert it to a task in one click. Finished tasks flow into the day's review, and ideas distilled in reviews become tomorrow's actions.
- **Content over containers.** Todos, reading, and reviews are directly manipulable information rows, not stacks of cards. Structure comes from typography, hairlines, and rhythm — not borders and shadows.
- **Status with meaning, but no anxiety.** An overdue task only tints its date — never the whole row. No red dots, no big KPI numbers.
- **Single user, your data.** One account is the whole system. Every row in Postgres belongs to you, and you can walk away with it at any time.

The visual theme is **Emerald Garden**: warm paper whites, emerald green, deep ink, and a glowing mint in dark mode. See the full design spec in [docs/vital-calm-productivity-design-system.md](docs/vital-calm-productivity-design-system.md) (Chinese).

## Features

### Today · Start with "the one thing for right now"

The "now" card picks candidates from today's tasks automatically. Together with habit check-ins and ongoing threads, one screen answers "what should I do now?"

![Today](docs/screenshots/today.png)

### Todos · Information rows, not cards

Lists, tags, priorities, time estimates, due dates, and recurrence rules. Habits and threads each get their own views.

![Todos](docs/screenshots/todos.png)

### Inbox · Capture first, read at your pace

Paste a link and the article body is extracted automatically. A list plus a two-pane reader with adjustable font size, archive, favorites, convert-to-task, and attach-to-thread.

![Inbox](docs/screenshots/inbox.png)
![Inbox Reader](docs/screenshots/inbox-reader.png)

### Reports · Leave a trace of what you did

Daily / weekly / monthly / yearly reports share one Markdown editor. Open tasks and read-later items can be auto-filled into the report; past periods are revisited through a calendar heatmap.

![Reports](docs/screenshots/reports.png)

### Search & command palette

Press `⌘K` to open the command palette: navigation and search in one step. Search is powered by Meilisearch (keywords) + Qdrant vector recall + reranking.

![Search](docs/screenshots/search.png)

### More

- **Agent insights**: LLM-driven task decomposition, drafts, and insight notifications — with persistent scheduling, daily model budgets, execution telemetry, and cost observability. LLM keys are configured on demand in Settings.
- **Multi-client sync**: Web (cookie auth), Desktop (Tauri 2), Mobile (Expo), and a Chrome extension (MV3/WXT), all on one sync protocol.
- **Open API**: issue `vt_`-prefixed personal access tokens from Settings. The API catalog is generated from server routes (`pnpm gen:vital-skill`), and ships with a [skill](skills/vital/SKILL.md) that lets agents like Claude operate Vital directly.
- **Push notifications**: the worker process handles reminders and pushes (MeoW).

## Architecture

pnpm workspace + Turbo. Node ≥ 22. Packages are named `@vital/*`.

```
apps/web          Vite / React (cookie auth)
apps/desktop      Tauri 2 (bearer; wraps the web UI)
apps/mobile       Expo (bearer)
apps/extension    Chrome MV3 / WXT (bearer)
apps/server       Fastify 5 + Drizzle + PostgreSQL
packages/tokens   Design tokens (Pulse / Sora)
packages/dto      Zod DTOs and report templates (shared)
packages/api-client  Generated API client
packages/markdown Markdown rendering for the report editor
packages/*       Shared eslint / tsconfig presets
```

| Service                      | Port     |
| ---------------------------- | -------- |
| API (`apps/server`)          | **3010** |
| Web / Vite / Tauri `devUrl`  | **5180** |

## Local Development

```bash
pnpm install

# 1. Prepare a database: any reachable PostgreSQL 16 (requires the pg_trgm extension)
# 2. Configure environment variables
cp apps/server/.env.example apps/server/.env   # replace every change-me; .env is gitignored

# 3. One-command start: migrations + API on :3010 + worker + Web on :5180
./dev.sh
```

After registering in the Web app, you can seed three sample inbox items (development only):

```bash
NODE_ENV=development pnpm --filter @vital/server seed you@example.com
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test          # server tests need the vital_test database from compose (:5433)
```

Before running server tests: `docker compose up -d postgres` (the root compose file provides `vital_test` on port 5433) and configure the test database connection in `apps/server/.env.test` (see `docs/project-standards.md`). Retrieval components (Qdrant / Meilisearch / DashScope embeddings) are all optional — unset pieces degrade the corresponding feature off automatically.

## Deployment

Production uses GHCR images + Docker Compose, in two topologies:

**Bundled Postgres (single host)** — [docker-compose.prod.yml](docker-compose.prod.yml): `migrate → server → worker → web`. The web service exposes an HTTP port; put any reverse proxy in front for HTTPS.

**External Postgres (recommended)** — [docker-compose.prod.external.yml](docker-compose.prod.external.yml): the database and backups live on a dedicated DB host, and compose runs only server / worker. Host nginx (see [deploy/nginx.conf](deploy/nginx.conf)) reverse-proxies to `127.0.0.1:3010`.

```bash
cp .env.production.example .env    # fill in real secrets and PG_HOST; .env is gitignored
docker compose -f docker-compose.prod.external.yml pull
docker compose -f docker-compose.prod.external.yml run --rm migrate
docker compose -f docker-compose.prod.external.yml up -d
```

Health checks: `GET /api/health` (process liveness) and `GET /api/v1/health/ready` (`SELECT 1`).

## Contributing

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

- **Engineering standards**: [docs/project-standards.md](docs/project-standards.md) (Chinese) — test databases, signed URLs for private attachments, visual implementation constraints. Read before touching these areas.
- **Design system**: [docs/vital-calm-productivity-design-system.md](docs/vital-calm-productivity-design-system.md) (Chinese) — the single source of truth for color / type / spacing / components is `packages/tokens`; a token change must update both `theme.ts` and `css/semantic.css`.
- **Database migrations**: edit `apps/server/src/db/schema`, generate migrations with `pnpm --filter @vital/server migrate:generate`, and apply them with `pnpm --filter @vital/server migrate`.
- **API docs**: after changing routes or DTOs, run `pnpm gen:vital-skill` to regenerate [skills/vital/references/api.md](skills/vital/references/api.md).
- **Screenshots**: images in `docs/screenshots/` come from a local dev environment (Emerald Garden theme, light mode). Update them after major UI changes.

Commit messages follow the existing style: `feat: / fix: / refactor: …` (Chinese descriptions).
