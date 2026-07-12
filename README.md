# Fin Nest

> 一款可自部署的**个人 / 家庭记账 Web 应用**——多用户、多账本、成员协作，覆盖记账、账户与净资产、计划与预算、自动 / 快捷记账、保险与物品档案、附件、统计、导入导出，数据完全掌握在自己手里。

<p>
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white">
</p>

Fin Nest 是一个 monorepo 全栈应用：移动端优先的响应式 PWA（`<1024px` 移动壳、`≥1024px` 桌面壳 + 侧边栏），后端强调**财务正确性**——金额全程整数微单位、账户余额单一入口 + 行锁、编辑删除走反向流水不物理删除、幂等写入、账本级权限隔离。适合个人或家庭在自己的服务器 / NAS 上用 Docker 一键部署。

---

## ✨ 亮点

- 🏠 **自部署，数据自持**：一条 `docker compose` 命令拉起 PostgreSQL + MinIO + 迁移 + API + Worker + Web 全栈，对外只暴露一个端口。
- 👨‍👩‍👧 **多用户 · 多账本 · 成员协作**：邀请码 → 加入申请 → owner 审批的完整协作流；账本级币种与权限隔离。
- 💰 **面向财务正确性的后端**：金额一律整数微单位（micros），余额变更单一入口 + `SELECT ... FOR UPDATE` 行锁，编辑 / 删除走反向流水，关键写操作支持幂等键。
- 📊 **不止流水账**：账户与净资产、计划与预算、自动记账、快捷模板、保险 / 物品 / 订阅档案、多维统计、Excel / JSON 导入导出与备份恢复。
- 📱 **移动优先 + 桌面双形态**：同一套代码响应式适配，移动端类原生手感（底部弹层、二级菜单），桌面端侧边栏 + Modal。
- 🔒 **安全基线内置**：opaque token 鉴权（非 JWT、库存哈希）、scrypt 密码、双层登录限速、附件 MIME 白名单、生产环境弱密钥拒绝启动。

> 界面预览可在此补充截图。将图片放入 `docs/assets/` 后，用 `![首页](docs/assets/home.png)` 引入即可。

---

## 📋 功能特性

### 认证与系统管理
- 邮箱 / 账号 + 密码注册登录；**首个注册用户自动成为系统管理员**并获得一个默认账本。
- 管理员能力：开关全站注册、禁用 / 启用用户、授予 / 撤销管理员（**保底至少保留一名管理员**）、管理 service token。
- 会话安全：改密自动吊销其它会话；禁用用户即时吊销其全部会话。
- 全站审计：注册、改密、管理操作、交易增删改、恢复等写入 `audit_logs`。

### 账本与协作
- 账本 CRUD 与软删（仅 owner 可删）；账本级币种与金额小数位配置。
- 成员管理；**邀请码**（明文只在创建时返回一次、库内存哈希、默认 1 天有效）。
- **加入申请**流转：`pending / approved / rejected / cancelled`，由 owner 审批入伙。

### 记账
- 三种交易类型：**支出 / 收入 / 转账**。
- 一级 / 二级分类（交易存分类**快照**，事后改分类名不影响历史记录）。
- 人员维度（默认「我」）；账户 / 子账户绑定（是否必填由记账设置决定）。
- **关联关系**：可收回 / 需归还四方向关联，区分「原始金额」与「有效金额」。
- 备注、附件、关联保险 / 物品 / 订阅；多条件筛选 + 汇总卡片。

### 账户与净资产
- 账户类型：储蓄 / 信用 / 投资（money 类，支持**子账户**）+ 可收回 / 需归还（往来类）。
- money 账户自动生成「默认子账户」，未指定子账户的记账落到默认子账户，恒满足 `账户余额 = Σ 子账户余额`。
- **余额调整**生成调整记录 + 流水（不静默覆盖），保留完整账户流水。
- 归档要求先清零余额；账户 / 子账户支持拖拽排序。

