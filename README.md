# Fin Nest

> 一款可自部署的**个人 / 家庭记账 Web 应用**——多用户、多账本、成员协作，覆盖记账、账户与净资产、计划与预算、自动 / 快捷记账、保险与物品档案、附件、统计、导入导出、AI 助手、飞书机器人，数据完全掌握在自己手里。

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
- 🤖 **AI 助手（可选）**：接任意 OpenAI-compatible 端点（DeepSeek / 通义 / 本地 Ollama 等），自然语言记账与查询统计；AI 只产出待确认草稿卡片、不直接写库，金额换算走确定性代码。
- 💬 **飞书机器人（可选）**：在飞书私聊里自然语言记账与查询，能力对齐 Web 端 AI 助手；草稿卡片一键确认入账 / 作废，与 Web 共用幂等键，跨端重复点击也不会重复入账。
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

### AI 助手（可选启用）
- 配置 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 即启用；未配置时接口返回未启用、前端自动隐藏入口。
- 支持两种上游协议：OpenAI-compatible `/chat/completions`（DeepSeek / 通义 / 本地 Ollama 等，默认）与 OpenAI Responses API `/responses`。默认按 `AI_BASE_URL` 末段推断，必要时用 `AI_PROTOCOL=chat|responses` 显式指定；工具调用、流式增量、思维链隐藏在两种协议下行为一致。
- 聊天页 `/ai`（移动端底部导航独立入口 / 桌面侧边栏入口）：自然语言记账与查询，SSE 流式输出，思维链不透出。
- **自然语言记账**：LLM 通过工具调用只产出**记账草稿卡片**（不直接写库），用户直接确认或进表单编辑后保存，均带幂等键入账并回写卡片状态；支持按名称调用自己的快捷模板生成草稿（金额 / 日期 / 备注可覆盖）。
- **查询与统计**：逐笔明细查询；日 / 周 / 月 / 季度 / 年 / 自定义区间收支统计（分类饼图 + 一级分类汇总，趋势类问题额外返回自动选粒度的折线图）；账户余额、预算进度卡片；另有计划进度、保险 / 物品 / 订阅档案、自动记账规则与待确认、提醒汇总等只读查询由模型文字转述。
- **财务正确性延续**：金额换算（账本币种主单位 → micros）在确定性代码中完成；分类 / 账户 / 人员的真实 id 注入系统提示并由后端二次校验归属与类型；统计口径同样采用有效金额。
- 会话按创建者私有并持久化（`ai_conversations` / `ai_messages`，软删）；工具循环上限 6 轮。

### 飞书机器人（可选启用）
- 配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（飞书自建应用）即启用；采用**长连接**形态，API 主动连飞书，无需公网回调地址与签名校验。未配置时不建连、前端自动隐藏入口。
- **身份绑定**：Web 端「更多 → 飞书机器人」生成一次性绑定码（10 分钟有效、明文只返回一次、库内只存哈希），私聊机器人发送「绑定 <码>」完成绑定；绑定码仅限私聊使用，群内发送会被拒绝。支持解绑（软删）与切换账本。绑定时会尝试拉取飞书昵称供 Web 端辨认（需应用开通 `contact:user.base:readonly` 权限；未开通时降级显示 open_id 尾段，不影响绑定）。
- **自然语言记账与查询**：私聊直接发文本、群聊 @ 机器人，复用 AI 助手能力；记账草稿以交互卡片呈现，在飞书内点「确认入账 / 作废」，与 Web 端共用同一幂等键，跨端重复点击不重复入账。
- **卡片操作鉴权**：点击者必须已绑定，且其绑定身份须为卡片所属会话的本人，防止群内他人点按钮往你账本写账。
- **事件可靠投递**：消息事件先落库（`feishu_events`，`event_id` 唯一去重）再异步消费，进程重启不丢已收消息；卡片按钮回调同步处理以保证手感。

### 提醒红点
- `reminder-summary` 聚合入口，一处汇总：自动待确认、加入申请（owner）、保险 30 天内到期、订阅 30 天内续费、计划超限、预算超限。

### 导入导出与备份
- Excel 全量导出 / 记账模板下载 / 增量导入（`dryRun` 同步返回预览，正式导入入队后台 job，`import_jobs` 表跟踪状态）。
- JSON 全量备份与**覆盖式恢复**（仅 owner，需输入账本名二次确认；恢复时重新生成全部 UUID）。

