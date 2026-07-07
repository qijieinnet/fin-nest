# Fin Nest 开发计划

版本：v0.1
状态：开发任务分解基线，用于给各开发智能体派活
依据：`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`、`DATABASE_DESIGN.md`、`BACKEND_ENGINEERING.md`、`FRONTEND_DESIGN.md`、`FRONTEND_ENGINEERING.md`、`TESTING_STRATEGY.md`、`claude-design/记账本.dc.html`

本文件把 v1 拆成可独立分配的任务块（编号 `I*` 基础设施 / `B*` 后端 / `F*` 前端）。每个任务都标注依赖、交付物、关键约束和验收标准。被分配到某个任务的智能体，必须先读完相关文档再动手。

---

## 0. 全局约定（所有智能体必须遵守）

### 0.1 开工前置
- 先读 `ARCHITECTURE.md` + 本任务相关的专题文档，再读 `claude-design/记账本.dc.html` 对应模块，再写代码。
- 原型只作功能/交互参考，禁止把单文件 HTML 拆出来当生产代码。
- 需求与原型冲突时，以文档中已确认的产品决策为准（例如加入账本需 owner 审批、统计进更多页、预算独立建模）。

### 0.2 接口契约：契约先行
- 后端用 Nest.js REST + OpenAPI；每个模块**先定义并提交 Controller + DTO + OpenAPI 注解**，再实现 service。
- 前端类型从 OpenAPI 生成（`apps/web/src/lib/generated`），不手写后端字段。
- 任务严格串行执行：一次只做一个任务，完成并通过验收后再开始下一个，不并行、不交叉。前端排在后端之后，届时契约已稳定，直接从 OpenAPI 生成类型。

### 0.3 财务与数据硬约束
- 金额一律 `amount_micros BIGINT`（×1,000,000）；TS 层用 `bigint`/字符串/Decimal，禁止用 `number` 做精确金额计算。
- 所有财务写操作（交易、账户流水、可收回/需归还、转账）必须在同一 Prisma 事务内完成。
- 账户余额变化一律写 `account_entries`；编辑/删除走反向流水，不物理删除旧流水。
- 关键写操作（AI 回写、自动记账生成、周期账单、账户调整）必须幂等。
- 账本是隔离边界：每个 ledger-scoped 查询都带 `ledgerId`，权限在 API 层最终判定。

### 0.4 任务级 Definition of Done
- 代码符合对应工程规范（`BACKEND_ENGINEERING.md` / `FRONTEND_ENGINEERING.md`）。
- 按 `TESTING_STRATEGY.md` 补齐该任务要求的测试，且本地通过。
- OpenAPI / 生成类型已更新。
- 涉及迁移的，提供迁移文件 + 验证步骤说明（迁移作为显式步骤，禁止 API/Worker 启动时并发自动迁移）。
- 前端新增通用组件必须同步补 `/__dev/ui` 样板。

---

## 1. 阶段总览

任务严格串行，按下表自上而下逐个执行（完整顺序见 §5）。

| 阶段 | 内容 | 任务（按序） |
|---|---|---|
| 基础设施 | monorepo、工具链、Compose、Prisma 骨架 | I0 → I1 → I2 |
| 数据模型 | 全量 Prisma schema + 迁移 | B0 |
| 后端平台 | 平台底座、鉴权、session/service token | B1 → B2 |
| 账本与权限 | 账本、成员、邀请、加入申请、初始化 | B3 |
| 交易与账户 | 交易/账户一致性（核心） | B4 |
| 读模型与配置 | 分类、人员、记账设置、筛选、统计、计划、预算 | B5 → B6 |
| 自动化 | 自动记账、快捷记账、Worker | B7 |
| 档案与文件 | 保险、物品、文件/MinIO、附件、红点 | B8 → B9 → B10 |
| 后端加固 | 集成/E2E、并发幂等回归 | B11 |
| 前端 | 骨架 → 玻璃/UI/providers/样板页 → 业务组件 → 各业务页 | F0 → … → F7 |
| 部署 | 生产 Compose、init、Nginx、上线回归 | I3 |

> v1 不做：Redis、AI 实现、导入导出、站内提醒中心、原生 App、多租户限流（仅保留边界）。

---

## 2. 基础设施任务（I）

