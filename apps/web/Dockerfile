# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# Lockfile lists every workspace package.json. Keep this COPY list in sync with
# pnpm-workspace.yaml or `pnpm install --frozen-lockfile` fails.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/dto/package.json packages/dto/
COPY packages/markdown/package.json packages/markdown/
COPY packages/tokens/package.json packages/tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --filter=@vital/web...

FROM deps AS build
COPY packages/tsconfig packages/tsconfig
COPY packages/eslint-config packages/eslint-config
COPY packages/dto packages/dto
COPY packages/markdown packages/markdown
COPY packages/tokens packages/tokens
COPY packages/api-client packages/api-client
COPY apps/web apps/web
# Same-origin /api; entry nginx + this container proxy to server:3010.
ENV VITE_API_BASE_URL=
RUN pnpm --filter @vital/dto build \
 && pnpm --filter @vital/markdown build \
 && pnpm --filter @vital/tokens build \
 && pnpm --filter @vital/api-client build \
 && pnpm --filter @vital/web build

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