### 附件
- 客户端 multipart 上传 → API 校验（成员 + 归属 + MIME 白名单 + 20MB 上限）→ 服务端写入 MinIO。
- 下载由 API 鉴权后代理流式返回（不使用预签名 URL）；对象 key 不含原始文件名。
- 删除业务对象联动清理附件，MinIO 删除失败入 `file.delete` job 自动重试。

> 预留能力：`ServiceToken` 鉴权链路（scope / CIDR 白名单 / 代表用户）已建模但暂未接入业务端点，为将来外部系统集成（如 iOS 捷径）预留；应用内 AI 助手走用户自己的 session 鉴权，不经 service token。

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
  db/             # Prisma schema + 迁移 + client（45 个模型）
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

一条命令拉起内置 PostgreSQL + MinIO + 迁移 + api + worker + web 全栈。

### 方式一：拉取预构建镜像（推荐）

无需本地构建，直接拉 GHCR 上的多架构镜像（`linux/amd64` + `linux/arm64`，NAS / 树莓派 / Apple Silicon 通用）：

```bash
cp .env.docker.example .env.docker      # 至少改 POSTGRES_PASSWORD、MINIO_SECRET_KEY
docker compose --env-file .env.docker up -d
# 浏览器访问 http://<host>:4001
```

不在仓库内部署时，只需下载 [`docker-compose.yml`](docker-compose.yml) 和 [`.env.docker.example`](.env.docker.example) 两个文件到任意空目录即可，上面的命令原样可用。

> 在仓库内可用等价的简写：`pnpm compose:up` / `compose:pull` / `compose:logs` / `compose:down`。这些是 `package.json` 里的 scripts，**独立部署目录没有 `package.json`，用不了**，请用完整的 `docker compose` 命令。

镜像版本由 `.env.docker` 的 `FIN_NEST_VERSION` 控制，默认 `latest`；**生产建议钉具体版本**，升级可控、可回滚。注意镜像 tag 不带 `v` 前缀——git tag `v1.2.0` 对应镜像 tag `1.2.0`（也可只钉次版本 `1.2`）。升级：

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

### 方式一之二：变量内联（不需要 `.env` 文件）

群晖 Container Manager、QNAP Container Station、TrueNAS、Portainer 这类「粘贴一份 compose 就能部署」的界面通常不读 `.env`，用变量内联版——所有配置直接写在文件里，无变量插值、无 `profiles`（这两样在这类界面上都会失效，`profiles` 更会导致数据库和存储**根本不启动**）：

| 文件 | 适用 |
| --- | --- |
| [`docker-compose.inline.yml`](docker-compose.inline.yml) | 含内置 PostgreSQL + MinIO，开箱即用 |
| [`docker-compose.inline-external.yml`](docker-compose.inline-external.yml) | 只跑应用，数据库与对象存储都用已有的 |

只想外置其中一个的话，从 `docker-compose.inline.yml` 出发删掉不需要的服务和卷即可，文件头有说明。

把文件内容粘进 compose 编辑框，改掉标了 `★ 必改` 的几组值即可。注意没有变量插值，**同一个值在多处重复出现**，必须全部改成同一个（文件头列了每组的准确处数和用于自查的搜索关键字）。最容易漏的是 `minio-init` 那处——它藏在一行 shell 命令里，不在 `environment:` 块中。

其中附件存储密钥保留默认值时 **API 会拒绝启动并报错**，这是故意的防呆——不是部署失败。

用外部依赖时另需注意：数据库要**先建好**（迁移只建表，不会创建 database 本身），数据库在同一台宿主机上时不能填 `localhost`（那是容器自己的回环地址），对象存储的 bucket 也要自己建并保持非公开——详见 `docker-compose.inline-external.yml` 文件头的「常见坑」两节。

### 方式二：从源码构建（开发 / 改了代码）

```bash
cp .env.docker.example .env.docker
pnpm docker:up                          # = docker compose -f infra/compose/docker-compose.prod.yml up -d --build
```

### 通用说明

启动顺序由 compose 编排：`postgres` 就绪 → `migrate` 应用迁移并退出 → `api` / `worker` 启动 → `web` 启动。对外只需暴露 `web`（4001），`web` 容器内已把 `/api` 转发到 `api` 服务，同源访问；如需统一域名 / TLS 可在前面加 nginx（见 `infra/nginx/fin-nest.conf.example`）。

