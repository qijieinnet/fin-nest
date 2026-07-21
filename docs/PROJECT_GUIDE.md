# Fin Nest 项目指南

本文件是了解项目的权威入口，描述项目的当前状态；与代码不一致时以代码为准并更新本文。

---

## 1. 项目是什么

个人/家庭自部署记账 Web 应用（移动端优先 PWA，双形态响应式：<1024px 移动壳，≥1024px 桌面壳/侧边栏 + 弹层转 Modal，方案见 [`docs/DESKTOP_UI_PLAN.md`](DESKTOP_UI_PLAN.md)）。多用户、多账本、成员协作；覆盖记账、账户与净资产、计划与预算、自动/快捷记账、保险与物品档案、附件、统计、导入导出。

技术栈：Next.js 16（App Router）+ Tailwind 4 + TanStack Query；NestJS 11（API + Worker 两个进程）；Prisma 6 + PostgreSQL 17；MinIO 对象存储；pnpm monorepo。不用 Redis、不拆微服务、REST + OpenAPI 注解、opaque token 鉴权（非 JWT）。

## 2. 仓库结构

```txt
apps/
  api/      # NestJS HTTP API（业务中枢，所有权限与财务规则在这里）
  worker/   # NestJS Worker（轮询 background_jobs：auto.schedule 生成自动记账待确认、file.delete 附件删除重试）
  web/      # Next.js Web（纯前端交互层，经同源 /api 代理调 API）
packages/
  backend/  # api/worker 共享平台：Prisma 注入、事务封装、幂等、审计日志、background_jobs、异常过滤器、BigInt 序列化
  db/       # Prisma schema + 迁移 + client（37 个模型）
  shared/   # 前后端共享常量/类型（金额单位等）
  config/   # 环境变量读取与校验（zod，见 §9 环境变量）
  eslint-config/ tsconfig/
infra/
  compose/  # dev（postgres+minio）与 prod（全栈六容器）compose
  docker/   # Dockerfile 与部署说明
  nginx/    # 可选前置 nginx 示例
docs/       # 本文件
```

API 模块一览（`apps/api/src/modules/`）：`auth`（含管理员用户管理、service token 管理）、`ledgers`（成员/邀请/加入申请）、`accounts`、`transactions`、`records`（分类/人员/记账设置/统计）、`stats`（月度/净资产/现金流）、`plans`（计划+预算）、`automation`（自动规则/待确认/快捷模板）、`assets`（保险/物品/订阅）、`files`（附件）、`data-transfer`（导入导出/备份恢复）、`reminders`（红点聚合）、`ai`（AI 助手：LLM 工具调用、会话/消息、记账草稿）。

Web 路由（`apps/web/src/app/`）：`/login` `/register` `/ledgers`（含 join）、`/bills`（首页账单，含 new/详情/编辑/pending 待确认）、`/accounts`（含账户/子账户详情）、`/stats`、`/budget`、`/ai`（AI 助手聊天，全屏、移动端底部导航左侧独立入口 / 桌面侧边栏底部入口）、`/more/*`（categories、people、settings、auto、quick、insurances、items、subscriptions、import-export、users、admin、system）。**当前账本不在 URL 里**，由 `LedgerProvider` 全局上下文持有，切换账本时刷新所有 ledger-scoped 查询缓存。

## 3. 功能清单