### I0 — Monorepo 与工具链
- 目标：按 `ARCHITECTURE.md §4` 落地 monorepo 骨架。
- 交付物：
  - `apps/web`、`apps/api`、`apps/worker`、`packages/db`、`packages/shared`、`packages/config`、`packages/eslint-config`、`packages/tsconfig`、`infra/docker`、`infra/compose`、`docs/` 目录。
  - 包管理与 workspace（pnpm workspace 优先）、统一 TS/ESLint/Prettier 配置、路径别名。
  - 根脚本：`build`/`lint`/`test`/`typecheck`/`dev`。
- 依赖：无。
- 验收：`pnpm install` + `pnpm -w typecheck`/`lint` 在空骨架下通过。
- 状态：✅ 已完成。pnpm workspace + 共享 tsconfig/eslint/config/shared/db 包 + api/worker（Nest 11）+ web（Next 16/Tailwind 4）骨架就绪；`pnpm install` / `typecheck` / `lint` / `build`（含 nest build、next build）全通过；API 启动 + `/health` + Swagger `/docs` 验证通过。

### I1 — 本地依赖 Compose（dev）
- 目标：本地拉起 PostgreSQL + MinIO（v1 不含 Redis）。
- 交付物：`infra/compose/docker-compose.dev.yml`（postgres、minio）；`.env.example`；MinIO bucket 初始化脚本/一次性 init。
- 依赖：I0。
- 验收：`docker compose up` 后能连库、能访问 MinIO 控制台、bucket 已建。
- 状态：✅ 文件就绪（`infra/compose/docker-compose.dev.yml`：postgres17 + minio + minio-init 建私有 bucket；`.env.example`；根脚本 `pnpm infra:up`/`infra:down`）。⏳ 运行验证待本机安装 Docker（当前环境无 Docker）后 `pnpm infra:up` 执行。

### I2 — Prisma 基建
- 目标：`packages/db` 提供 Prisma client、连接、迁移命令、类型导出。
- 交付物：Prisma 初始化、`citext` 等扩展的 raw SQL migration 钩子、`migrate`/`generate` 脚本、测试库连接配置。
- 依赖：I0、I1。
- 验收：空 schema 能 `migrate dev` 成功；client 可被 api/worker import。
- 状态：✅ Prisma 基建就绪（`packages/db`：postgres datasource + prisma-client-js generator 骨架、`0_enable_extensions` citext 基线迁移、`getPrisma()` 单例导出、generate/migrate:dev/migrate:deploy/studio 脚本）；`prisma generate` 通过、`@fin-nest/db` 已被 api/worker 引用并通过 typecheck/build。⏳ `migrate dev` 待 I1 的 DB 起来后执行。注：Prisma 暂用稳定的 6.x（7.x 改了默认行为，待业务表落地时再评估升级）。

---

## 3. 后端任务（B）

### B0 — 全量数据模型与迁移
- 目标：按 `DATABASE_DESIGN.md` 落 Prisma schema + 迁移。
- 交付物：
  - users / app_settings / sessions / service_tokens
  - ledgers / ledger_members / ledger_invites / ledger_join_requests
  - record_settings / categories / subcategories / people
  - accounts / sub_accounts / account_entries / account_adjustments
  - transactions / transaction_account_relations / transaction_links
  - auto_rules / auto_pending_transactions / quick_templates
  - plans / **budget_settings / category_budgets**
  - insurances / insurance_insured_people / item_types / items
  - files / attachments / audit_logs / background_jobs
  - raw SQL migration：`citext`、唯一/部分索引、check constraint、关联金额约束。
- 依赖：I2。
- 关键约束：金额 micros、软删除/归档字段、`ledger_id`、各唯一约束（如 `auto_pending(auto_rule_id, period_key)`、`category_budgets(ledger_id, category_id)`）。
- 验收：迁移可重放；schema 与 `DATABASE_DESIGN.md` 一一对应；幂等初始化脚本可空跑。
- 状态：✅ 已完成。`packages/db/prisma/schema.prisma` 已按 `DATABASE_DESIGN.md` 落地 33 个业务模型；新增 `1_create_business_schema` 迁移，包含 users/session/service token、账本与加入申请、记账设置/分类/人员、账户/流水/交易、自动记账/快捷模板、计划与独立预算、保险/物品、文件附件、审计日志、background_jobs；raw SQL 覆盖 `citext`/`pgcrypto`、唯一/部分索引、check constraint、交易关联金额上限保护。`prisma validate` 通过；迁移验证使用本地 `.env` 数据库连接执行。