### 计划与预算
- **计划**：支出限额 / 收入目标，按金额或次数，周 / 月 / 年 / 不重复，`match_rule` 命中规则、命中明细、历史周期、预知能力、停止 / 恢复。
- **预算**：独立建模的月度总预算 + 分类预算，按自然月滚动。

### 自动化与快捷记账
- **自动记账规则**（支出 / 收入 / 转账）：到期由 Worker **只生成待确认记录**（`(auto_rule_id, period_key)` 唯一防重），确认后才真正入账。
- 待确认可编辑 / 单条确认 / 批量确认 / 删除。
- **快捷模板**（支出 / 收入 / 转账）：预填表单或一键直接记账。

### 保险 / 物品 / 订阅档案
- **保险档案**：险种、保司、投保 / 缴费方式、保额、保费、缴费频率与期数、续费方式、被保人、起止日期、终止与恢复、排序。
- **物品档案**：类型、购买价、预期寿命、使用进度、报废与恢复、转卖价、排序。
- **订阅档案**（如 iCloud / Claude / Apple Music）：独立分类（含图标 / 归档 / 排序）、服务商、套餐、费用、计费周期、支付方式、自动续费、开通日 / 下次续费日、退订与恢复。
- 三者均通过 `transaction_links` 关联交易做费用汇总——它们**不是账户、不进净资产**。

### 统计
- 月度收支、分类占比与下钻、人员排行、趋势、净资产序列、现金流序列。
- 口径统一采用**有效金额**（原始金额 − 关联合计）。

### 提醒红点
- `reminder-summary` 聚合入口，一处汇总：自动待确认、加入申请（owner）、保险 30 天内到期、订阅 30 天内续费、计划超限、预算超限。

### 导入导出与备份
- Excel 全量导出 / 记账模板下载 / 增量导入（`dryRun` 同步返回预览，正式导入入队后台 job，`import_jobs` 表跟踪状态）。
- JSON 全量备份与**覆盖式恢复**（仅 owner，需输入账本名二次确认；恢复时重新生成全部 UUID）。

### 附件
- 客户端 multipart 上传 → API 校验（成员 + 归属 + MIME 白名单 + 20MB 上限）→ 服务端写入 MinIO。
- 下载由 API 鉴权后代理流式返回（不使用预签名 URL）；对象 key 不含原始文件名。
- 删除业务对象联动清理附件，MinIO 删除失败入 `file.delete` job 自动重试。

> 预留能力：`ServiceToken` 鉴权链路（scope / CIDR 白名单 / 代表用户）已建模但暂未接入业务端点，为将来 AI / 外部系统集成预留；AI 能力尚未实现。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16（App Router）· Tailwind CSS 4 · TanStack Query · TypeScript |
| 后端 | NestJS 11（API + Worker 双进程）· REST + OpenAPI · opaque token 鉴权 |
| 数据 | Prisma 6 · PostgreSQL 17（citext / 部分唯一索引 / check constraint） |
| 存储 | MinIO（S3 兼容对象存储） |
| 工程 | pnpm 10 monorepo · Docker 多阶段多目标 · 显式数据库迁移 |

> 刻意不引入：Redis、微服务拆分、JWT、AntD / MUI 等带视觉体系的组件库。

---

## 📁 仓库结构

```txt
apps/
  api/      # NestJS HTTP API（业务中枢，所有权限与财务规则在这里）
  worker/   # NestJS Worker（消费 background_jobs：自动记账生成、附件删除重试）
  web/      # Next.js Web（纯前端交互层，经同源 /api 代理调 API）
packages/
  backend/        # api/worker 共享平台：Prisma 注入、事务、幂等、审计、异常过滤、BigInt 序列化
  db/             # Prisma schema + 迁移 + client（37 个模型）
  shared/         # 前后端共享常量 / 类型（金额单位等）
  config/         # 运行时环境变量读取与校验（zod）
  eslint-config/  # 共享 ESLint flat config
  tsconfig/       # 共享 TypeScript 配置
infra/
  compose/  # dev（postgres + minio）与 prod（全栈六容器）compose
  docker/   # Dockerfile 说明与部署细节
  nginx/    # 可选前置 nginx 示例
docs/
  PROJECT_GUIDE.md      # 项目权威入口：功能清单、核心约束、工作流、部署
  DESKTOP_UI_PLAN.md    # 桌面端 UI 改造方案
  DESKTOP_UI_CHECKLIST.md
```

