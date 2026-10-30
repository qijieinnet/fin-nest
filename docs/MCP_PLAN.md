# MCP 服务接入方案（P1~P3 已实施）

让 Claude Code / Cursor / Codex 等外部智能体经 MCP 协议查询并维护账本数据。本文是设计与取舍；实施后把现状并入 `PROJECT_GUIDE.md` §3，本文保留为决策记录。

## 1. 已定的产品决策

| #   | 决策                                                                                      | 由此推出的设计                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1  | 智能体可以记账，但**一律先起草，用户确认后才入账**                                        | 交易草稿落进现有「待确认」（`auto_pending_transactions`），确认复用 `AutomationService.confirmPending`；MCP 不提供任何确认工具 |
| D2  | 不兼容只支持 OAuth 的托管客户端（claude.ai / ChatGPT 连接器），**每人用自己的个人 token** | 只做 Bearer token；token 绑定到具体用户，身份不由调用方声明                                                                    |
| D3  | 除账单外，还要有账户、物品、订阅、计划等的权限                                            | 按领域分 scope；**动钱的走确认，档案类直接写**                                                                                 |

D3 的口径——「动钱」= 会改变账户余额或交易的操作（新增/修改/删除交易、余额调整、带初始余额建账）。它们只能产出待用户确认的东西；其余档案类写操作（账户名称/归属、物品、订阅、保险、计划、预算）在 scope 允许时直接写，靠审计追溯。

## 2. 架构

```txt
外部 Agent ──Streamable HTTP, Authorization: Bearer fn_pat_*──▶ web :4001 /api/mcp
  ──Next rewrite──▶ api /mcp（McpController）
      → AgentTokenService.authenticate   （token → userId + 账本白名单 + scopes）
      → McpToolsService.<tool>           （scope 校验 → 账本白名单 → 调领域 service）
      → TransactionsService / AutomationService / AccountsService / AssetsService / PlansService …
```

- **内嵌在 api 进程**，不做独立的 stdio 包：领域 service 已自带 `assertMember`、幂等、事务、审计、`applyEntry`，进程内直接调就天然满足硬规则 2/3/5/6。现有 controller 有 191 处 `(auth as SessionAuthContext).userId`，让 token 打 REST 要大面积改 controller，不划算。只支持 stdio 的客户端用 `npx mcp-remote <url> --header ...` 桥接。
- **SDK**：`@modelcontextprotocol/sdk`，`StreamableHTTPServerTransport` 无状态模式（`sessionIdGenerator: undefined`）+ `enableJsonResponse: true`（不开 SSE，反代链路最简单）。每个请求新建 `McpServer + transport`，`POST /mcp` 处理，`GET/DELETE /mcp` 回 405。Nest 已解析 body，传 `handleRequest(req, res, req.body)`。引入前确认 SDK 版本与仓库 zod 4 的兼容性。
- controller 自己写 `res`，绕过了 `BigIntSerializeInterceptor`：工具结果里的 bigint 统一转字符串后再 `JSON.stringify`。
- 全局 `RestoreMaintenanceGuard` 照常生效（系统恢复期间 MCP 也暂停）。
- **不复用 AI 工具的返回**（P1 实施时调整）：App 内 AI 的 `run*Tool` 只返回名称、不返回 id（id 在系统提示里），外部智能体做后续筛选/写入必须拿到 id，因此 MCP 工具（`modules/mcp/mcp-tools.service.ts`）直接调领域 service 自行投影。金额/日期统一经 `mcp-format.ts` 的 `humanize` 出口转换：`xxxMicros` → `xxx`（主单位字符串），date-only 列 → `YYYY-MM-DD`，去掉审计/排序等内部列。P2 起草交易时再把 `buildDraft` 校验抽成共用服务。
- 服务端 `instructions` 写明工作流：先 `list_ledgers` → `get_ledger_context` 拿 id → 再调用写工具；草稿需用户在 App「待确认」里确认，**不得对用户声称已入账**。

## 3. 个人 token

新表 `agent_tokens`（不复用 `service_tokens`：那是管理员发放的系统级凭证，「代表谁」由调用方传 `actorUserId`，等于可冒充任意成员）：