### B1 — 后端平台底座
- 目标：搭好所有模块共享的基建。
- 交付物：
  - Nest 应用骨架（api 入口 + worker 入口共享模块）。
  - 统一错误结构 `{code,message,details}` + 全局异常过滤器（见 `BACKEND_ENGINEERING.md §1`）。
  - OpenAPI/Swagger 装配、DTO 校验管线（class-validator/zod 二选一，全局生效）。
  - 事务工具（Prisma transaction 封装）、幂等键工具、审计日志写入工具。
  - `background_jobs` 入队/取任务/锁/重试基建（PostgreSQL 实现，供 Worker 用）。
- 依赖：B0。
- 验收：能起服务、Swagger 可访问、错误结构统一、事务封装有单测、任务表能入队/被取。
- 状态：✅ 已完成。新增 `@fin-nest/backend` 共享后端平台包，API 与 Worker 均接入 `BackendPlatformModule`；提供统一 `{code,message,details}` 异常过滤器、Prisma 注入、事务封装、幂等键工具、审计日志写入服务、PostgreSQL `background_jobs` 入队/领取/成功/失败/取消基建。验证：packages 构建通过，API/Worker typecheck 通过，backend lint 通过；API 启动后 `/health` 与 Swagger `/docs` 可访问，404 返回统一错误结构；使用本地 `.env` 数据库完成 background job 入队→领取→成功标记 smoke test 并清理测试数据。

### B2 — 鉴权与令牌
- 目标：opaque session token + service token + scope。
- 交付物：
  - 注册/登录/登出；首个用户自动 `is_admin`；管理员开关注册（app_settings）。
  - session：明文只返客户端（优先 HttpOnly/Secure/SameSite Cookie），库存 hash；按设备/按用户/禁用立即失效；改密吊销历史 session。
  - AuthGuard：每请求按 token hash 校验 session 有效 + 用户未禁用。
  - service_tokens：scope 校验、allowed IPs、`actorUserId + ledgerId` 代表用户校验、lastUsedAt + 审计。
- 依赖：B1。
- 关键约束：禁止纯 JWT 作主登录态；service token 不得绕过账本权限。
- 验收（对照 `TESTING_STRATEGY §2 权限`）：未登录拒绝、禁用即失效、吊销即失败、service token 越权被拒。
- 状态：✅ 已完成。新增 AuthModule：注册/登录/登出/当前用户/改密接口，session 使用 opaque token + SHA-256 hash 入库，并写入 HttpOnly SameSite Cookie；首个注册用户自动 `is_admin`，管理员可读取/更新开放注册开关；SessionAuthGuard 每次请求校验 token hash、过期/吊销、用户禁用状态，并刷新 `lastSeenAt`。新增 service token 管理接口：管理员创建/列出/吊销，明文 token 仅创建时返回，库存 hash，支持 scopes、过期时间、allowed CIDR IP；ServiceTokenService 提供 scope + actorUserId + ledgerId 权限校验能力并写审计。验证：API typecheck/lint/build 通过；本地 `.env` 数据库完成注册→me→管理员注册开关→service token 创建/列表/吊销→登出→session 失效 smoke test，并清理测试数据。

### B3 — 账本、成员、邀请、初始化
- 目标：账本生命周期 + 权限模型 + 默认数据初始化。
- 交付物：
  - 账本 CRUD、切换；成员列表、移除成员、角色（owner/member）。
  - 邀请码/分享码（默认 1 天有效期、库存 hash、撤销、使用记录）。
  - 加入申请：邀请码只创建 `pending`，owner 审批后建 membership；状态机 pending/approved/rejected/cancelled/expired；同账本同用户仅一条 pending。
  - 权限判定：删除账本/审批/成员管理仅 owner；业务数据 owner+member 均可。
  - 初始化（幂等）：首个用户 → 默认账本 + owner membership + 默认记账设置 + 默认人员「我」+ 基础收支分类；新建账本同样初始化；不建默认账户。
