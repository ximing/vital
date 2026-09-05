# Vital

Personal OS: Capture (Inbox) → Execute (Todos) → Reflect (reports).

Chinese-first (`zh-CN`) UI. One user per account.

## Monorepo

pnpm workspace + Turbo. Node ≥ 22. Package names `@vital/*`.

```
apps/web          Vite / React (cookie auth)
apps/desktop      Tauri 2 (bearer; wraps web UI)
apps/mobile       Expo (bearer)
apps/extension    Chrome MV3 / WXT (bearer)
apps/server       Fastify 5
packages/tokens   Pulse design tokens, Sora, mark
```

## Dev ports

Do not collide with Moment (`:3000` / `:5173`).

| Service                     | Port     |
| --------------------------- | -------- |
| API (`apps/server`)         | **3010** |
| Web / Vite / Tauri `devUrl` | **5180** |

```bash
pnpm install
pnpm lint
pnpm typecheck
```
