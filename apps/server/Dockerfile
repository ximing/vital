# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# pnpm leaves dangling workspace symlinks if a depended-on package.json is missing
# from this COPY list. Keep deps and prod-deps manifests in sync.
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/tsconfig packages/tsconfig
COPY packages/eslint-config packages/eslint-config
COPY packages/dto packages/dto
COPY apps/server apps/server
RUN pnpm --filter @vital/dto build && pnpm --filter @vital/server build

FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
WORKDIR /app/apps/server
EXPOSE 3010
CMD ["node", "dist/index.js"]