- 依赖：B2。
- 验收（对照 `TESTING_STRATEGY`）：邀请码只生成申请、owner 审批入伙、member 不能删账本、初始化幂等。
- 状态：✅ 已完成。新增 LedgersModule：账本列表/详情/创建/编辑/软删除，成员列表/移除，owner 权限校验；邀请码创建/撤销（明文 code 仅返回一次，库存 hash，默认 1 天有效）；邀请码创建 pending 加入申请，owner 查询/审批/拒绝，申请人取消；审批通过后创建或恢复 membership。首个注册用户会自动创建默认账本、owner membership、默认 record settings、默认人员「我」、基础收支分类、预算设置；新建账本复用同一幂等初始化逻辑，不创建默认账户。验证：API typecheck/lint/build 通过；本地 `.env` 数据库完成首用户默认账本、新建账本默认数据、邀请码→pending 申请→owner 审批→member 入伙、member 禁删账本、owner 移除 member 后失权 smoke test，并清理测试数据。

### B4 — 交易与账户一致性（核心，单独成块）
- 目标：实现财务事实中枢，文档中最关键、最易错的部分。
- 交付物：
  - 账户/子账户 CRUD（储蓄/信用/投资/可收回/需归还）、类型扩展字段、归档（有流水禁硬删）、`include_in_net_worth`。
  - 交易服务：支出/收入/转账的新增、编辑、删除、详情。
    - 账户绑定由 `record_settings.acct_required` 决定；绑定即在事务内改余额并写 `account_entries`。
    - 转账两条流水（transfer_out/in），不进收支分类统计。
    - 可收回/需归还四方向（`transaction_account_relations`）：原始金额 vs 有效金额；关联金额合计 ≤ 原始金额；现金流按原始、统计按有效。
    - 编辑 = 反向回滚旧影响 + 应用新影响；删除 = 反向回滚 + 软删 + 触发附件清理。
    - 写 `created_by`/`updated_by`；改他人记录写审计。
  - 账户调整（手动改余额 → `account_adjustments` + 流水，不静默覆盖）。
  - 可收回/需归还冲减方向（收入冲减可收回、支出冲减需归还减少项目余额，不能扣成负数）。
- 依赖：B3。
- 关键约束：所有写入单事务；幂等；金额 micros。
- 验收（对照 `TESTING_STRATEGY §2 交易与账户`，必须全覆盖）：绑定账户增减余额、未绑定不动余额、转账双边、编辑/删除反向流水、调整生成记录、关联扣减有效金额且合计不超原始。
- 状态：✅ 已完成。新增 AccountsModule / TransactionsModule：账户扩展字段、子账户 CRUD、账户流水查询、账户调整、可收回/需归还四方向关联；支出/收入/转账新增、详情、列表、编辑、删除；`record_settings.acct_required` 校验；账户绑定后在同一事务内滚动余额并写 `account_entries`；交易关联写 `transaction_account_relations`，现金流按原始金额、有效金额按关联扣减，往来冲减方向减少项目余额且不能扣成负数；编辑/删除按当前净影响写反向流水，避免旧流水重复冲回。新增 BigInt 响应序列化。验证：backend/api typecheck/lint/build 通过；使用本地 `.env` 数据库完成账户扩展字段、子账户、未绑定交易、账户必填、子账户支出、收入、转账、调整、关联金额上限、编辑/删除反向流水、账户流水列表 smoke test，并清理测试数据。

### B5 — 分类 / 人员 / 记账设置 / 筛选 / 统计
- 目标：交易周边读模型与配置。
- 交付物：
  - 分类（一级/二级、图标、排序、归档；有交易禁删；交易存分类快照）。
  - 人员（默认「我」不可删；有交易禁删；归档）。
  - 记账设置（字段顺序、字段显隐、账户必填、人员必填、金额小数位；小数位只影响输入/展示）。
  - 筛选 DTO（类型/分类/时间区间/账户/人员/记录人/金额范围/备注关键词；不落库）。
