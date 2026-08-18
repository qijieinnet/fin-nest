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
  worker/   # NestJS Worker（轮询 background_jobs：auto.schedule 生成自动记账待确认、file.delete 附件删除重试；另扫描到期提醒并推送）
  web/      # Next.js Web（纯前端交互层，经同源 /api 代理调 API）
packages/
  backend/  # api/worker 共享平台：Prisma 注入、事务封装、幂等、审计日志、background_jobs、通知推送、飞书客户端、异常过滤器、BigInt 序列化
  db/       # Prisma schema + 迁移 + client（54 个模型）
  shared/   # 前后端共享常量/类型（金额单位等）
  config/   # 环境变量读取与校验（zod，见 §9 环境变量）
  eslint-config/ tsconfig/
infra/
  compose/  # dev（postgres+minio）与 prod（全栈六容器）compose
  docker/   # Dockerfile 与部署说明
  nginx/    # 可选前置 nginx 示例
docs/       # 本文件
```

API 模块一览（`apps/api/src/modules/`）：`auth`（含管理员用户管理、service token 管理）、`ledgers`（成员/邀请/加入申请）、`accounts`、`transactions`、`records`（分类/人员/记账设置/统计）、`stats`（月度/净资产/现金流）、`plans`（计划+预算）、`automation`（自动规则/待确认/快捷模板）、`assets`（保险/物品/订阅）、`files`（附件）、`data-transfer`（账本级导入导出/备份恢复）、`system-backup`（系统级备份与恢复，仅管理员）、`reminders`（红点聚合）、`ai`（AI 助手：LLM 工具调用、会话/消息、记账草稿）。

Web 路由（`apps/web/src/app/`）：`/login` `/register` `/ledgers`（含 join）、`/bills`（首页账单，含 new/详情/编辑/pending 待确认）、`/accounts`（含账户/子账户详情）、`/stats`、`/budget`、`/ai`（AI 助手聊天，全屏、移动端底部导航左侧独立入口 / 桌面侧边栏底部入口）、`/more/*`（categories、people、settings、auto、quick、insurances、items、subscriptions、import-export、users、admin、backup、system）。**当前账本不在 URL 里**，由 `LedgerProvider` 全局上下文持有，切换账本时刷新所有 ledger-scoped 查询缓存。

## 3. 功能清单

- **认证与管理**：邮箱/账号+密码注册登录；首个注册用户自动成为系统管理员并获得默认账本；管理员可开关注册、禁用/启用用户、授予/撤销管理员（保底最后一名管理员）、管理 service token。改密吊销其它会话；禁用用户即时吊销全部会话。
- **应用锁（启动验证）**：账号级设置（更多 → 系统设置），开关存 `users.app_lock_enabled`，开启后该用户在任何设备/浏览器整页加载都先弹锁定屏。iPhone/iPad 注册 WebAuthn 平台 passkey（Face ID / Touch ID），公钥与计数器存 `app_lock_credentials`，解锁走 `POST /auth/app-lock/unlock/options` 下发 challenge → 断言回传 `POST /auth/app-lock/unlock` 由服务端验签；其他设备或回退场景输入登录密码走 `POST /auth/password/verify`（按用户限速）。开关与凭证都在服务端，换浏览器登录后自动恢复，代价是解锁必须能连上 API（离线时两条路都走不通）。RP ID 取 `APP_LOCK_RP_ID` 或 `WEB_ORIGIN` 第一项的 hostname，改动会让已注册凭证全部失效。前端 localStorage 只留两份开关缓存（`fin-nest:app-lock-enabled`、`fin-nest:app-lock-skip-feishu`），供整页加载首帧同步判断是否上锁，真值以 `PublicUser.appLockEnabled` / `appLockSkipInFeishu` 为准。**飞书内免验证**（`users.app_lock_skip_in_feishu`，默认开启）：在飞书客户端 UA 下跳过这道锁——能打开页面就已经过了飞书自己的登录态与设备锁，再验一次是重复动作；只在飞书里生效，普通浏览器不受该开关影响。缓存缺失时按「免验证」处理（与设置项默认值一致），关掉了这个开关的用户由服务端兜底那一步补锁。定位仍是隐私锁，session token 本身不受影响。**会话过期时的解锁**：session TTL 30 天且不滑动续期，过期后 `/auth/password/verify` 只会回 401「请先登录」——此时锁屏不放行到登录页，而是拿本机记住的账号（`fin_nest_last_login`，登录/`/auth/me` 时写入，仅主动退出登录时清除）+ 用户刚输入的这个密码直接调 `POST /auth/login` 续期，成功后写回当前用户并解锁；本机没记住账号才撤锁放行到登录页，锁屏另有「退出登录」出口。
- **账本协作**：账本 CRUD/软删（仅 owner 可删）；成员管理；邀请码（明文只返回一次，库存 hash，默认 1 天）→ 加入申请（pending/approved/rejected/cancelled）→ owner 审批入伙。账本级币种与金额小数位。
- **记账**：支出/收入/转账；一级/二级分类（交易存快照，改名不影响历史）；人员（默认「我」）；账户/子账户绑定（是否必填由记账设置决定）；可收回/需归还四方向关联（原始金额 vs 有效金额）；附件；关联保险/物品/订阅；备注；多条件筛选 + 汇总卡片。
- **账户**：储蓄/信用/投资（money 类，支持子账户）+ 可收回/需归还（往来类）；money 账户自动生成「默认子账户」，未指定子账户的记账落到默认子账户，恒有 `账户余额 = Σ子账户余额`；余额调整（生成调整记录 + 流水，不静默覆盖）；账户流水；归档要求先清零；账户/子账户拖拽排序。
- **计划与预算**：计划（支出限额/收入目标、金额/次数、周/月/年/不重复、`match_rule`、命中明细、历史周期、预知能力、停止/恢复）；重复计划可开启「周期结束需确认」，周期结束后卡片停在结算期，成员确认才前进，并可为紧邻下一期单独覆盖额度。确认与逐期额度稀疏存于 `plan_periods`；改起始日/重复规则会清空旧周期行并重新锚定。**逐期额度只作用于被覆盖的那一期**，确认弹层的默认值取计划本身的额度而非本期生效额度（否则改一次就会被一路延续下去）。已停止的计划没有「下一期」可开始，不再进结算态、不计红点、接口也拒绝确认，但确认行保留——恢复后游标接着原处继续。「卡片停在哪一期」由 `resolveDisplayPeriod` 单点判定，卡片 / 红点 / 确认接口三方共用，别处再加判断会让口径漂移。预算独立建模（月度总预算 + 分类预算，滚动自然月，不存历史周期）。
- **自动化**：自动记账规则（支出/收入/转账）到期由 Worker 只生成待确认记录（`(auto_rule_id, period_key)` 唯一防重）；待确认可编辑/确认/批量确认/删除，确认才走交易服务；快捷模板（支出/收入/转账）预填或直接记账。
- **保险/物品/订阅**：保险档案（险种/保司/投保方式/缴费方式/保额/保费/缴费频率/期数/续费方式/被保人/起止日期/多档到期提醒/终止与恢复/险种与同险种保单排序）；物品档案（类型/购买价/预期寿命/使用进度/报废与恢复/转卖价/排序）；订阅档案（套餐订阅如 iCloud/Claude/Apple Music：独立分类[物品类型式，含图标/归档/排序]/服务商/套餐/费用/计费周期/支付方式/自动续费/开通日/下次续费日/多档到期提醒/退订与恢复/同分类内排序）；均通过 `transaction_links` 关联交易做费用汇总，不是账户、不进净资产。
- **统计**：月度收支、分类占比与下钻、人员排行、趋势、净资产序列、现金流序列；口径统一用有效金额。
- **记账提醒**（`entry_reminders`，一个账本一条，入口在「更多 › 记账设置」最下方）：开关 + 提醒周期（每天 / 每周选星期 / 每月选日号）+ 提醒时间 + 飞书接收人（`reminder_targets` 的 `sourceType='entry_reminder'`，`sourceId` = 账本 id）。**每月选中的日号当月不存在时（如 31 号遇到 2 月），在当月最后一天提醒**；每周不选星期、每月不选日号会被接口以 400 拒绝——那种配置永远不会触发，最难排查。关掉开关只是不推送，周期与接收人保留（它是设置项，再打开理应还是上次的样子，与订阅/保单「关提醒即清空接收人」的口径刻意不同：那边的接收人藏在弹层里）。随记账设置接口一起读写（`GET/PATCH /ledgers/:ledgerId/record-setting` 的 `entryReminder` 字段），Worker 每轮按本地日期判定，卡片带上「今日已记 N 笔」。
- **提醒红点**：`GET /ledgers/:ledgerId/reminder-summary` 聚合自动待确认、加入申请（owner）、保险 30 天内到期、订阅 30 天内续费、计划超限、计划周期待确认、预算超限。
- **多档到期提醒**：订阅 / 保单的「到期提醒」可配**最多 5 档**（`reminder_schedules`），每档独立的提前量、提醒时刻与飞书接收人——先发的那档只提醒自己、临到期那档抄送家人是常见诉求。`(sourceType, sourceId, leadValue, leadUnit)` 唯一：两档相同提前量会算出同一个 `dedupeKey`，后一档会被静默吞掉，因此 API 直接以 400 拒绝。档位表是**唯一事实来源**；`subscriptions/insurances` 上的 `remind_lead_value/unit/time` 保留为「最早那一档」的镜像列，由 API 在写入时派生，供前端「即将到期」标签、红点汇总与自动确认续费的匹配窗口读取（取最早那一档才与「用户第一次被提醒」对齐）。读写接口统一走 `reminders: [{ leadValue, leadUnit, remindTime, feishuBindingIds }]`，传空数组 = 关闭提醒并清空所有档位与接收人；不传 = 保持不变。
- **提醒推送**（通用层 `packages/backend/notifications`）：接收人存 `reminder_targets`（`sourceType`/`sourceId` 泛化）——订阅/保单挂在**档位**（`reminder_schedule`）上，自动记账挂在规则上；写入时校验绑定生效且其用户仍是账本成员。
  Worker 每轮轮询**扫表**判定「某一档的提醒日 = 今天且已过该档的 `remindTime`」——不给每条订阅排定时 job，因为订阅增删改、续费日推进都会改变应发时刻，排队反而要在每个改动路径上回收。幂等靠 `notifications.dedupe_key`（`subscription:{id}:{续费日}:{提前量}:{openId}`）：调度器先插 `pending` 抢占，唯一冲突即跳过，插入成功才调飞书接口（出站调用不在事务内），崩溃遗留的 `pending` 下一轮重捞，`attempts` 达 3 次落 `failed` 并留 `lastError`。发送前二次校验成员身份。飞书未配置时整条链路静默跳过且不消耗 `attempts`，前端隐藏入口。
  `remindTime` 是本地 `HH:mm` 字面量，与 `currentTimeKey()` 同时区做字符串比较；写入 `scheduled_at` 时经 `zonedDateTimeToUtc()` 换算（直接 `setUTCHours` 会让东八区晚 8 小时才派发）。
  订阅卡片标题固定为「订阅到期提醒」，订阅名与「还有 N 天」放副标题（标题不带名字就看不出是哪笔订阅）；字段与网页端订阅详情的「订阅信息」一致：分类 / 服务商 / 套餐 / 费用 / 计费周期 / 续费方式 / 支付方式 / 续费日期，**有值才出现**。
  保险走同一形态：标题「保险到期提醒」，基准日是保单**到期日**（口径在 `insurance-reminder.ts`，默认提前 30 天，前端 `insurance-utils.ts` 是镜像实现），字段为险种 / 保险公司 / 被保人 / 缴费方式 / 缴费周期 / 续费（趸缴不显示）/ 需缴费用。保单没有能自动执行的动作（续保通常要改保额保费甚至换单），因此**不挂按钮**——推送一律发卡片，不再因为「没有按钮」退回纯文本。
  **可操作卡片**：带 `payload.actions` 的推送发交互卡片（订阅到期挂「退订 / 确认续订」，自定义周期推不出下次续费日时只挂退订；自动记账待确认挂「删除待确认 / 确认入账」，文案与网页端两个按钮一致），无 actions 的退回纯文本。按钮回调复用既有的 `card.action.trigger` 链路（`normalizeCardAction` 按 `value.action` 分派到 AI 草稿卡与推送卡两套 schema），卡片更新**必须由回调响应带回**，不能走 `PATCH /im/v1/messages`。按钮 value **只带 `notificationId`**，账本与业务 id 全部反查；动作一律回落到 Web 端同一批 service 方法（`confirmSubscriptionRenewal` / `terminateSubscription` / `confirmPending` / `deletePending`），鉴权、幂等、审计都在里面，因此收到推送的其他账本成员点击同样生效。`SOURCE_BY_ACTION` 另外校验「动作 ↔ notification.sourceType」匹配，挡住拿订阅卡的 id 去点自动记账按钮。
  **正文结构**：`payload` 用 `amount`（已格式化的带符号金额 + 语义色）+ `fields`（标签/值，空值由构造方直接不产出）表达，渲染成双列字段网格，长值独占整行；`lines` 是改版前的整行文本，仅历史行回退渲染，新代码不要再写。
  **多档的中止**：第一档发出后用户已处理，后续档就不该再推。判据是「同一轮提醒（`occurrenceKey` 去掉档位段 = `{sourceType}:{id}:{基准日}`）内任一档的卡片被点过按钮」，调度器每轮先捞出这些已处理的周期键再过滤（`NotificationService.handledCycleKeys`）。在网页端处理（确认续费、改到期日）会改变基准日，后续档位的周期键随之改变，天然不会再命中，无需额外判断。保单卡因此挂了一个「已确认」按钮（`insurance_acknowledge`）：它不改任何保单数据，只把这一轮标成已处理。
  **动作抢占**：一次提醒给每个接收人各一行 `notifications`（`dedupe_key` 含 open_id），但动作只能执行一次——`confirmSubscriptionRenewal` 不幂等，点两次推进两个计费周期。因此按 `occurrence_key`（= `dedupe_key` 去掉收件人段）**跨行**抢占：`updateMany({ where: { occurrenceKey, actionState: null } })` 单条 UPDATE 原子，并发点击只有一方 count > 0，另一方收到「已由他人处理」并被回写终态卡；业务动作失败必须 `releaseAction` 归还，否则卡片永久锁死。飞书回调只能更新**触发的那一张**卡，其他接收人的按钮仍在，点击时才会看到终态。
- **自动记账的指定时间与推送**：规则可设 `run_time`（本地 `HH:mm`）。为空沿用原行为——`next_run_on` 到期后下一轮 `auto.schedule` job 就生成待确认；设了值则当日必须过点才生成，未到点时**必须补排一个 runTime 时刻的唤醒 job**（触发本轮的 job 已被消费，不补排则今天这期永远生成不出来），补排按 `(type, status, runAfter, payload.ledgerId)` 去重。生成后按规则的 `reminder_targets`（`sourceType='auto_rule'`）入队推送，卡片带「删除待确认 / 确认入账」。与订阅提醒的区别是**事件驱动**而非扫表：待确认刚创建天然只发生一次，`occurrence_key` 直接用待确认 id。卡片内容与网页端待确认详情对齐：金额单独一行（不进标题，支出绿/收入红，与详情同色；转账在 lark_md 里无对应色，退回 grey），其余是「记录类型 / 分类（带二级）/ 账户（带子账户，转账为转出转入）/ 计划入账日期 / 人员 / 备注」，**有值才出现**。派发在 worker 每轮的 job 循环**之后**执行，否则新生成的推送要等下一轮才发得出去。
- **导入导出**（模块 `data-transfer`）：Excel 全量导出 / 记账模板下载 / 增量导入（`dryRun` 同步返回预览；正式导入入队后台 job，`import_jobs` 表跟踪状态）；JSON 全量备份与覆盖式恢复（仅 owner，需输入账本名确认；恢复时重新生成全部 UUID，计划周期确认历史与逐期额度一并保留，旧计划分享链接一律撤销）。
- **系统级自动备份**（模块 `system-backup`，入口在「更多 › 管理员功能 › 自动备份」，仅管理员）：把**整套系统**打进一个 zip 落到 `BACKUP_DIR`（docker 部署映射到宿主机目录，**api 与 worker 必须挂同一个目录**——worker 到点写、api 负责列表/下载/恢复）。归档内容 = `manifest.json` + `database/<表>.jsonl`（表清单与列类型由 Prisma DMMF 现算）+ `files/<对象键>`（附件原文）+ `excel/<账本>.xlsx`（含软删账本，每个账本一份全量 Excel）+ `README.txt`。数据库 JSONL 与 Excel 在同一个 PostgreSQL `REPEATABLE READ` 快照里生成；数量/大小或表行数不一致会让整份备份失败，不产出正式 zip。**附件对象取不到（或大小与 `files` 行对不上）时降级而非中止**：这些 object key 记进 `manifest.files.missing`（格式版本 2 起）与台账的 `counts.missingFiles`，备份页显式告警，恢复时把对应的 `files` 行连同引用它的 `attachments` 行一并丢弃，一次恢复即清干净。之所以不能中止——`files` 行与对象存储不同步是会真实发生的（`purgeObject` 先删对象后删行，中间崩溃就留下悬空行），而这种行没有任何 API 能清掉，中止等于让一条垃圾记录把备份功能永久锁死。列表以**目录里真实存在的文件**为准、台账只补充来源与统计；总览另外返回最近一次备份台账，让 `.part` 尚未转正或失败无文件时也能轮询和展示状态，并在这里回收崩溃遗留的 running 台账与过期 `.part`（前端看到 running 会禁用「立即备份」，只靠 claim 回收会把功能锁死到过期）。
  **导入外部归档**（`POST /admin/backups/import`，multipart 字段 `file`）：换机器或从别处拿到备份时不必登录宿主机拷文件。上传由 multer **直接写进备份目录**的 `.part`（不走系统临时目录——GB 级归档转正只应是一次同盘 rename，docker 里 `/tmp` 与备份卷常不同设备会 EXDEV 失败），随后校验到 manifest 为止（能否打开 zip、是不是本系统的备份、格式版本是否支持）就转正，逐表逐附件的深度核对仍留给恢复前的 `preflightRestore`。文件名合规就原样保留（管理员认得它），否则按归档自己的 `createdAt` 造规范名——不信任浏览器传来的字符串；**同名一律 409 不覆盖**，目录里那份可能是本机自己产出的备份。前端走 XHR 以拿到上传进度（fetch 至今没有可用的上传进度事件）。
  周期备份（每天/每周某几天/每月某几号 + 本地 `HH:mm` + 保留份数）由 worker 扫表判定，周期口径与记账提醒一致；只有成功后才写 `lastRunKey`（跨午夜时取「开始日」与「完成日」中较晚的一个，免得刚备完今天又排一次）并清理超额的旧自动备份，失败退避 5 分钟后当天继续重试，手动备份不受保留策略影响。停机跨过预定日后会**补跑一次**（回看至多 31 天，`runKey` 记成今天，一次清账不为每个错过的日子各跑一遍；`lastRunKey` 为空即从未跑过时不回看，首次一律等下一个预定时刻）。改小保留份数立即生效（删归档不可逆，前端先弹二次确认，把「会删掉几份」摆出来），失败的自动备份台账只留最近 20 条。恢复要求管理员输入**自己的登录密码**二次确认，随后进入全局维护态：先完整读取归档、核对每张表/每个附件/每份 Excel，再把附件写到本次恢复的唯一对象前缀；全部预检成功后，在一个可回滚的 PostgreSQL 事务中执行 `TRUNCATE` + 按外键拓扑恢复 + 改写附件对象键，任一表失败则旧数据库原样保留。提交后才清理旧附件。`backup_settings` 与 `background_jobs` 随系统恢复，避免旧任务作用于新数据或自动规则失去唤醒任务；仅 `backup_records`/`restore_records` 保留为恢复现场台账，`sessions`/`idempotency_keys` 清空不备份，发起恢复的管理员会话在恢复后数据仍含该用户时单独补回。API 普通请求与 worker 在 running 恢复期间暂停，只有健康检查和管理员备份进度查询放行；恢复启动与整轮 worker 通过 PostgreSQL advisory gate 互斥，崩溃遗留超过 6 小时的 running 恢复会自动转失败并退出维护态。
- **AI 助手**（模块 `ai`，可选启用）：配置 `AI_BASE_URL/AI_API_KEY/AI_MODEL`（OpenAI-compatible，可指 DeepSeek/通义/本地 Ollama）后启用，未配置时接口返回未启用、前端隐藏入口。聊天页 `/ai`：自然语言记账与查询；LLM 通过工具调用工作——`draft_transaction` 只产出**记账草稿卡片**（不写库），用户直接确认或进入表单编辑后保存都复用幂等键 `ai-card-{messageId}-{cardIndex}` 入账并回写卡片状态；`apply_quick_template` 按快捷模板（当前用户的、注入系统提示供按名称匹配）预设内容生成同样的草稿卡，金额/日期/备注可覆盖，模板关联对象不带入草稿；`query_transactions` 仅处理用户明确要求的逐笔明细，支持按交易人员与记账人（创建者）分别筛选，并可按交易日期或记账时间升序/降序排列，`get_period_stats` 统一处理日/周/月/季度/年/自定义区间统计，以有效金额返回总额、分类饼图和一级分类汇总，并按必传的 `direction`（`expense`/`income`/`both`）只返回用户问的那一侧——只问支出就不带收入、只问收入就不带支出，卡片标题、饼图、趋势与返回给模型的数据一并收敛（历史卡片无 `direction`，按 `both` 渲染）；仅当用户意图涉及趋势/走势/曲线/波动/随时间变化时，才额外返回自动按跨度选择日/周/月粒度的趋势折线图；`get_account_balances`/`get_budget_progress` 返回账户余额与预算进度卡片。另有一组无卡片的只读查询工具（结果以 JSON 返给模型、由模型用文字转述）：`query_plans`（计划本期进度）、`query_insurances`/`query_items`/`query_subscriptions`（保险/物品/订阅档案）、`query_auto_rules`/`get_pending_records`（自动记账规则与待确认，只读，确认仍在应用内操作）、`get_reminder_summary`（红点提醒汇总）。金额换算（账本币种主单位→micros）在确定性代码中完成，严格遵守账本币种和小数位；分类/资金账户/人员/记账人的真实 id 注入系统提示，后端二次校验归属和类型。会话按创建者私有并持久化（`ai_conversations`/`ai_messages`，软删）。工具循环上限 6 轮；聊天走 SSE 流式（`POST /ai/chat/stream`，事件 delta/card/done/error，思维链不透出），非流式 `POST /ai/chat` 保留同构结果。 → API 校验（成员 + 业务对象归属 + MIME 白名单 + 20MB）→ 服务端写 MinIO；下载由 API 校验后代理流式返回，不使用预签名 URL。对象 key `ledgers/{ledgerId}/{ownerType}/{ownerId}/{yyyy}/{mm}/{uuid}{ext}`，不含原文件名。删除业务对象联动清附件，MinIO 删除失败入 `file.delete` job 重试。

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
11. **Worker 边界**：Worker 消费 `background_jobs`（`auto.schedule`、`file.delete`），并在每轮轮询里扫描订阅/保单的到期提醒、记账提醒与周期系统备份（各自 try，一边抛错不影响另一边；备份**等它跑完**再进 job 循环，甩手不管会让备份连同进程一起被停止信号砍在半路）、在 job 循环后统一派发推送（订阅提醒扫表、自动记账事件驱动，均不走 job 队列，见「提醒推送」），与 API 共享 `@fin-nest/backend` 与领域逻辑，不开 HTTP 端口。

## 5. 鉴权与安全基线

- 会话凭证走 `Authorization: Bearer fn_sess_*` 头（无 cookie，无 CSRF 面），web 端存 localStorage；opaque token，库中只存 SHA-256。session 30 天有效，可吊销。
- 密码 scrypt（异步版，N=16384/r=8/p=1）；邀请码/service token 同样高熵随机 + 只存哈希。
- 登录限速双层：同 `登录名+IP` 15 分钟 5 次失败 + 同登录名（与 IP 无关）20 次失败；内存实现，单实例假设。
- `TRUST_PROXY`（默认 false）控制是否信任 `X-Forwarded-For`（取最后一跳）；**前置 nginx 部署必须设 true**，否则限速把所有客户端算成代理 IP。service token 的 CIDR 白名单同样走这套 IP 提取。
- 生产（`NODE_ENV=production`）：Swagger `/docs` 不注册；`MINIO_SECRET_KEY` 为弱默认值（minioadmin/change-me-please）时拒绝启动。
- DTO 全局 `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`；错误统一 `{code, message, details}`（`ApiExceptionFilter`）。
- 附件 MIME 白名单（图片/PDF/Office/视频），无 SVG/HTML 等可执行类型；上限 20MB。
- CORS 仅放行 `WEB_ORIGIN`（正常流量走同源 /api 代理，不跨域）。

## 6. 数据模型速览（54 个模型）

| 分组       | 模型                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 身份与系统 | User, AppSetting, Session, ServiceToken                                                        |
| 账本协作   | Ledger, LedgerMember, LedgerInvite, LedgerJoinRequest                                          |
| 记账配置   | RecordSetting, Category, Subcategory, Person                                                   |
| 账户       | Account, SubAccount, AccountAdjustment, AccountEntry                                           |
| 交易       | Transaction, TransactionAccountRelation, TransactionLink                                       |
| 自动化     | AutoRule, AutoPendingTransaction, QuickTemplate                                                |
| 计划预算   | Plan, PlanPeriod, BudgetSetting, CategoryBudget                                                |
| 档案       | Insurance, InsuranceInsuredPerson, ItemType, Item, SubscriptionCategory, Subscription          |
| 文件       | File, Attachment                                                                               |
| 平台       | AuditLog, BackgroundJob, IdempotencyKey, ImportJob, BackupSetting, BackupRecord, RestoreRecord |
| AI 助手    | AiConversation, AiMessage                                                                      |

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
- 验证手段：`pnpm typecheck`（含包构建）、`pnpm lint`、`pnpm e2e:api`（自动拉起 API、跑注册/账本/交易/幂等/附件越权/red-dot 全链路，需要本地 DB，会自建自清数据）；系统备份与恢复的破坏性全链路使用 `pnpm e2e:system-backup`，它会创建并清理隔离的临时数据库、MinIO bucket 和备份目录。web 侧有少量 vitest（`pnpm --filter @fin-nest/web test`，金额解析/筛选等纯逻辑）。
- **前后端契约靠手写镜像**：后端契约类型在 `apps/web/src/lib/api/contracts.ts`（约 620 行）+ `endpoints.ts` 手工维护（`lib/generated/api-types.ts` 是占位，OpenAPI 生成管线未启用）。改后端接口的完整动作：DTO + service + controller（带 OpenAPI 注解）→ **同步更新 contracts.ts / endpoints.ts** → 前端页面。漏改不会有编译错误，需要自查。
- 前端习惯：弹出选择/表单选值统一 `PopoverMenu + Menu`（iOS 风格，支持二级菜单）；弹层容器用 `Surface`；底部弹层 `BottomSheet` + `SheetStackProvider`（浏览器返回映射多级 sheet）；不引入第三方视觉特效类库。金额输入/展示走 `lib/money`（micros 转换）；服务端数据一律 TanStack Query（`lib/query/query-keys.ts` 统一 key）。
- 后端习惯：Controller 薄、业务在 service；新的 ledger-scoped 方法先 `assertMember`；金额入库前 `BigInt(dtoString)`；涉及余额的写操作复用 `applyEntry`，不要绕开。

## 8. 部署与环境变量

生产两条路，容器组成相同（postgres、minio、minio-init、migrate（一次性显式迁移）、api、worker、web）：

- **拉预构建镜像（推荐）**：`pnpm compose:up`（根目录 `docker-compose.yml`，`.env.docker`）——用 GHCR 上的多架构镜像，无需本地构建；版本由 `FIN_NEST_VERSION` 控制（镜像 tag 不带 `v`：git tag `v1.2.0` → 镜像 `1.2.0`）。镜像由推 `v*` tag 触发 `.github/workflows/release-images.yml` 发布。
- **变量内联（NAS / Portainer 等不读 `.env` 的界面）**：根目录 `docker-compose.inline.yml`（含内置 postgres + minio）与 `docker-compose.inline-external.yml`（只跑应用，DB 与对象存储全外部）——变量内联、无插值、无 `profiles`（这类界面不读 `.env`，也不会设 `COMPOSE_PROFILES`，带 `profiles` 会让 postgres/minio 不启动）。

> 共四份 compose：`docker-compose.yml`（.env 版，**校验基准**）、两份 inline 版、`infra/compose/docker-compose.prod.yml`（源码构建版）。**改任意一份的服务定义/环境变量，其余几份要同步**。
>
> 由 `pnpm check:compose`（`scripts/check-compose-consistency.mjs`，CI 每次 PR 跑）自动校验六类问题：api/worker 环境变量键集合跨文件一致（`AI_*` / `FEISHU_*` 允许以注释形式存在，但必须出现）、同文件内 `DATABASE_URL` / `MINIO_*` / `WEB_ORIGIN` 取值一致、`minio-init` 命令行里的密钥与 `MINIO_SECRET_KEY` 一致、inline 版不得含 `${}` 插值或 `profiles`、对外只暴露 web 端口、api 与 worker 的备份目录挂载一致。新增环境变量时先加到基准文件，再按报错补齐其余几份。

- **从源码构建**：`pnpm docker:up`（`infra/compose/docker-compose.prod.yml`，`.env.docker`）。

api 与 worker 另外把宿主机的 `BACKUP_HOST_DIR`（默认 `./fin-nest-backups`）挂到容器内 `BACKUP_DIR`，系统备份的归档落在宿主机上，容器重建/升级不会丢；`pnpm check:compose` 会校验两者挂的是同一个目录。

对外只需暴露 web（4001），可选前置 nginx（`infra/nginx/fin-nest.conf.example`）统一域名/TLS。

注意：`web` 镜像里 Next 的 `/api` rewrite 目标在**构建期**固化为 `http://api:4000`（`API_INTERNAL_URL` 是构建参数，运行时改无效），因此 compose 中 API 服务名必须是 `api`。运行时的 `API_INTERNAL_URL` 只影响 SSR 阶段的直连。

关键环境变量（`packages/config/src/index.ts` 是唯一权威定义）：

| 变量                                      | 说明                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | 必填                                                                                                             |
| `MINIO_*`                                 | 对象存储；**生产必须改强 `MINIO_SECRET_KEY`**，弱默认值拒绝启动                                                  |
| `WEB_ORIGIN`                              | CORS 放行来源（逗号分隔）                                                                                        |
| `TRUST_PROXY`                             | 有可信反代设 `true`，直连保持 `false`（见 §5）                                                                   |
| `APP_TIMEZONE`                            | 「今天/本月」的时区（默认 Asia/Shanghai），影响统计月份与自动记账触发                                            |
| `WORKER_POLL_INTERVAL_MS`                 | Worker 轮询间隔（默认 30s）                                                                                      |
| `BACKUP_DIR`                              | 系统备份归档目录（本地默认 `./data/backups`；docker 内固定为 `/data/backups`，宿主机位置用 `BACKUP_HOST_DIR` 配置）；**api 与 worker 必须挂同一个宿主机目录** |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | AI 助手（可选）：三项都配置才启用；OpenAI-compatible `/chat/completions` 协议                                    |
| `NEXT_PUBLIC_API_BASE_URL`                | 浏览器 API 前缀（默认 `/api`，同源代理）                                                                         |
| `API_INTERNAL_URL`                        | web 容器内转发 /api 的目标                                                                                       |

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