| 列                                                         | 说明                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`, `user_id`                                            | token 归属用户，身份唯一来源                                          |
| `name`                                                     | 用户起的名字（如「Claude Code - 笔记本」），也作为待确认来源标签      |
| `token_hash`                                               | `fn_pat_*` 明文只在创建时返回一次，库存 SHA-256（沿用 `token-utils`） |
| `ledger_ids uuid[]`                                        | 账本白名单；空数组 = 该用户所在的全部账本                             |
| `scopes text[]`                                            | 见下表                                                                |
| `allowed_ips text[]`, `expires_at`                         | 可选；存 CIDR 文本，写入时由 API 校验格式，匹配沿用 `ip-utils`        |
| `revoked_at`, `last_used_at`, `last_used_ip`, `created_at` | 吊销而非删除                                                          |

Scopes：

| scope            | 能做什么                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `read`           | 全部只读工具                                                                          |
| `drafts:write`   | 起草交易、修改/撤回**本 token 起草的**待确认                                          |
| `accounts:write` | 新建账户/子账户（余额为 0）、改名称/图标/归属人员/备注                                |
| `assets:write`   | 物品、订阅、保险的新建/修改/状态变更（报废、退订、终止及恢复），新建物品类型/订阅分类 |
| `plans:write`    | 计划新建/修改/停止/恢复，月度总预算与分类预算                                         |

鉴权规则：

- 每次调用重新校验：token 未吊销、未过期、IP 命中、**用户未禁用**；账本参数必须在白名单内，之后领域 service 的 `assertMember` 再兜底（用户退出账本即自动失效）。
- 用户改密不吊销 token（与 GitHub PAT 一致），禁用用户则全部失效；token 列表页随时可吊销。
- 限流：进程内按 token 计，每分钟 120 次请求（单实例假设，与登录限速一致）；P2 再给写工具单独加 30 次/分钟。
- 审计：领域 service 照常写自身审计（`actorUserId` = token 归属人）；MCP 层对每次写工具额外写一条 `mcp.tool_call`（`metadata` 带 tokenId、工具名、目标 id）。
- `agent_tokens` 进系统备份（只存 hash，恢复后智能体照常可用），不登记排除名单。

## 4. 交易草稿 = 待确认（D1）

现有确认路径 `confirmPendingInTransaction` 只读待确认行自身字段，与自动规则无耦合；待确认页已有编辑、确认、批量确认、删除，红点也已计数——直接复用。

迁移 `auto_pending_transactions`：

- `auto_rule_id` 改可空；新增 `source text not null default 'auto_rule'`（`auto_rule` / `agent`）、`agent_token_id uuid null`（FK → `agent_tokens`）、`source_label text null`（token 名称快照，供展示，token 改名/吊销/恢复到别的实例后仍可读）。
- check：`source = 'auto_rule'` ⇔ `auto_rule_id is not null`。
- 部分唯一索引 `(agent_token_id, period_key) where source = 'agent'`：`period_key` 存客户端传入的 `idempotencyKey`，重复提交返回已有草稿。
- `scheduled_for` 存交易日期；另加 `item_link_kind`（同快捷模板：`purchase` 购入 / `consumable` 耗材，空按耗材），确认时随关联落库。
- 迁移 `59_agent_drafts` 同时给 `transactions.source` 加 `agent`：智能体草稿确认后的交易来源记 `agent`，账单详情显示「智能体」。

波及的既有代码（已改）：Worker 待确认推送按来源选接收人；账本 JSON 备份恢复时智能体草稿 `agent_token_id` 置空、保留 `source_label`；`contracts.ts` 的 `AutoPendingTransaction` 加 `source/agentTokenId/sourceLabel/itemLinkKind`；待确认详情显示来源「智能体「xxx」」。

**起草校验 = 试算确认**（`AutomationService.createAgentPending`）：先过待确认通用的 `assertAutoPayload`，再把这条草稿按确认时的同一条路径建一次交易、整体回滚（`dryRunPending`）——分类/账户/人员归属、记账设置必填项、外币与账户币种、关联合计全部与「确认入账」同口径，起草成功的草稿确认时不会因数据不合法而失败。返回里附 `possibleDuplicates`（同账本同一天同类型同金额的已入账交易，只提示不阻断）。

**金额与外币**在 MCP 层确定性换算（`McpWriteToolsService.resolveDraftAmounts`，口径同 App 内 AI 草稿）：未指定币种时外币账户按账户币种、其余按本币；外币账户只接受账户币种或本币金额；按交易日（不晚于今天）汇率折算，缺汇率报错并提示补录；小数位超出币种精度直接报错，不静默舍入。已知限制：待确认没有 `to_currency` 列，**两侧都是外币且币种不同的转账**不能起草。

**推送**：起草后 API 排一个 `agent.drafts.notify` 后台任务（延迟 20 秒，同 token + 账本已有待执行的任务就不再排，`since` = 首笔草稿的创建时间）。Worker 到点后取这一阵起草、仍待确认的草稿：**≤3 笔**逐条推「智能体记账待确认」卡（与自动记账同一套「删除待确认 / 确认入账」动作，接收人是 token 归属人）；**更多**则合并成一张「智能体提交了 N 笔待确认」汇总卡（列前 5 笔，不挂按钮）。

## 5. 工具清单

通用约定：所有工具显式传 `ledgerId`；金额入参为**主单位十进制字符串**（`"88.5"`）+ 可选 `currency`，由确定性代码换算成 micros；出参同时给 `amountMicros` 字符串和格式化金额；写工具必须传 `idempotencyKey`（重试同一笔时保持不变）；工具带 `readOnlyHint` / `destructiveHint` / `idempotentHint` 标注；错误以 `isError` 返回 `AppError` 的 code 与文案（按 `Accept-Language` 翻译）。

**只读（`read`）**

| 工具                                                  | 来源                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `list_ledgers`                                        | 白名单内账本，含本币与小数位                                                                                         |
| `get_ledger_context`                                  | 分类/二级分类、账户/子账户（含币种）、人员、快捷模板、物品类型、订阅分类、记账设置必填项——外部智能体拿 id 的唯一入口 |
| `query_transactions`（游标分页）、`get_transaction`   | `TransactionsService.list/get`                                                                                       |
| `get_period_stats`                                    | 复用 AI 实现                                                                                                         |
| `list_accounts`、`list_account_entries`               | `AccountsService.list/listEntries`（含 `baseBalanceMicros`）                                                         |
| `list_plans`、`get_budget_progress`                   | `PlansService`                                                                                                       |
| `list_items`、`list_subscriptions`、`list_insurances` | `AssetsService`                                                                                                      |
| `list_auto_rules`、`list_pending`                     | 待确认带 `source` / `sourceLabel`                                                                                    |
| `get_reminder_summary`、`get_fx_rate`                 | 现有 service                                                                                                         |

**交易草稿（`drafts:write`）**

| 工具                        | 说明                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `draft_transaction`         | 支出/收入/转账，可关联物品/订阅/保险 → 待确认                              |
| `draft_from_quick_template` | 按快捷模板起草，金额/日期/备注可覆盖                                       |
| `update_draft`              | 仅本 token 起草且仍为 pending → `AutomationService.updatePending`          |
| `withdraw_draft`            | 仅本 token 起草且仍为 pending → `deletePending`                            |
| `get_draft_status`          | 批量查 pending / confirmed（带交易 id）/ deleted，让智能体知道用户处理结果 |

**档案写入**

| scope            | 工具                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts:write` | `create_account`（初始余额必须为 0）、`update_account`、`create_sub_account`（余额 0）、`update_sub_account`                                                                                                                                                                                              |
| `assets:write`   | `create_item` / `update_item` / `scrap_item` / `restore_item`；`create_subscription` / `update_subscription` / `terminate_subscription` / `resume_subscription`；`create_insurance` / `update_insurance` / `terminate_insurance` / `resume_insurance`；`create_item_type`、`create_subscription_category` |
| `plans:write`    | `create_plan` / `update_plan` / `stop_plan` / `restore_plan`；`set_monthly_budget`、`set_category_budget` / `delete_category_budget`                                                                                                                                                                      |