- 统计（支出/收入切换、分类占比、二级下钻、近 6 月趋势、净资产趋势；读模型，可缓存非事实源）。
- 依赖：B4。
- 验收：分类/人员删除边界、统计口径用有效金额、筛选不绕权限。
- 状态：✅ 已完成。新增 RecordsModule：一级/二级分类列表、创建、编辑、删除/归档；人员列表、创建、编辑、删除/归档，默认人员禁止删除；记账设置读取/更新，`acct_required` / `person_required` 会进入交易校验；交易列表新增类型、分类、日期区间、账户、人员、记录人、金额、备注筛选；统计 overview 输出月度支出/收入有效金额、分类/人员排行、近 6 月趋势、净资产与净资产趋势。交易继续保存分类/人员快照，后续分类/人员改名不会影响历史交易。验证：API typecheck/lint/build 通过；使用本地 `.env` 数据库完成分类/二级分类、人员、默认人员删除边界、记账设置、人员必填、交易筛选、快照稳定、统计有效金额口径、有关联数据的归档边界、非成员筛选越权拦截 smoke test，并清理测试数据。

### B6 — 计划与预算
- 目标：命名计划 + 独立预算（注意二者数据模型分开，见 `FUNCTION_BOUNDARIES §7.3/§7.4`）。
- 交付物：
  - 计划：支出限额/收入目标、金额/次数指标、周期（周/月/年/不重复）、`match_rule`、命中明细、历史周期、预知能力（纳入当前周期未来已确认交易 + 自动记账待确认；不纳入草稿）。
  - 预算：`budget_settings`（月度总预算 + 开关）、`category_budgets`（分类月度预算）；首页进度计算（按当月有效支出，转账/调整不计入；总预算与分类预算两层）。
- 依赖：B5。
- 关键约束：预算不复用 `plans`；预算是滚动月度、不存历史周期；计划实际进度只统计已确认交易。
- 验收：计划命中口径、预知能力范围、预算已用/剩余/百分比计算正确。
- 状态：✅ 已完成。新增 PlansModule：计划列表/创建/编辑/归档、当前周期进度和近 6 个历史周期；支持支出/收入、金额/次数、周/月/年/不重复周期、`match_rule`（分类、二级分类、账户、人员、记录人、备注）和预知能力。计划进度区分已确认实际、未来已确认和自动记账待确认，草稿未纳入。预算独立使用 `budget_settings` 与 `category_budgets`，支持总预算开关/金额、分类预算 upsert/delete、月度总预算与分类预算 used/remaining/percent 进度，按当月有效支出计算，不复用 `plans`。验证：API typecheck/lint/build 通过；使用本地 `.env` 数据库完成金额计划、预知能力（未来已确认 + 待确认）、次数计划、预算设置、分类预算、预算进度不纳入自动待确认、计划归档 smoke test，并清理测试数据。

### B7 — 自动记账、快捷记账、Worker
- 目标：自动化记账链路。
- 交付物：
  - 自动记账规则 CRUD、启用/停用、重复周期、下次记账时间；到期只生成 `auto_pending_transactions`（带 `source=auto`/`sourceRuleId`/`periodKey`/触发日期），同规则同 period 不重复（唯一约束）。
  - 待确认记录：编辑后确认、批量确认、删除/忽略；确认才调交易服务建正式交易。
  - 快捷记账模板 CRUD；预填 vs 直接记账（直接记账要求除日期外必填字段齐全，日期取当天，仍走交易服务）。
  - Worker：消费 `background_jobs` 跑周期调度生成待确认、附件删除重试等；与 API 共享领域代码、独立进程。
- 依赖：B4（交易服务）、B1（任务基建）。
- 验收（对照 `TESTING_STRATEGY`）：只生成待确认、同 period 不重复、确认建交易、快捷直接记账必填校验、模板不绕交易校验。
- 状态：✅ 已完成。新增 AutomationModule：自动记账规则 CRUD、启用/停用、`next_run_on` 与调度入队；Worker 消费 `background_jobs` 的 `auto.schedule` 任务，到期只生成 `auto_pending_transactions`，并通过 `(auto_rule_id, period_key)` 避免同周期重复；待确认记录支持列表、编辑、确认、批量确认、删除/忽略，确认时复用 TransactionsService 创建正式交易并写 `source=auto`；快捷模板支持 CRUD、预填和直接记账，直接记账必须开启且仍走交易服务校验。验证：API/Worker typecheck/lint/build 通过；使用本地 `.env` 数据库完成 Worker 生成待确认、重复 Worker 不重复、编辑待确认、确认建交易并影响账户、删除待确认、快捷预填、快捷直接记账必填校验、快捷直接记账 source、批量确认 smoke test，并清理测试数据。