- **认证与管理**：邮箱/账号+密码注册登录；首个注册用户自动成为系统管理员并获得默认账本；管理员可开关注册、禁用/启用用户、授予/撤销管理员（保底最后一名管理员）、管理 service token。改密吊销其它会话；禁用用户即时吊销全部会话。
- **应用锁（启动验证）**：设备级偏好（更多 → 系统设置），开启后每次整页加载先弹锁定屏；iPhone/iPad 注册本地 WebAuthn 平台 passkey（Face ID / Touch ID，纯客户端设备在场校验，服务端不存公钥），其他设备或回退场景输入登录密码走 `POST /auth/password/verify`（按用户限速）。定位是隐私锁，session token 本身不受影响。
- **账本协作**：账本 CRUD/软删（仅 owner 可删）；成员管理；邀请码（明文只返回一次，库存 hash，默认 1 天）→ 加入申请（pending/approved/rejected/cancelled）→ owner 审批入伙。账本级币种与金额小数位。
- **记账**：支出/收入/转账；一级/二级分类（交易存快照，改名不影响历史）；人员（默认「我」）；账户/子账户绑定（是否必填由记账设置决定）；可收回/需归还四方向关联（原始金额 vs 有效金额）；附件；关联保险/物品/订阅；备注；多条件筛选 + 汇总卡片。
- **账户**：储蓄/信用/投资（money 类，支持子账户）+ 可收回/需归还（往来类）；money 账户自动生成「默认子账户」，未指定子账户的记账落到默认子账户，恒有 `账户余额 = Σ子账户余额`；余额调整（生成调整记录 + 流水，不静默覆盖）；账户流水；归档要求先清零；账户/子账户拖拽排序。
- **计划与预算**：计划（支出限额/收入目标、金额/次数、周/月/年/不重复、`match_rule`、命中明细、历史周期、预知能力、停止/恢复）；预算独立建模（月度总预算 + 分类预算，滚动自然月，不存历史周期）。
- **自动化**：自动记账规则（支出/收入/转账）到期由 Worker 只生成待确认记录（`(auto_rule_id, period_key)` 唯一防重）；待确认可编辑/确认/批量确认/删除，确认才走交易服务；快捷模板（支出/收入/转账）预填或直接记账。
- **保险/物品/订阅**：保险档案（险种/保司/投保方式/缴费方式/保额/保费/缴费频率/期数/续费方式/被保人/起止日期/终止与恢复/险种与同险种保单排序）；物品档案（类型/购买价/预期寿命/使用进度/报废与恢复/转卖价/排序）；订阅档案（套餐订阅如 iCloud/Claude/Apple Music：独立分类[物品类型式，含图标/归档/排序]/服务商/套餐/费用/计费周期/支付方式/自动续费/开通日/下次续费日/退订与恢复/同分类内排序）；均通过 `transaction_links` 关联交易做费用汇总，不是账户、不进净资产。
- **统计**：月度收支、分类占比与下钻、人员排行、趋势、净资产序列、现金流序列；口径统一用有效金额。
- **提醒红点**：`GET /ledgers/:ledgerId/reminder-summary` 聚合自动待确认、加入申请（owner）、保险 30 天内到期、订阅 30 天内续费、计划超限、预算超限。
- **导入导出**（模块 `data-transfer`）：Excel 全量导出 / 记账模板下载 / 增量导入（`dryRun` 同步返回预览；正式导入入队后台 job，`import_jobs` 表跟踪状态）；JSON 全量备份与覆盖式恢复（仅 owner，需输入账本名确认；恢复时重新生成全部 UUID）。
- **AI 助手**（模块 `ai`，可选启用）：配置 `AI_BASE_URL/AI_API_KEY/AI_MODEL`（OpenAI-compatible，可指 DeepSeek/通义/本地 Ollama）后启用，未配置时接口返回未启用、前端隐藏入口。聊天页 `/ai`：自然语言记账与查询；LLM 通过工具调用工作——`draft_transaction` 只产出**记账草稿卡片**（不写库），用户直接确认或进入表单编辑后保存都复用幂等键 `ai-card-{messageId}-{cardIndex}` 入账并回写卡片状态；`apply_quick_template` 按快捷模板（当前用户的、注入系统提示供按名称匹配）预设内容生成同样的草稿卡，金额/日期/备注可覆盖，模板关联对象不带入草稿；`query_transactions` 仅处理用户明确要求的逐笔明细，支持按交易人员与记账人（创建者）分别筛选，并可按交易日期或记账时间升序/降序排列，`get_period_stats` 统一处理日/周/月/季度/年/自定义区间统计，以有效金额返回收支总额、分类饼图和一级分类汇总；仅当用户意图涉及趋势/走势/曲线/波动/随时间变化时，才额外返回自动按跨度选择日/周/月粒度的趋势折线图；`get_account_balances`/`get_budget_progress` 返回账户余额与预算进度卡片。另有一组无卡片的只读查询工具（结果以 JSON 返给模型、由模型用文字转述）：`query_plans`（计划本期进度）、`query_insurances`/`query_items`/`query_subscriptions`（保险/物品/订阅档案）、`query_auto_rules`/`get_pending_records`（自动记账规则与待确认，只读，确认仍在应用内操作）、`get_reminder_summary`（红点提醒汇总）。金额换算（账本币种主单位→micros）在确定性代码中完成，严格遵守账本币种和小数位；分类/资金账户/人员/记账人的真实 id 注入系统提示，后端二次校验归属和类型。会话按创建者私有并持久化（`ai_conversations`/`ai_messages`，软删）。工具循环上限 6 轮；聊天走 SSE 流式（`POST /ai/chat/stream`，事件 delta/card/done/error，思维链不透出），非流式 `POST /ai/chat` 保留同构结果。 → API 校验（成员 + 业务对象归属 + MIME 白名单 + 20MB）→ 服务端写 MinIO；下载由 API 校验后代理流式返回，不使用预签名 URL。对象 key `ledgers/{ledgerId}/{ownerType}/{ownerId}/{yyyy}/{mm}/{uuid}{ext}`，不含原文件名。删除业务对象联动清附件，MinIO 删除失败入 `file.delete` job 重试。