通用实现（`mcp-common.ts` 的 `McpRuntime`）：参数换算后组装成 REST 的同一个 DTO，过与 `ValidationPipe` 相同的校验（whitelist + 禁止多余字段）再调 service；写工具每分钟限 30 次（另计于总上限），成功后写一条 `mcp.tool_call` 审计（`metadata` 带 token id/名称与工具名）。没有自带幂等的新建类 service（物品、订阅、保险、计划等）用 `IdempotencyService` 按「工具 + 账本 + token」作用域兜住 `idempotencyKey`；建账户/子账户复用其自身的幂等键参数。服务端 `instructions` 按 token 的 scope 拼装（`mcp-instructions.ts`），明确告诉智能体「草稿≠已入账」。

**刻意不提供**：确认待确认、批准变更申请、确认计划周期/订阅续订（用户本人的动作）；物品/订阅/保险的删除（交易删除只能走变更申请）；账户归档、排序；分类与人员的增改；账本、成员、邀请、导入导出、备份恢复、管理员与 token 管理。

## 6. 变更申请（P3）

已入账交易的修改/删除、余额调整同样「动钱」，但待确认表承载不了（改的是已存在的数据）。智能体（scope `changes:write`）只能提交**变更申请**，用户在「更多 › 智能体接入」顶部的「待批准」区块里看过前后对比后批准或驳回。