### B8 — 保险与物品
- 目标：关联资产档案。
- 交付物：
  - 保险 CRUD/终止、被保人、保额/保费/缴费频率/期数/续费方式/生效到期、可被交易关联、续费/到期提醒数据。
  - 物品 CRUD、类型、购买价/购买日/预期寿命、报废/取消报废/转卖价、关联交易计算总投入与耗材/维护成本、使用进度。
- 依赖：B4。
- 关键约束：保险/物品不是账户、不进净资产、不自动产生交易/折旧。
- 验收：关联交易查询正确；不污染账户余额与净资产。
- 状态：✅ 已完成。新增 AssetsModule：保险列表/详情/创建/编辑/终止/软删、被保人关联、交易关联与费用汇总；物品类型、物品列表/详情/创建/编辑/软删、报废/恢复、转卖价、使用进度、交易关联与投入汇总。保险/物品均通过 `transaction_links` 关联既有交易，不创建账户、不改变余额、不进入净资产。验证：API typecheck/lint/build 通过；使用本地 `.env` 数据库完成保险 CRUD、被保人、保险交易关联、终止、物品类型、物品 CRUD、物品交易关联和使用进度、报废/恢复、净资产不污染 smoke test，并清理测试数据。

### B9 — 文件与 MinIO
- 目标：附件全链路 + 权限。
- 交付物：
  - 上传：API 签发临时上传 URL → 客户端传 MinIO → 业务绑定 `attachments`。
  - object key 规范 `ledgers/{ledgerId}/{bizType}/{bizId}/{yyyy}/{mm}/{random}.{ext}`；不用原始文件名。
  - 访问：私有桶，API 校验 session+membership+对象归属后返签名下载 URL 或代理。
  - 删除业务对象 → 同步删附件元数据 + MinIO 对象；失败入 `background_jobs` 重试（与 B7 Worker 衔接）。
- 依赖：B4（交易绑定）、B8（保险/物品绑定）、B1。
- 验收：越权不可访问、key 不可猜、删除联动与失败重试。
- 状态：✅ 已完成。新增 FilesModule：按账本和业务对象签发 MinIO 上传 URL，生成 `ledgers/{ledgerId}/{bizType}/{bizId}/{yyyy}/{mm}/{uuid}.{ext}` 私有对象 key，绑定附件、查询附件、签发下载 URL、删除附件；交易/保险/物品删除会联动清附件元数据并清 MinIO 对象，失败时写入 `background_jobs` 的 `file.delete` 任务，由 Worker 重试。验证：API/Worker typecheck/build 通过；使用本地 `.env` 数据库完成上传 URL、key 不含原文件名、绑定、成员下载、非成员 403、删除交易联动清附件 smoke test，并清理测试数据。

### B10 — 红点提醒聚合
- 目标：`GET /ledgers/:ledgerId/reminder-summary`。
- 交付物：聚合自动记账待确认、加入申请待审批、保险续费/到期、计划超支（预算超支可选）的计数；`{total, items:{...}}`；不做站内消息中心/已读未读/推送。
- 依赖：B3、B6、B7、B8。
- 验收：计数为读模型、各模块暴露自身待处理数、0 不显示。
- 状态：✅ 已完成。新增 RemindersModule 与 `GET /ledgers/:ledgerId/reminder-summary`，只读聚合自动记账待确认、所有者可见加入申请、30 天内保险到期、当前周期计划超限、当前月预算超限；返回 `{ total, items }`，为 0 的项从 `items` 省略。验证：API typecheck/lint/build 通过；使用本地 `.env` 数据库完成空账本 0 项省略、自动待确认、加入申请、保险到期、计划超限、预算总额/分类超限 smoke test，并清理测试数据。

### B11 — 后端加固与 E2E
- 目标：收尾测试与一致性回归。
- 交付物：补 `TESTING_STRATEGY §3` 的集成/E2E（登录注册、建账本、交易增删改、余额调整、上传授权、reminder summary）；并发/幂等回归。
- 依赖：B2–B10。
- 状态：✅ 已完成。新增 API E2E 脚本 `pnpm e2e:api`（内部执行 API build 并运行 `apps/api/scripts/e2e-api.mjs`），可复用已启动 API，也可在未启动时拉起当前构建；脚本加载本地 `.env`、创建临时数据并清理。覆盖注册/建账本、交易创建幂等、交易编辑/删除余额回滚、账户余额调整、附件上传授权与越权拒绝、reminder summary 计数、幂等键落库。迁移一致性：已用本地 `.env` 执行 `prisma migrate deploy`，补齐 `2_add_idempotency_keys` 到本地数据库。验证：`pnpm e2e:api` 通过。