---

## 🚀 快速开始（本地开发）

### 环境要求
- Node ≥ 20（推荐 24，见 `.nvmrc`）
- pnpm 10（`corepack enable`）
- Docker（用于本地 PostgreSQL / MinIO）

### 步骤

```bash
cp .env.example .env          # 配置环境变量
pnpm install                  # 安装依赖
pnpm infra:up                 # 启动 postgres + minio（需 Docker）
pnpm db:migrate               # 执行数据库迁移（DB 起来后）
pnpm dev                      # 启动 API（:4000，文档 /docs）+ Web（:4001）
```

打开 <http://localhost:4001>，**首个注册的用户即为系统管理员**。

> `pnpm dev`（含 `dev:api` / `dev:web` / `dev:worker`）会先执行 `pnpm build:packages` 再启动。
> api/worker 引用的是 `packages/*` 的构建产物（`dist/`，已 gitignore）；新环境若不先构建会报 `Cannot find module '@fin-nest/backend'`。

---

## 🐳 生产部署（Docker）

一条命令拉起内置 PostgreSQL + MinIO + 迁移 + api + worker + web 全栈：

```bash
cp .env.docker.example .env.docker      # 修改密码、域名等
pnpm docker:up                          # = docker compose -f infra/compose/docker-compose.prod.yml up -d --build
# 浏览器访问 http://<host>:4001
```

启动顺序由 compose 编排：`postgres` 就绪 → `migrate` 应用迁移并退出 → `api` / `worker` 启动 → `web` 启动。对外只需暴露 `web`（4001），`web` 容器内已把 `/api` 转发到 `api` 服务，同源访问；如需统一域名 / TLS 可在前面加 nginx（见 `infra/nginx/fin-nest.conf.example`）。

- **使用外部数据库 / 对象存储**：在 `.env.docker` 中置空 `COMPOSE_PROFILES=`，并把 `DATABASE_URL` / `MINIO_*` 指向外部服务，再执行相同的 `pnpm docker:up`。
- **数据安全**：内置 postgres 数据存于命名卷 `pgdata`，`docker:down` 不会删卷；迁移一律走 `prisma migrate deploy`，**只应用未执行的迁移，绝不重置已有数据**。

更多细节（单目标镜像构建、单独运行等）见 [`infra/docker/README.md`](infra/docker/README.md)。

---

## ⚙️ 环境变量

完整权威定义在 [`packages/config/src/index.ts`](packages/config/src/index.ts)，常用项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（必填） |
| `MINIO_*` | 对象存储配置；**生产必须改强 `MINIO_SECRET_KEY`**，弱默认值会拒绝启动 |
| `WEB_ORIGIN` | CORS 放行来源（逗号分隔） |
| `TRUST_PROXY` | 有可信反代（nginx）时设 `true`，直连保持 `false`（详见「安全基线」） |
| `APP_TIMEZONE` | 「今天 / 本月」的时区（默认 `Asia/Shanghai`），影响统计月份与自动记账触发时点 |
| `WORKER_POLL_INTERVAL_MS` | Worker 轮询间隔（默认 30s） |
| `NEXT_PUBLIC_API_BASE_URL` | 浏览器 API 前缀（默认 `/api`，同源代理） |
| `API_INTERNAL_URL` | web 容器内转发 `/api` 的目标 |

---

## 🛠️ 常用脚本