表 `agent_change_requests`（迁移 `60_agent_change_requests`）：`kind`（`transaction.update` / `transaction.delete` / `account.adjust`）、`target_id`（不设外键，账本恢复会重建目标 id）、`target_version`（交易为申请时的 `updated_at`，余额调整为申请时的余额）、`payload`（批准时交给 service 的输入；交易修改只存**补丁**）、`summary`（申请时生成的前后对比快照 `{ target, rows: [{ field, before, after, currency? }] }`，金额是 micros 字符串，由前端格式化）、`reason`、`status`（`pending` / `approved` / `rejected` / `withdrawn` / `failed`）、`error`、`result_id`；幂等键按 token 部分唯一。

- **申请时就校验**：交易修改在「当前完整输入 + 补丁」上走 `TransactionsService.dryRunUpdate`（真实修改路径试算后回滚）；没有变化直接拒绝；外币交易的金额涉及汇率，不接受修改申请；余额调整校验账户/子账户（money 账户缺省落默认子账户，与 `adjust` 同口径）、负债类不得为负、`kind` 只限投资账户。
- **批准 = 执行，原子完成**（`AgentChangeRequestsService.approve`）：一个数据库事务里依次「带 status 条件的 `updateMany` 抢占（并发批准只有一方成功，另一方 409）→ 对目标行 `FOR UPDATE` 并核对 `target_version`（不一致即拒绝，免得按过期的对比执行）→ 调领域 service 的事务体」。为此把 `TransactionsService.update/delete` 与 `AccountsService.adjust` 的事务体抽成 `updateWithin` / `deleteWithin` / `adjustWithin`（原方法行为不变）。交易修改在批准那一刻的**最新数据**上重放补丁，申请之后在资产页上新挂的关联不会被旧快照覆盖。执行失败整体回滚，申请标 `failed` 并记录原因；删除交易的附件在提交后清理。
- 智能体侧工具：`request_transaction_update` / `request_transaction_delete` / `request_balance_adjustment`（新建账户的初始余额也走它）、`get_change_requests`（只看本 token 提交的）、`withdraw_change_request`。**没有任何批准工具**，批准只走 session 接口 `POST /ledgers/:id/agent-change-requests/:requestId/approve|reject`。
- 推送：与草稿共用 `agent.drafts.notify` 任务，变更申请一律合并成一张「智能体提交了 N 条变更申请」汇总卡，每条写明改了什么（如「金额 ¥30.00→¥25.00」），**不挂按钮**——改/删已入账数据要在应用里看过完整对比再批准。
- 待批准数计入红点汇总（`reminder-summary` 的 `agentRequests`）；移动端账单页「更多」菜单、桌面侧边栏「智能体接入」、更多页都有入口。账本 JSON 恢复时清掉该账本的申请（目标 id 已重建，留着只会是批不了的孤儿）。

## 7. 前端