- **API 服务不能改名**：`web` 镜像里 Next 的 `/api` 转发目标在**构建期**固化为 `http://api:4000`，compose 中的服务名必须保持 `api`，否则前端所有请求 502。
- **API 端口默认只绑 `127.0.0.1`**：`web` 容器走 docker 网络访问 API，不依赖发布端口。发布到本机回环仅为宿主机调试 / 前置 nginx 反代。确需其他机器直连 API 才把 `API_EXPOSE_BIND` 设为 `0.0.0.0`，且此时必须保持 `TRUST_PROXY=false`。
- **使用外部数据库 / 对象存储**：在 `.env.docker` 中置空 `COMPOSE_PROFILES=`，并把 `DATABASE_URL` / `MINIO_*` 指向外部服务，再执行相同的启动命令。
- **数据安全**：内置 postgres 数据存于命名卷 `pgdata`，`down` 不会删卷；迁移一律走 `prisma migrate deploy`，**只应用未执行的迁移，绝不重置已有数据**。

更多细节（单目标镜像构建、单独运行等）见 [`infra/docker/README.md`](infra/docker/README.md)。

---

## ⚙️ 环境变量

完整权威定义在 [`packages/config/src/index.ts`](packages/config/src/index.ts)，常用项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（必填） |
| `MINIO_*` | 对象存储配置；**生产必须改强 `MINIO_SECRET_KEY`**，弱默认值会拒绝启动 |
| `WEB_ORIGIN` | CORS 放行来源（逗号分隔）；同时用作应用锁 WebAuthn 的 expectedOrigin |
| `APP_LOCK_RP_ID` | 应用锁 Face ID 的 WebAuthn RP ID，默认取 `WEB_ORIGIN` 第一项的 hostname；多域名部署才需显式指定 |
| `TRUST_PROXY` | 有可信反代（nginx）时设 `true`，直连保持 `false`（详见「安全基线」） |
| `APP_TIMEZONE` | 「今天 / 本月」的时区（默认 `Asia/Shanghai`），影响统计月份与自动记账触发时点 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | AI 助手（可选）：三项都配置才启用 |
| `AI_PROTOCOL` | AI 上游协议 `chat`（`/chat/completions`，默认）或 `responses`（OpenAI Responses API）；不填按 `AI_BASE_URL` 末段推断 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书机器人（可选）：两项都配置才启用，长连接形态无需回调地址 |
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
| `pnpm check:compose` | 校验四份 compose 的一致性（CI 每次 PR 跑） |
| `pnpm compose:up` / `compose:pull` / `compose:logs` / `compose:down` | 生产整栈（拉取预构建镜像） |
| `pnpm docker:up` / `docker:down` / `docker:logs` | 生产整栈（从源码构建） |

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

## 🧮 数据模型（45 个模型）

| 分组 | 模型 |
|---|---|
| 身份与系统 | User, AppSetting, Session, ServiceToken |
| 账本协作 | Ledger, LedgerMember, LedgerInvite, LedgerJoinRequest |
| 记账配置 | RecordSetting, Category, Subcategory, Person |
| 账户 | Account, SubAccount, AccountAdjustment, AccountEntry |
| 交易 | Transaction, TransactionAccountRelation, TransactionLink |
| 自动化 | AutoRule, AutoPendingTransaction, QuickTemplate |
| 计划预算 | Plan, PlanShareToken, BudgetSetting, CategoryBudget |
| 档案 | Insurance, InsuranceInsuredPerson, InsuranceTypeOrder, ItemType, Item, SubscriptionCategory, Subscription |
| AI 助手 | AiConversation, AiMessage |
| 飞书机器人 | FeishuBinding, FeishuChatSession, FeishuBindCode, FeishuEvent |
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
| [`docs/FEISHU_BOT_PLAN.md`](docs/FEISHU_BOT_PLAN.md) | 飞书机器人接入方案（事件链路、绑定、卡片、鉴权） |
| [`infra/docker/README.md`](infra/docker/README.md) | Docker 部署细节 |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI 协作须知（硬规则 + 指向 PROJECT_GUIDE） |

---

## 📄 License

[MIT](LICENSE) © 2026 BreezeJ