| 脚本 | 说明 |
|---|---|
| `pnpm dev` | 构建 packages 后并行启动 API + Web |
| `pnpm build:packages` | 构建 packages（db 会先 `prisma generate`） |
| `pnpm typecheck` | 构建 packages 后对全 workspace 做类型检查 |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm infra:up` / `infra:down` | 启停本地依赖容器（postgres + minio） |
| `pnpm db:migrate` / `db:deploy` / `db:studio` | Prisma 迁移（dev / prod）与 Studio |
| `pnpm e2e:api` | 后端端到端测试（自动拉起 API，需本地 DB） |
| `pnpm docker:up` / `docker:down` / `docker:logs` | 生产整栈 compose |

> 数据库迁移是**显式步骤**，API / Worker 启动时不自动并发迁移。

---

## 🔐 安全基线

- 会话凭证走 `Authorization: Bearer fn_sess_*` 头（无 cookie、无 CSRF 面）；opaque token，库中只存 SHA-256，session 30 天有效、可吊销。
- 密码 scrypt（N=16384 / r=8 / p=1）；邀请码 / service token 同样高熵随机 + 只存哈希。
- 登录限速双层：`登录名 + IP` 15 分钟 5 次失败，且同登录名（与 IP 无关）20 次失败。
- `TRUST_PROXY` 控制是否信任 `X-Forwarded-For`：**前置 nginx 部署必须设 `true`**，否则限速会把所有客户端算成同一个代理 IP；直连对外必须保持 `false`，否则 XFF 可伪造绕过限速。
- 生产（`NODE_ENV=production`）：Swagger `/docs` 不注册；`MINIO_SECRET_KEY` 为弱默认值时拒绝启动。
- 附件 MIME 白名单（图片 / PDF / Office / 视频），无 SVG / HTML 等可执行类型，上限 20MB。
- DTO 全局 `ValidationPipe`（`whitelist` + `forbidNonWhitelisted`）；CORS 仅放行 `WEB_ORIGIN`。

---

## 🧮 数据模型（37 个模型）

| 分组 | 模型 |
|---|---|
| 身份与系统 | User, AppSetting, Session, ServiceToken |
| 账本协作 | Ledger, LedgerMember, LedgerInvite, LedgerJoinRequest |
| 记账配置 | RecordSetting, Category, Subcategory, Person |
| 账户 | Account, SubAccount, AccountAdjustment, AccountEntry |
| 交易 | Transaction, TransactionAccountRelation, TransactionLink |
| 自动化 | AutoRule, AutoPendingTransaction, QuickTemplate |
| 计划预算 | Plan, BudgetSetting, CategoryBudget |
| 档案 | Insurance, InsuranceInsuredPerson, ItemType, Item, SubscriptionCategory, Subscription |
| 文件 | File, Attachment |
| 平台 | AuditLog, BackgroundJob, IdempotencyKey, ImportJob |

表结构以 [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma) 为准。

---

## 👩‍💻 开发与贡献

- **动手前先读** [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md)：项目权威入口，含功能清单、核心不变式、工作流与部署。
- 硬规则速览（详见 [`AGENTS.md`](AGENTS.md)）：金额一律 micros / bigint；ledger-scoped 方法先 `assertMember`；余额只经 `applyEntry` 变更；编辑删除走反向流水；改后端响应结构须同步更新前端手写契约 `apps/web/src/lib/api/contracts.ts`。
- 提交前至少跑 `pnpm typecheck`；后端行为改动跑 `pnpm e2e:api`（需本地 DB：`pnpm infra:up && pnpm db:migrate`）。

欢迎通过 Issue / PR 参与。

---

## 📚 文档地图

| 文档 | 用途 |
|---|---|
| [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md) | 项目权威入口（功能、约束、工作流、部署） |
| [`docs/DESKTOP_UI_PLAN.md`](docs/DESKTOP_UI_PLAN.md) | 桌面端 UI 改造方案 |
| [`docs/DESKTOP_UI_CHECKLIST.md`](docs/DESKTOP_UI_CHECKLIST.md) | 桌面端双端走查清单 |
| [`infra/docker/README.md`](infra/docker/README.md) | Docker 部署细节 |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI 协作须知（硬规则 + 指向 PROJECT_GUIDE） |

---

## 📄 License

[MIT](LICENSE) © 2026 BreezeJ