- **更多 › 智能体接入**（移动 + 桌面）：token 列表（名称、账本、scopes、最近使用时间/IP、到期）、新建（选账本、勾 scopes，`accounts/assets/plans:write` 默认不勾）、吊销。创建成功弹层只显示一次明文，并给出可复制的配置片段：

  ```bash
  claude mcp add --transport http fin-nest https://<域名>/api/mcp \
    --header "Authorization: Bearer fn_pat_xxx"
  ```

  以及 Cursor / Codex 的 JSON 配置示例。

- 待确认列表/详情显示来源标签；红点无需改动（已计全部 pending）。
- 新增文案全部走 `t()` 并补 `en.ts`；`contracts.ts` / `endpoints.ts` 同步。

## 8. 分期

| 期      | 内容                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| P1 只读 | ✅ `agent_tokens` 迁移与鉴权、`/mcp` 端点、全部只读工具、token 管理页（「更多 › 智能体接入」） |
| P2 写入 | ✅ 待确认迁移与来源展示、交易草稿工具、档案写入工具、起草推送、token 权限选择                  |
| P3      | ✅ 变更申请（§6）                                                                              |

## 9. 验证

P1 实现位置：后端 `apps/api/src/modules/mcp/`（`agent-token.service.ts` 鉴权与限流、`agent-tokens.controller.ts` 即 `GET/POST/PATCH/DELETE /auth/agent-tokens`、`mcp.controller.ts` 即 `POST /mcp`、`mcp-tools.service.ts` 工具）；迁移 `58_agent_tokens`；前端 `apps/web/src/app/more/agents/`。e2e 的 `assertAgentMcp` 覆盖 token 管理、鉴权失败、账本白名单、非成员拒绝、金额口径与吊销。

> TS 解析注意：api 的 `moduleResolution` 是 `Node`，不读 `exports`，`apps/api/tsconfig.json` 用 `paths` 把 `@modelcontextprotocol/sdk/*` 的类型指到 `dist/cjs/*`；运行时 `require` 按 `exports` 正常解析，nest build 也不会改写这些导入。

P2 实现位置：`mcp-write-tools.service.ts`（写工具）、`mcp-common.ts`（公共运行时）、`mcp-instructions.ts`；`AutomationService` 的智能体草稿方法；Worker `ReminderSchedulerService.enqueueForAgentDrafts` 与 `agent.drafts.notify` 任务；迁移 `59_agent_drafts`。e2e 的 `assertAgentMcpWrites` 覆盖：read 必选、按 scope 注册工具、起草不动余额、幂等重放、非法分类/精度被拒、推送任务只排一个、跨 token 不能改/撤草稿、用户确认后交易来源 `agent` 且余额正确、`get_draft_status`、撤回、账户/物品/订阅/保险/计划/预算写工具与幂等、物品「购入」关联方式、审计、账本 JSON 备份恢复后草稿可确认。

P3 实现位置：`apps/api/src/modules/agent-requests/`（服务与审批接口）、`mcp-change-tools.service.ts`；前端 `app/more/agents/_components/AgentChangeRequestsSection.tsx`；迁移 `60_agent_change_requests`。e2e 的 `assertAgentMcpChangeRequests` 覆盖：工具按 scope 注册、申请不立即生效、幂等、无变化/非法修改被拒、红点计数、批准后金额/余额正确、重复批准 409、申请后目标被改则批准被拒并标 failed、驳回、撤回与跨 token 隔离、余额调整、删除申请、审批审计。

- `pnpm typecheck`、`pnpm --filter @fin-nest/api test:i18n`、`pnpm e2e:api`。
- e2e 新增：无/错 token 401；吊销、过期、禁用用户 401；缺 scope 403；白名单外账本 403；拿别的账本的分类/账户 id 起草被拒；同 `idempotencyKey` 重复起草只生成一条；草稿经用户 session 确认后生成交易且余额正确；智能体不能修改/撤回别人或自动规则生成的待确认；账本 JSON 备份恢复后来源为智能体的待确认仍可确认。
- 手工：用 Claude Code `claude mcp add` 接入本地实例，走一遍「查余额 → 起草两笔 → App 内批量确认 → `get_draft_status`」。