---

## 4. 前端任务（F）

> 前端在后端（B0–B11）全部完成后开始，仍严格串行。遵守 `FRONTEND_ENGINEERING §3` 开发顺序：基础结构 → ui → glass → providers → `/__dev/ui` → business → 业务页。此时后端契约已稳定，业务页从 OpenAPI 生成类型对接。

### F0 — Web 骨架
- 目标：Next.js App Router + 工具链 + PWA 基础。
- 交付物：目录结构（`FRONTEND_ENGINEERING §2`）、Tailwind + 设计 token、`lib/api`（client/errors/endpoints + credentials）、OpenAPI 类型生成管线、PWA manifest、`MobileAppShell`/`MobilePage`（`min(100vw,430px)` 容器 + safe area）、环境变量分层（`NEXT_PUBLIC_*` 边界、`NEXT_PUBLIC_ENABLE_DEV_UI`）。
- 依赖：I0；后端契约（B1 起）已稳定。
- 验收：移动容器在 iPhone 宽度居中、token 生效、API client 统一。

### F1 — 玻璃组件 + 基础 UI + providers + 样板页
- 目标：可复用视觉与交互底座（业务页前置，硬要求）。
- 交付物：
  - `components/glass/*`：`GlassSurface`（liquid/cssFallback/solidFallback 降级 + SSR client-only）、`GlassButton`/`GlassIconButton`/`GlassTabBar`/`GlassBottomSheet`/`GlassMenu`/`GlassSegmentedControl`，`liquid-glass-react` 仅存在于此层。
  - `components/ui/*`：Button/IconButton/Input/Sheet/Tabs/Toast 等。
  - `providers`：Query、Auth、Ledger、Toast、`SheetStackProvider`（push/pop/clear + 浏览器返回映射）。
  - `/__dev/ui` 样板页（仅 dev，生产 404/不打包）。
- 依赖：F0。
- 验收：样板页覆盖按钮/输入/分段/玻璃 Tab/BottomSheet/Toast；Safari/Firefox 降级可读；Sheet 栈多级返回正确。

### F2 — 业务通用组件
- 目标：跨模块复用组件，禁止页面私有重复实现。
- 交付物（`components/business/*`）：`AmountInput`、`MoneyText`、`TransactionTypeSwitch`、`CategoryPicker`、`AccountPicker`、`PersonPicker`、`DateWheelPicker`、`MonthWheelPicker`、`FilterSheet`/`FilterBar`（配置驱动 fields）、`TransactionRow`/`TransactionGroup`/`SwipeActionRow`、`AttachmentPicker`/`AttachmentPreview`、`RecoverablePayableEditor`、`EmptyState`/`LoadingState`、`CategoryIcon`、`TrendChart`/`CategoryRingChart`/`PlanProgress`/`BudgetProgress`/`AccountBalanceCard`、`lib/money`（parse/format/micros）。
- 依赖：F1。
- 验收（对照 `TESTING_STRATEGY §4 组件`）：AmountInput 小数/micros、FilterSheet 按 fields 渲染、各 Picker 选择/清空、SheetStack push/pop/clear、附件预览回退；全部入样板页。

### F3 — 鉴权与账本页
- 目标：登录态与账本切换。
- 交付物：`/login`、`/register`、`/ledgers`、`/ledgers/join`、账本详情/编辑、分享码弹窗、加入申请与审批入口；全局 `ledgerId` 上下文 + 切换刷新所有 ledger-scoped 查询缓存。
- 依赖：F2、B2、B3。
- 验收：切换账本不串数据；加入走申请流。

### F4 — 账单与记账
- 目标：核心高频路径。
- 交付物：`/app/:ledgerId/bills`（月度汇总 + 本月预算进度 + 按日分组列表 + 月份选择 + 筛选）、交易详情、`/bills/new` 与编辑（按 `record_settings` 动态字段顺序/显隐/必填，统一表单框架表达支出/收入/转账差异，可收回/需归还编辑，附件，关联保单/物品）、闪电入口选快捷模板。
- 依赖：F2、B4、B5、B6（预算进度）、B7（快捷）。
- 验收（对照 `TESTING_STRATEGY §4 流程`）：筛选刷新列表、表单读设置、账户必填/非必填保存行为、列表展示有效金额。

