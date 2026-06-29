# Fin Nest

个人/家庭记账 Web 应用（移动端优先 PWA）。技术方向与边界见 [`docs/`](docs) 下设计文档，开发任务分解见 [`DEVELOPMENT_PLAN.md`](docs/product/DEVELOPMENT_PLAN.md)。

## 仓库结构

```txt
apps/
  web/      # Next.js Web（App Router, Tailwind 4, TanStack Query）
  api/      # Nest.js HTTP API（REST + OpenAPI）
  worker/   # Nest.js Worker（消费 background_jobs）
packages/
  backend/        # 后端共享平台模块（Prisma/事务/异常过滤等，供 api/worker 复用）
  db/             # Prisma schema、迁移、PrismaClient
  shared/         # 前后端共享类型/常量（金额单位等）
  config/         # 运行时配置读取与校验（zod）
  eslint-config/  # 共享 ESLint flat config
  tsconfig/       # 共享 TypeScript 配置
infra/
  compose/  # 本地依赖 docker-compose（postgres + minio）
  docker/   # Dockerfile（I3 阶段补充）
docs/
  architecture/  # ARCHITECTURE / *_ENGINEERING / *_DESIGN / DATABASE_DESIGN / TESTING_STRATEGY
  product/       # FUNCTION_BOUNDARIES、DEVELOPMENT_PLAN
```

## 环境要求

- Node ≥ 20（推荐 24，见 `.nvmrc`）
- pnpm 10（`corepack enable`）
- Docker（运行本地 postgres / minio）

## 快速开始

```bash
cp .env.example .env          # 配置环境变量
pnpm install                  # 安装依赖
pnpm infra:up                 # 启动 postgres + minio（需 Docker）
pnpm db:migrate               # 执行数据库迁移（DB 起来后）
pnpm dev                      # 启动 API（:4000，文档 /docs）+ Web（:4001）
```

> `pnpm dev`（含 `dev:api` / `dev:web` / `dev:worker`）会先执行 `pnpm build:packages` 再启动；
> api/worker 引用的是 `packages/*` 的构建产物（`dist/`，已 gitignore），新环境直接启动否则会报 `Cannot find module '@fin-nest/backend'`。

## 常用脚本（根目录）

| 脚本 | 说明 |
|---|---|
| `pnpm build:packages` | 构建 packages（db 会先 `prisma generate`） |
| `pnpm typecheck` | 构建 packages 后对全 workspace 做类型检查 |
| `pnpm lint` | 全 workspace ESLint |
| `pnpm format` | Prettier 格式化 |
| `pnpm infra:up` / `infra:down` | 启停本地依赖容器 |
| `pnpm db:migrate` / `db:deploy` / `db:studio` | Prisma 迁移与 Studio |

> 数据库迁移作为显式步骤执行，API/Worker 启动时不自动并发迁移。