AI 工具调用策略：每轮用户请求的首轮必须选择一个结构化工具（闲聊/缺参数等纯文本场景显式走 `respond_text`），避免模型仅用文字声称已生成卡片。DeepSeek 端点的工具调用关闭思考模式以支持稳定的 `tool_choice=required`；兼容层仍保留 `reasoning_content`，供其它思考模式上游的工具续轮使用。卡片一旦生成即结束该轮，不再追加一次模型总结。

预留但未接线：`ServiceTokenService.authenticate`（scope / CIDR IP 白名单 / actorUserId+ledgerId 代表用户校验）尚无业务端点调用，为将来外部系统集成（iOS 捷径等）预留；当前创建的 service token 只能被管理、不能访问业务数据。应用内 AI 助手走用户自己的 session 鉴权，不经 service token。

## 4. 核心不变式（改代码必须遵守）

1. **金额**：一律 `*_micros BIGINT`（×1,000,000），TS 层用 `bigint`/数字字符串，**禁止 `number` 参与金额计算**；API 边界用正则 `/^(0|[1-9]\d*)$/` 校验金额字符串。
2. **账本隔离**：每个 ledger-scoped service 公开方法第一行调 `LedgersService.assertMember/assertOwner`；所有查询 where 条件带 `ledgerId`。权限最终判定只在 API 层，前端只做展示优化。
3. **余额变更唯一入口**：`AccountsService.applyEntry`——先 `SELECT ... FOR UPDATE` 锁账户行，再读余额、写 `account_entries`（含 before/after）。负债账户（credit/payable）通过 `orientForLiability` 自动翻转符号。
4. **编辑/删除交易 = 反向流水**：不物理删除旧流水，`reverseEntries` 按账户+子账户净额写 `reversal` 分录（允许作用于已归档账户），再应用新影响。
5. **有效金额口径**：`effective = gross - Σ关联金额`（关联合计不得超过原始金额）；列表/统计/预算/计划用有效金额，账户流水用原始金额。
6. **幂等**：金额写操作（交易创建、账户创建/调整、子账户创建、快捷直接记账等）支持 `Idempotency-Key` 头；实现为「预留占位→执行→落响应」，keyHash 含 scope+userId，失败释放、5 分钟遗留占位可接管。
7. **自动化不直接写账**：自动记账/快捷模板只能生成待确认或调用 `TransactionsService`；确认待确认用「带 status 条件的 updateMany」防并发双记。
8. **事务**：财务多表写在 `DatabaseTransactionService.run` 内（涉及行锁的放宽 timeout 到 20s，批量导入 300s）；跨表初始化用 advisory lock 防注册竞态。
9. **软删/归档优先**：交易/账本/保险/物品/订阅软删（`deletedAt`），分类/人员/账户/计划/物品类型/订阅分类归档（`archivedAt`）；有关联数据禁硬删；账本软删后其所有子资源接口 404。
10. **审计**：注册/改密/管理操作/交易增删改/恢复等写 `audit_logs`。
11. **Worker 边界**：Worker 只消费 `background_jobs`（`auto.schedule`、`file.delete`），与 API 共享 `@fin-nest/backend` 与领域逻辑，不开 HTTP 端口。

## 5. 鉴权与安全基线

