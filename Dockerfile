# syntax=docker/dockerfile:1.7
#
# Fin Nest 多阶段镜像。一个 Dockerfile 产出 4 个可独立构建的运行目标：
#   --target api      NestJS API（默认，监听 4000）
#   --target worker   常驻后台任务进程
#   --target web      Next.js 站点（standalone，监听 4001）
#   --target migrate  一次性执行 `prisma migrate deploy`（只应用未执行的迁移，绝不清空数据）
#
# 单独构建示例：
#   docker build --target api    -t fin-nest-api:latest    .
#   docker build --target web    -t fin-nest-web:latest    .
#   docker build --target worker -t fin-nest-worker:latest .
#   docker build --target migrate -t fin-nest-migrate:latest .
#
# 运行时全部通过环境变量注入配置（见 .env.docker.example），镜像内不含任何机密。

# ---------------------------------------------------------------------------
# base：Node + pnpm + prisma 运行时依赖（openssl）。所有阶段共用。
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
# prisma 查询引擎需要 openssl；ca-certificates 供 HTTPS（MinIO SSL 等）。tini 做 PID 1 信号转发。
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps：仅按 manifest 安装全部依赖（含 dev，用于构建）。放在源码之前以最大化缓存命中。
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/api/package.json      apps/api/package.json
COPY apps/web/package.json      apps/web/package.json
COPY apps/worker/package.json   apps/worker/package.json
COPY packages/backend/package.json      packages/backend/package.json
COPY packages/config/package.json       packages/config/package.json
COPY packages/db/package.json           packages/db/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/shared/package.json       packages/shared/package.json
COPY packages/tsconfig/package.json     packages/tsconfig/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---------------------------------------------------------------------------
# build：拷入源码，构建所有包与应用（含 `prisma generate`），再产出各应用的精简部署目录。
# ---------------------------------------------------------------------------
FROM deps AS build
# NEXT_PUBLIC_* 在 web 构建时被内联进前端产物，故需作为构建参数传入（运行时再改无效）。
# 默认 /api 表示浏览器同源请求，由 web 容器内的 Next 转发到 api 服务，适用绝大多数部署。
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_ENABLE_DEV_UI=false
# Next 的 rewrite 目标在构建期烘焙进产物，故 web 容器内转发 /api 的目标须在此传入。
# 默认本机（单容器 / 同机）；compose 编排传入 http://api:4000 指向 api 服务。
ARG API_INTERNAL_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_ENABLE_DEV_UI=$NEXT_PUBLIC_ENABLE_DEV_UI \
    API_INTERNAL_URL=$API_INTERNAL_URL
COPY . .
# 构建顺序由 pnpm 按依赖拓扑决定：先共享包（含 prisma generate），再 api/worker/web。
RUN pnpm build

# 用 pnpm deploy 生成「仅含运行时所需」的独立目录（解引用 workspace 软链，带上 dist / 生成的 prisma client）。
# inject-workspace-packages 让 workspace 依赖被实际拷入而非软链。
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --config.inject-workspace-packages=true --filter @fin-nest/api    deploy --prod --store-dir /pnpm/store /prod/api  \
 && pnpm --config.inject-workspace-packages=true --filter @fin-nest/worker deploy --prod --store-dir /pnpm/store /prod/worker \
 && pnpm --config.inject-workspace-packages=true --filter @fin-nest/db     deploy        --store-dir /pnpm/store /prod/migrate

# ---------------------------------------------------------------------------
# api：运行 NestJS API。
# ---------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production \
    API_PORT=4000
WORKDIR /app
COPY --from=build /prod/api ./
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# worker：常驻后台任务进程（无监听端口）。
# ---------------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/worker ./
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# migrate：一次性容器，应用未执行的数据库迁移后退出。migrate deploy 不会重置/清空已有数据。
# ---------------------------------------------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/migrate ./
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# web：Next.js standalone 产物。仅需 server.js + 静态资源，无完整 node_modules。
# ---------------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production \
    PORT=4001 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# standalone 以仓库根为追踪根，故其内部结构为 apps/web/server.js + 根级 node_modules。
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 4001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