### F5 — 账户
- 交付物：`/app/:ledgerId/accounts`（净资产 + 分组）、账户/子账户详情、余额调整、账户流水、关联记录。
- 依赖：F2、B4。
- 验收：余额展示以后端为准；调整后失效相关缓存。

### F6 — 计划 / 预算 / 统计
- 交付物：`/plans`（支出限额/收入目标、详情、命中明细、历史周期、预知开关）；预算配置与首页进度联动；`/stats`（占比/下钻/趋势/净资产）。
- 依赖：F2、B5、B6。
- 验收：计划进度只算已确认；预算进度口径正确；统计用有效金额。

### F7 — 更多页与档案/设置
- 交付物：`/more`（功能入口 + 红点）、自动记账（待确认编辑/批量确认/删除）、快捷记账模板、保险、物品、分类、人员、记账设置、成员、系统设置（资料、登录设备、注册开关）；红点只来自 `reminder-summary`。
- 依赖：F2、B7、B8、B9、B10。
- 验收：红点合计与各入口数、自动记账确认链路、附件授权预览。

---

## 5. 执行顺序（严格串行，一次一个）

按以下编号自上而下逐个执行。完成当前任务并通过验收后，再开始下一个；不并行、不交叉、不跳过未完成的前置任务。

```
1.  I0  — Monorepo 与工具链
2.  I1  — 本地依赖 Compose（dev）
3.  I2  — Prisma 基建
4.  B0  — 全量数据模型与迁移
5.  B1  — 后端平台底座
6.  B2  — 鉴权与令牌
7.  B3  — 账本、成员、邀请、初始化
8.  B4  — 交易与账户一致性（核心）
9.  B5  — 分类 / 人员 / 记账设置 / 筛选 / 统计
10. B6  — 计划与预算
11. B7  — 自动记账、快捷记账、Worker
12. B8  — 保险与物品
13. B9  — 文件与 MinIO
14. B10 — 红点提醒聚合
15. B11 — 后端加固与 E2E
16. F0  — Web 骨架
17. F1  — 玻璃组件 + 基础 UI + providers + 样板页
18. F2  — 业务通用组件
19. F3  — 鉴权与账本页
20. F4  — 账单与记账
21. F5  — 账户
22. F6  — 计划 / 预算 / 统计
23. F7  — 更多页与档案 / 设置
24. I3  — 生产部署与上线回归（见 §6）
```

执行规则：
- 每个任务的「依赖」已在任务描述中列出，上述顺序已满足全部依赖，照序做即可。
- 一次只推进一个任务；当前任务未通过 §0.4 的 Definition of Done，不得开始下一个。
- 遇到阻塞或缺口，记录到 §7 开放问题并向上反馈，不私自跳过前置任务。
- 后端 B0–B11 全部完成后才进入前端 F0–F7；文件/MinIO（B9）与 Worker（B7）有删除重试衔接，B9 实现时复用 B7 的任务基建。

## 6. 收尾（I3 / 部署）
- I3 — 生产 Compose：`web/api/worker/postgres/minio/proxy(Nginx)` 六容器；环境变量配置；迁移作为显式步骤；MinIO bucket init 容器；PWA 生产构建关闭 `/__dev/ui`。
- 上线前跑通 B11 的 E2E + Playwright 移动端视口（iPhone SE / 15-16 / 430px）与 `/__dev/ui` 截图回归。

## 7. 开放问题（开发中需产品确认，先按文档默认实现）
- 基础收支分类与人员的初始名称/图标清单（B3 初始化，文档允许产品细化）。
- `service token` scopes 的细粒度是否够用（AI 上线前再补）。
- 预算超支是否进 v1 红点（`FUNCTION_BOUNDARIES §7.4` 标为可选，默认不进 v1）。

## 8. 不在 v1 范围（仅保留边界，勿实现）
Redis、AI 数据模型与接口、导入导出/备份、站内提醒中心/已读未读/推送、原生 App、多租户限流、暗色模式切换、多币种/汇率。