- 会话凭证走 `Authorization: Bearer fn_sess_*` 头（无 cookie，无 CSRF 面），web 端存 localStorage；opaque token，库中只存 SHA-256。session 30 天有效，可吊销。
- 密码 scrypt（异步版，N=16384/r=8/p=1）；邀请码/service token 同样高熵随机 + 只存哈希。
- 登录限速双层：同 `登录名+IP` 15 分钟 5 次失败 + 同登录名（与 IP 无关）20 次失败；内存实现，单实例假设。
- `TRUST_PROXY`（默认 false）控制是否信任 `X-Forwarded-For`（取最后一跳）；**前置 nginx 部署必须设 true**，否则限速把所有客户端算成代理 IP。service token 的 CIDR 白名单同样走这套 IP 提取。
- 生产（`NODE_ENV=production`）：Swagger `/docs` 不注册；`MINIO_SECRET_KEY` 为弱默认值（minioadmin/change-me-please）时拒绝启动。
- DTO 全局 `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`；错误统一 `{code, message, details}`（`ApiExceptionFilter`）。
- 附件 MIME 白名单（图片/PDF/Office/视频），无 SVG/HTML 等可执行类型；上限 20MB。
- CORS 仅放行 `WEB_ORIGIN`（正常流量走同源 /api 代理，不跨域）。

## 6. 数据模型速览（39 个模型）

| 分组       | 模型                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| 身份与系统 | User, AppSetting, Session, ServiceToken                                               |
| 账本协作   | Ledger, LedgerMember, LedgerInvite, LedgerJoinRequest                                 |
| 记账配置   | RecordSetting, Category, Subcategory, Person                                          |
| 账户       | Account, SubAccount, AccountAdjustment, AccountEntry                                  |
| 交易       | Transaction, TransactionAccountRelation, TransactionLink                              |
| 自动化     | AutoRule, AutoPendingTransaction, QuickTemplate                                       |
| 计划预算   | Plan, BudgetSetting, CategoryBudget                                                   |
| 档案       | Insurance, InsuranceInsuredPerson, ItemType, Item, SubscriptionCategory, Subscription |
| 文件       | File, Attachment                                                                      |
| 平台       | AuditLog, BackgroundJob, IdempotencyKey, ImportJob                                    |
| AI 助手    | AiConversation, AiMessage                                                             |

表结构以 `packages/db/prisma/schema.prisma` 为准；迁移在 `packages/db/prisma/migrations/`（含 citext/唯一部分索引/check constraint 等 raw SQL）。**迁移是显式步骤**（`pnpm db:migrate` / `db:deploy`），API/Worker 启动不自动迁移。迁移目录用**两位补零**前缀（`00_`..），保证 Prisma 字典序应用顺序 == 依赖顺序；新增迁移沿用递增两位前缀。

> 历史迁移曾用未补零/复用的前缀（导致全新库 `migrate deploy` 顺序错乱），已一次性补零重排。**改名前已存在的库**在下次迁移前需执行一次 `packages/db/prisma/reconcile-migration-rename.sql`（同步 `_prisma_migrations.migration_name`，幂等）；全新库无需。

## 7. 开发工作流

```bash
cp .env.example .env
pnpm install
pnpm infra:up        # 本地 postgres + minio（需 Docker）
pnpm db:migrate
pnpm dev             # API :4000（dev 有 /docs）+ Web :4001
```

- `pnpm dev*` 会先 `build:packages`；api/worker 引用的是 `packages/*/dist` 构建产物，新环境不 build 会报 `Cannot find module '@fin-nest/backend'`。
- 验证手段：`pnpm typecheck`（含包构建）、`pnpm lint`、`pnpm e2e:api`（自动拉起 API、跑注册/账本/交易/幂等/附件越权/red-dot 全链路，需要本地 DB，会自建自清数据）。web 侧有少量 vitest（`pnpm --filter @fin-nest/web test`，金额解析/筛选等纯逻辑）。
- **前后端契约靠手写镜像**：后端契约类型在 `apps/web/src/lib/api/contracts.ts`（约 620 行）+ `endpoints.ts` 手工维护（`lib/generated/api-types.ts` 是占位，OpenAPI 生成管线未启用）。改后端接口的完整动作：DTO + service + controller（带 OpenAPI 注解）→ **同步更新 contracts.ts / endpoints.ts** → 前端页面。漏改不会有编译错误，需要自查。
- 前端习惯：弹出选择/表单选值统一 `PopoverMenu + Menu`（iOS 风格，支持二级菜单）；弹层容器用 `Surface`；底部弹层 `BottomSheet` + `SheetStackProvider`（浏览器返回映射多级 sheet）；不引入第三方视觉特效类库。金额输入/展示走 `lib/money`（micros 转换）；服务端数据一律 TanStack Query（`lib/query/query-keys.ts` 统一 key）。
- 后端习惯：Controller 薄、业务在 service；新的 ledger-scoped 方法先 `assertMember`；金额入库前 `BigInt(dtoString)`；涉及余额的写操作复用 `applyEntry`，不要绕开。

