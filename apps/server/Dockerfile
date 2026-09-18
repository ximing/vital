# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# pnpm leaves dangling workspace symlinks if a depended-on package.json is missing
# from this COPY list. Keep deps and prod-deps manifests in sync with pnpm-workspace.yaml.
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/article-doc/package.json packages/article-doc/
COPY packages/dto/package.json packages/dto/
COPY packages/markdown/package.json packages/markdown/
COPY packages/article-html/package.json packages/article-html/
COPY packages/tokens/package.json packages/tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --filter=@vital/server...

FROM deps AS build
COPY packages/tsconfig packages/tsconfig
COPY packages/eslint-config packages/eslint-config
COPY packages/article-doc packages/article-doc
COPY packages/dto packages/dto
COPY packages/markdown packages/markdown
COPY packages/article-html packages/article-html
COPY apps/server apps/server
RUN pnpm --filter @vital/article-doc build && pnpm --filter @vital/dto build && pnpm --filter @vital/markdown build && pnpm --filter @vital/server build

# web 构建需要 web 自己的 devDependencies（vite 等），单独装一份；
# 产物由 server 运行时直接托管（入口 nginx → server，无独立 web 容器）
FROM base AS web-build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/article-doc/package.json packages/article-doc/
COPY packages/dto/package.json packages/dto/
COPY packages/markdown/package.json packages/markdown/
COPY packages/article-html/package.json packages/article-html/
COPY packages/tokens/package.json packages/tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --filter=@vital/web... --filter=@vital/tsconfig --filter=@vital/eslint-config
COPY packages/tsconfig packages/tsconfig
COPY packages/eslint-config packages/eslint-config
COPY packages/article-doc packages/article-doc
COPY packages/dto packages/dto
COPY packages/markdown packages/markdown
COPY packages/article-html packages/article-html
COPY packages/tokens packages/tokens
COPY packages/api-client packages/api-client
COPY apps/web apps/web
# 同源部署：/api 由本进程提供
ENV VITE_API_BASE_URL=
RUN pnpm --filter @vital/article-doc build \
 && pnpm --filter @vital/dto build \
 && pnpm --filter @vital/markdown build \
 && pnpm --filter @vital/tokens build \
 && pnpm --filter @vital/api-client build \
 && pnpm --filter @vital/web build

FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/article-doc/package.json packages/article-doc/
COPY packages/dto/package.json packages/dto/
COPY packages/markdown/package.json packages/markdown/
COPY packages/article-html/package.json packages/article-html/
COPY packages/tokens/package.json packages/tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --prod --filter=@vital/server...

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/article-doc ./packages/article-doc
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/packages/markdown ./packages/markdown
COPY --from=prod-deps /app/packages/article-html ./packages/article-html
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/article-doc/dist ./packages/article-doc/dist
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/packages/markdown/dist ./packages/markdown/dist
COPY --from=build /app/packages/article-html/dist ./packages/article-html/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
EXPOSE 3010
CMD ["node", "dist/index.js"]