## 8. 部署与环境变量

生产两条路，容器组成相同（postgres、minio、minio-init、migrate（一次性显式迁移）、api、worker、web）：

- **拉预构建镜像（推荐）**：`pnpm compose:up`（根目录 `docker-compose.yml`，`.env.docker`）——用 GHCR 上的多架构镜像，无需本地构建；版本由 `FIN_NEST_VERSION` 控制（镜像 tag 不带 `v`：git tag `v1.2.0` → 镜像 `1.2.0`）。镜像由推 `v*` tag 触发 `.github/workflows/release-images.yml` 发布。
- **变量内联（NAS / Portainer 等不读 `.env` 的界面）**：根目录 `docker-compose.inline.yml`（含内置 postgres + minio）与 `docker-compose.inline-external.yml`（只跑应用，DB 与对象存储全外部）——变量内联、无插值、无 `profiles`（这类界面不读 `.env`，也不会设 `COMPOSE_PROFILES`，带 `profiles` 会让 postgres/minio 不启动）。

> 共四份 compose：`docker-compose.yml`（.env 版，**校验基准**）、两份 inline 版、`infra/compose/docker-compose.prod.yml`（源码构建版）。**改任意一份的服务定义/环境变量，其余几份要同步**。
>
> 由 `pnpm check:compose`（`scripts/check-compose-consistency.mjs`，CI 每次 PR 跑）自动校验五类问题：api/worker 环境变量键集合跨文件一致（`AI_*` / `FEISHU_*` 允许以注释形式存在，但必须出现）、同文件内 `DATABASE_URL` / `MINIO_*` / `WEB_ORIGIN` 取值一致、`minio-init` 命令行里的密钥与 `MINIO_SECRET_KEY` 一致、inline 版不得含 `${}` 插值或 `profiles`、对外只暴露 web 端口。新增环境变量时先加到基准文件，再按报错补齐其余几份。
- **从源码构建**：`pnpm docker:up`（`infra/compose/docker-compose.prod.yml`，`.env.docker`）。

对外只需暴露 web（4001），可选前置 nginx（`infra/nginx/fin-nest.conf.example`）统一域名/TLS。

注意：`web` 镜像里 Next 的 `/api` rewrite 目标在**构建期**固化为 `http://api:4000`（`API_INTERNAL_URL` 是构建参数，运行时改无效），因此 compose 中 API 服务名必须是 `api`。运行时的 `API_INTERNAL_URL` 只影响 SSR 阶段的直连。

关键环境变量（`packages/config/src/index.ts` 是唯一权威定义）：

| 变量                                      | 说明                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                            | 必填                                                                          |
| `MINIO_*`                                 | 对象存储；**生产必须改强 `MINIO_SECRET_KEY`**，弱默认值拒绝启动               |
| `WEB_ORIGIN`                              | CORS 放行来源（逗号分隔）                                                     |
| `TRUST_PROXY`                             | 有可信反代设 `true`，直连保持 `false`（见 §5）                                |
| `APP_TIMEZONE`                            | 「今天/本月」的时区（默认 Asia/Shanghai），影响统计月份与自动记账触发         |
| `WORKER_POLL_INTERVAL_MS`                 | Worker 轮询间隔（默认 30s）                                                   |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | AI 助手（可选）：三项都配置才启用；OpenAI-compatible `/chat/completions` 协议 |
| `NEXT_PUBLIC_API_BASE_URL`                | 浏览器 API 前缀（默认 `/api`，同源代理）                                      |
| `API_INTERNAL_URL`                        | web 容器内转发 /api 的目标                                                    |

## 9. 文档地图

| 文档                              | 用途                                   |
| --------------------------------- | -------------------------------------- |
| `docs/PROJECT_GUIDE.md`（本文件） | 项目权威入口                           |
| `docs/DESKTOP_UI_PLAN.md`         | 桌面端 UI 改造方案与多智能体执行任务书 |
| `docs/DESKTOP_UI_CHECKLIST.md`    | 桌面端双端走查清单（WP-C3）            |
| `docs/FEISHU_BOT_PLAN.md`         | 飞书机器人接入方案（**待实施**）       |
| `AGENTS.md` / `CLAUDE.md`         | AI 协作须知（精简硬规则 + 指向本文件） |
| `README.md`                       | 快速上手（安装/脚本）                  |
| `infra/docker/README.md`          | 部署细节                               |
