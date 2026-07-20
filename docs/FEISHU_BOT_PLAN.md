# 飞书机器人接入方案

状态：**P1 / P2 / P3 均已实施**。本文应尽快把要点并入 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) 并归档。

迁移 `35_feishu_bot` 已执行。**真机验证进度**：长连接与绑定流程已在真实环境跑通；**卡片渲染与按钮确认入账尚未真机验证**（离线覆盖范围见 §12）。

> 修订记录：v2 按评审意见修正了同步阻塞 LLM、会话按 chat 隔离、卡片操作者鉴权、绑定码原子消费、软删与唯一索引冲突、事件收件箱、部署清单、测试范围八项。

---

## 1. 目标与非目标

**目标**：在飞书里私聊机器人完成日常记账与查询，能力对齐 Web 的 `/ai` 页——自然语言记账（草稿卡确认入账）、统计/账户/预算查询、多账本切换。

**非目标（本期不做）**：

- 飞书侧编辑草稿（只能「确认入账」或「作废」，要改字段去 Web）；
- 图表渲染（饼图/折线降级为文本，不做服务端渲图上传）；
- 流式打字机效果（飞书卡片可增量更新，但收益不抵复杂度）；
- 群聊记账协作（群里只在 @ 时响应，且各成员按各自绑定解析身份）。

## 2. 接入形态：长连接（WSClient）

采用飞书**长连接**而非 webhook：API 进程主动连飞书，不暴露公网回调地址，因而**不需要** Encrypt Key 解密、签名校验、challenge 握手、rawBody 处理，也不用动 `main.ts` 的全局 `ValidationPipe`。

代价是引入 `@larksuiteoapi/node-sdk`（仅用其 `WSClient`；发消息仍走自写薄 client，风格对齐 [`llm-client.ts`](../apps/api/src/modules/ai/llm-client.ts)）。硬规则第 9 条只禁前端视觉组件库，后端 SDK 无冲突。

> **待验证（需真机）**：长连接的 ack 超时与重推间隔、以及多副本部署时同一事件是否只投一个实例。这两项都无法离线确认。§3 的设计**不依赖**任何具体超时数字——handler 一律立即返回，因此即使实测超时比预期严格也不受影响。多副本先按单实例假设落地（项目本就如此：登录限速、AI 限速均为内存实现），§4 的事件表已为将来多副本留了唯一约束。

## 3. 事件处理：立即 ack + 持久化收件箱

**绝不能在事件 handler 里同步 await LLM。** 一轮对话含最多 6 轮工具循环，耗时几十秒量级；阻塞 handler 会触发重推、堆积连接、拖垮事件循环。

同时，「立即 ack 后放进内存队列」也不够——ack 之后进程重启，飞书不会再推，消息就永久丢了。因此事件表既做去重也做**收件箱**（这也是不复用 `IdempotencyService` 的原因，见 §10）：

```
WSClient 收到事件
  → ① 落库 feishu_events（event_id 唯一约束；冲突即重复推送，直接 ack 返回）
  → ② 立即 ack，handler 返回                    ← 到此为止是同步的
  ────────────────────────────────────────────
  → ③ 异步 worker 取 pending 行处理（按 open_id 串行，保证同一用户消息有序）
  → ④ 处理完置 done / 失败置 failed + 错误信息
  → ⑤ 进程启动时把 pending 与超时 processing 重新入队
```

消息事件的完整链路：

```
③ 解析 open_id → FeishuBindingService → { userId, currentLedgerId }
  → 未绑定 → 引导绑定；是指令 → 指令路由；否则 ↓
  → FeishuChatSession 按 (open_id, chat_id) 取/建 conversationId
  → AiService.chat(ledgerId, userId, { conversationId, content })
  → AiCard[] → feishu-cards.ts → FeishuClient.sendMessage(chat_id, card)
```

卡片按钮链路：

```
③ card.action.trigger
  → 鉴权（见 §8）：点击者 open_id 的绑定 userId 必须 == 卡片所属会话的 userId
  → TransactionsService.create(..., `ai-card-{messageId}-{cardIndex}`)
  → AiService.updateCardState(status=confirmed, transactionId)
  → FeishuClient.updateCard(...) 回写「已记账」
```

**关键性质**：草稿确认复用与 Web 完全相同的幂等键，且 `TransactionsService.create` 的幂等键是 service 层参数（见 [transactions.controller.ts:57](../apps/api/src/modules/transactions/transactions.controller.ts:57)），可在进程内直接传。因此**同一张草稿卡在飞书点一次、Web 再点一次也不会重复入账**。

## 4. 数据模型

新增四个模型，追加迁移目录 `packages/db/prisma/migrations/35_feishu_bot/`（沿用两位补零递增前缀，当前最大为 `34_ai_assistant`）。

```prisma
/// 飞书账号 ↔ fin-nest 用户绑定。账本作为可切换的当前选择，对应 Web 端 LedgerProvider 的模型。
/// 注意 openId 不能用 @unique：解绑走软删，同一 openId 需要能再次绑定。
/// 唯一性由迁移里的部分唯一索引保证（WHERE revoked_at IS NULL），项目已有此类 raw SQL 先例。
model FeishuBinding {
  id              String    @id @default(uuid()) @db.Uuid
  openId          String    @map("open_id")
  unionId         String?   @map("union_id")
  userId          String    @map("user_id") @db.Uuid
  currentLedgerId String    @map("current_ledger_id") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  revokedAt       DateTime? @map("revoked_at") @db.Timestamptz(6)

  @@index([openId])
  @@map("feishu_bindings")
}

/// 会话按 (open_id, chat_id) 隔离：同一用户在私聊与各群里的上下文互不串味。
model FeishuChatSession {
  id             String   @id @default(uuid()) @db.Uuid
  openId         String   @map("open_id")
  chatId         String   @map("chat_id")
  conversationId String   @map("conversation_id") @db.Uuid
  lastActiveAt   DateTime @default(now()) @map("last_active_at") @db.Timestamptz(6)

  @@unique([openId, chatId])
  @@map("feishu_chat_sessions")
}

/// 一次性绑定码。明文只在生成时返回一次，库中只存 sha256，对齐 LedgerInvite / ServiceToken。
model FeishuBindCode {
  id        String    @id @default(uuid()) @db.Uuid
  codeHash  String    @unique @map("code_hash")
  userId    String    @map("user_id") @db.Uuid
  ledgerId  String    @map("ledger_id") @db.Uuid
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt    DateTime? @map("used_at") @db.Timestamptz(6)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("feishu_bind_codes")
}

/// 事件去重 + 收件箱（见 §3）。event_id 唯一即天然去重。
model FeishuEvent {
  id          String    @id @default(uuid()) @db.Uuid
  eventId     String    @unique @map("event_id")
  eventType   String    @map("event_type")
  payload     Json
  status      String    @default("pending")   // pending | processing | done | failed
  attempts    Int       @default(0)
  lastError   String?   @map("last_error")
  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt  DateTime? @map("finished_at") @db.Timestamptz(6)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([status, createdAt])
  @@map("feishu_events")
}
```

迁移里的 raw SQL：

```sql
CREATE UNIQUE INDEX feishu_bindings_open_id_active_key
  ON feishu_bindings (open_id) WHERE revoked_at IS NULL;
```

解绑走软删（`revokedAt`），符合硬规则第 8 条；部分唯一索引保证「同一时刻一个 openId 只有一条生效绑定」，同时允许历史绑定留痕与重新绑定。

`feishu_events.payload` 保留原始事件，便于排障；清理由收件箱负责——每小时清理一次完成超过 7 天的终态（done / failed）事件（`feishu-inbox.service.ts` 的 `maybeCleanupOldEvents`），pending / processing 不受影响。

## 5. 身份绑定

### 交互

```
① Web  更多 → 飞书机器人 → 「生成绑定码」
       弹出  K7M4-P2QX   （10 分钟有效，仅显示一次）
② 飞书 私聊机器人：  绑定 K7M4-P2QX
③ 机器人回卡片：✅ 已绑定 / 账号 / 当前账本 / 可用指令提示
④ Web  同步显示：已绑定飞书「张三」· 2026-07-19 · [解绑]
```

### 绑定码参数

| 项       | 取值                         | 理由                                                                                    |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| 生成粒度 | 每次点「生成」一个新码       | **不做每用户固定码**——固定码等于永不过期的 bearer 凭证                                  |
| 有效期   | 10 分钟                      | 给自己用，不需转发，比邀请码的 1 天短得多                                               |
| 使用次数 | 1 次（`usedAt` 落库）        | 用完即废                                                                                |
| 存储     | 只存 `codeHash`（sha256）    | 复用 `hashToken`（[token-utils.ts:23](../apps/api/src/modules/auth/token-utils.ts:23)） |
| 码型     | 8 位，字符集去掉 `0/O/1/I/l` | 需在手机上手打；8 位 ≈ 40 bit + 10 分钟 TTL + 限速足够                                  |
| 重复生成 | 新码作废该用户全部未用码     | 避免一堆有效码飘着                                                                      |

### 消费必须原子

「先查再改」会让并发的两条绑定消息都通过。用带条件的 `updateMany` 抢占（与硬规则 7 里「确认待确认」的做法一致），整体放进 `DatabaseTransactionService.run`：

```ts
await this.tx.run(async (tx) => {
  const claimed = await tx.feishuBindCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0)
    throw new AppError("FEISHU_BIND_CODE_INVALID", "绑定码无效或已过期", 400);
  // 同一 openId 若有生效绑定先软删，再插入新绑定（部分唯一索引要求同时只有一条生效）
  await tx.feishuBinding.updateMany({
    where: { openId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.feishuBinding.create({ data: { openId, unionId, userId, currentLedgerId: ledgerId } });
});
```

### 安全约束

1. **只在私聊（p2p）接受绑定**。群消息里的绑定指令一律拒绝并提示私聊——群里发码等于泄漏给全群。
2. **按 open_id 限速失败尝试**（15 分钟 5 次，对齐登录限速思路），防枚举。
3. **双向可见**：机器人回显绑定到了谁/哪个账本，Web 也列出已绑定账号与时间，两边都能解绑。误绑能立刻发现。

## 6. 指令集

| 输入                   | 行为                                                    |
| ---------------------- | ------------------------------------------------------- |
| `绑定 <码>` / `/bind`  | 仅私聊；原子消费码 → 建绑定 → 回执卡片                  |
| `切换账本` / `/ledger` | 按 `userId` 列出其 `LedgerMember` → 选择卡片 → 更新绑定 |
| `解绑` / `/unbind`     | 软删绑定                                                |
| `帮助` / `/help`       | 指令说明                                                |
| `新对话` / `/new`      | 重置当前 `(open_id, chat_id)` 的会话                    |
| 其余文本               | 透传 `AiService.chat`                                   |

未绑定用户发任何非绑定指令 → 统一引导去 Web 生成绑定码。

**会话窗口**：`FeishuChatSession.lastActiveAt` 超过 30 分钟则该 chat 自动开新 `AiConversation`。注意 `切换账本` 后也应重置会话——旧上下文里的账本数据对新账本无意义且可能误导模型。

## 7. 卡片映射

`feishu-cards.ts` 把 `AiCard`（[ai-cards.ts:69](../apps/api/src/modules/ai/ai-cards.ts:69)）映射为飞书卡片 JSON。金额一律 micros 字符串，渲染时按账本币种与小数位格式化——**禁止 `number` 参与换算**（硬规则 1）。

大模型正文不使用普通 `text` 消息发送，而是包装为 JSON 2.0 `markdown` 卡片，确保标题、列表、加粗、链接等 Markdown 语法可正常渲染；业务数据卡片仍各自独占一条消息。

| `kind`              | 飞书渲染                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `transaction_draft` | 交互卡片：字段列表 + `[作废] [确认入账]`；确认后整卡替换为「已记账」态                                            |
| `transactions`      | JSON 2.0 原生表格，每页 10 行、最多 50 行；展示日期/类型/二级分类/人员/记账人/金额/备注，超出后在底部提示剩余笔数 |
| `stats_period`      | JSON 2.0 原生图表：收支汇总 + 支出分类柱状图；有 `trend` 时追加收支折线图，无数据时保留文字提示                   |
| `account_balances`  | 按类型分组列表 + 净资产汇总；`isLiability` 展示为负向                                                             |
| `budget_progress`   | 百分比 + 字符进度条（`████░░░░ 52%`）                                                                             |
| `stats_month`       | 收支汇总 + 支出分类柱状图（历史卡，飞书侧不会新产生）                                                             |

## 8. 卡片操作鉴权

**飞书卡片一旦发到群里，任何群成员都能点上面的按钮。** 没有鉴权的话，别人点一下「确认入账」就往你账本写了一笔。因此 `card.action.trigger` 处理器**第一件事**是校验操作者：

1. 按点击者的 `open_id` 查生效绑定；无绑定 → 拒绝，回「你尚未绑定」。
2. 取卡片 `value` 里带的 `messageId` / `cardIndex`，查出 `AiMessage` → `AiConversation`。
3. **`conversation.userId` 必须等于点击者绑定的 `userId`**，否则拒绝并回「无权操作他人的记账卡片」。
4. `conversation.ledgerId` 与绑定的 `currentLedgerId` 不一致时，以**卡片所属的 ledgerId** 为准（用户可能已切账本），但仍需 `assertMember` 复核。

卡片 `value` 里**只放 `messageId` / `cardIndex`**，不放 `userId` / `ledgerId`——那些是客户端可篡改的输入，服务端一律从库里反查。

`AiService.updateCardState` 内部已有归属校验，是第二道防线；上述是第一道，两道都要有。

## 9. 环境变量

对齐 AI 模块的「可选启用」模式：两项都配置才启用，否则整个模块不注册、不建长连接。加在 [`packages/config/src/index.ts`](../packages/config/src/index.ts) 的 `EnvSchema` 并在 `superRefine` 里校验成对出现。

| 变量                | 说明                |
| ------------------- | ------------------- |
| `FEISHU_APP_ID`     | 自建应用 App ID     |
| `FEISHU_APP_SECRET` | 自建应用 App Secret |

长连接形态下无需 `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN`。

## 10. 文件清单

```
packages/db/prisma/schema.prisma                     # + 4 个模型
packages/db/prisma/migrations/35_feishu_bot/migration.sql   # 含部分唯一索引 raw SQL
packages/config/src/index.ts                         # + FEISHU_APP_ID / FEISHU_APP_SECRET

apps/api/src/modules/feishu/       # ✅ 已建，标 ☐ 的为 P2/P3 待建
  feishu.module.ts                # ✅ P1 只注册绑定链路；P2 加长连接（未配置则不建连）
  feishu-binding.service.ts       # ✅ 绑定码生成/原子消费、绑定 CRUD、切换账本
  feishu-bind.controller.ts       # ✅ Web 端接口，走 SessionAuthGuard
  dto/create-bind-code.dto.ts     # ✅
  feishu-client.ts                # ✅ tenant_access_token 缓存 + 发文本（更新卡片留给 P3）
  feishu-ws.service.ts            # ✅ OnModuleInit 建连、OnModuleDestroy 断开；handler 只落库 + ack
  feishu-inbox.service.ts         # ✅ 收件箱消费者：FOR UPDATE SKIP LOCKED 认领、按 open_id 串行、重启重入队
  feishu-event.service.ts         # ✅ 单条事件处理：指令路由 + 接 AiService + 会话窗口
  feishu-events.ts                # ✅ 原始事件 → 归一化消息（纯函数，已单测）
  feishu-commands.ts              # ✅ 指令解析（纯函数，已单测）
  feishu-cards.ts                 # ☐ AiCard → 飞书卡片 JSON（纯函数，可单测）
  feishu-draft.ts                 # ☐ AiDraftFields → TransactionsService 入参（见 §11）

apps/api/scripts/feishu-logic.test.mjs   # ✅ 指令解析 + 事件归一化单测（pnpm test:feishu）

apps/web/src/app/more/feishu/     # 新增子页（绑定流程有状态：生成码/倒计时/已绑列表，
  page.tsx                        #   塞进现有系统设置页会挤）
  FeishuBindingScreen.tsx
apps/web/src/app/more/MoreScreen.tsx                 # + 入口
apps/web/src/lib/api/contracts.ts + endpoints.ts     # 硬规则 7

# 部署 —— 环境变量必须逐层穿透，漏一处就是「本地能跑、线上不启用」
.env.example                                         # + FEISHU_*（注明可选）
infra/compose/docker-compose.dev.yml                 # 如 dev 需要则透传
infra/compose/docker-compose.prod.yml                # api 服务 environment 增加 FEISHU_*
infra/docker/README.md                               # 部署说明补飞书章节与前置条件
apps/api/package.json                                # + @larksuiteoapi/node-sdk
```

## 11. 需要注意的实现细节

**草稿 → 交易入参的映射目前只有 Web 版**。`draftToTransactionInput` 是 [AiScreen.tsx:77](../apps/web/src/app/ai/AiScreen.tsx:77) 里的私有函数，服务端没有等价物。新增 `feishu-draft.ts` 做服务端映射，**不要**把 web 的 `TransactionInput` 类型引到后端；两边逻辑重复但类型边界干净。若后续第三处（iOS 捷径）也要用，再考虑下沉到 `packages/shared`。

**为什么不复用 `IdempotencyService` 做事件去重**：它的语义是「预留占位 → 执行 → 落响应，失败释放，5 分钟遗留占位可接管」，为 HTTP 重试设计。用在事件上有两处不合：① 5 分钟接管窗口——一轮跑满工具循环的对话若撞上重推会被二次处理，重复发消息；② 它不承担收件箱职责，ack 后崩溃即丢消息。专用表同时解决去重与持久化，且没有接管语义，成本只是一张表。

**AI 限速是按 userId 的**（[ai.service.ts:442](../apps/api/src/modules/ai/ai.service.ts:442)）。飞书与 Web 共用同一用户的滑动窗口，这是期望行为，无需改动。

**按钮重复点击**由 `updateCardState` 的带 status 条件更新兜住（同硬规则 7 里待确认的做法），叠加 §3 的幂等键，双保险。

**不违反的硬规则**：飞书模块不直接写交易表，一律经 `AiService` / `TransactionsService`（规则 6）；迁移显式执行（规则 8）；改后端响应结构需同步 `contracts.ts` + 移动 UI + 桌面 UI 三处（规则 7）。

## 12. 验证

**离线可测（占绝大部分逻辑，应覆盖到）**：

| 目标                         | 手段                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| 指令解析、卡片映射、草稿映射 | 纯函数 + `node:test`，沿用 [`scripts/ai-logic.test.mjs`](../apps/api/scripts/ai-logic.test.mjs) 先例 |
| 绑定码生成/过期/单次消费     | 接入 `pnpm e2e:api`，含**并发消费同一码只有一条成功**的用例                                          |
| 解绑后可重新绑定             | e2e：绑定 → 解绑 → 再绑，验证部分唯一索引行为                                                        |
| 卡片操作越权被拒             | e2e：用户 B 的 open_id 点用户 A 的卡片 → 期望拒绝                                                    |
| 会话按 chat 隔离             | e2e：同一 open_id 两个 chat_id → 两个 conversationId                                                 |
| 事件去重与重启重入队         | e2e：重复投同一 event_id → 只处理一次；pending 行重启后被捡起                                        |
| 类型与规范                   | `pnpm typecheck`、`pnpm lint`                                                                        |

做法是把 `feishu-event.service` 的入口设计成**接受一个已解析的事件对象**，而非从 WSClient 直接读——这样测试可以直接喂构造好的事件，不需要飞书连接。

**必须真机验证（无法离线）**：WSClient 连接与 ack/重推语义、卡片 JSON 的实际渲染效果、`tenant_access_token` 流程。

**外部前置条件**：真实 `FEISHU_APP_ID/SECRET`，以及一个可建自建应用的飞书企业（需管理员开通机器人能力 + `im:message`、`im:message:send_as_bot` 权限）。

## 13. 实施顺序

| 阶段 | 内容                                                                      | 验证                                     |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------- |
| P1   | ✅ schema + 迁移 + config + `feishu-binding.service` + Web 绑定页与接口   | typecheck / lint；**绑定流程已真机跑通** |
| P2   | ✅ `feishu-client` + `feishu-ws` + 事件表与收件箱 + 指令路由 + 纯文本问答 | 纯函数单测；**长连接已真机跑通**         |
| P3   | ✅ `feishu-cards` 全量映射 + 草稿卡按钮确认入账 + §8 鉴权 + 卡片回写      | 纯函数单测 26 例；**渲染与按钮未经真机** |

### 卡片按钮为什么同步处理

消息事件走收件箱是因为 LLM 慢；卡片按钮只有几次数据库写、**不调 LLM**，秒级完成。
且 SDK 的 `handleEventData` 是 await 完 handler 才发 ack——走收件箱要多等一个轮询周期，
点按钮的手感会明显发木。两条路策略不同是刻意的，改动时别顺手统一。

### 剩余缺口

- **卡片渲染与按钮确认尚未真机验证**：卡片 JSON schema、`PATCH /im/v1/messages` 回写、
  `card.action.trigger` 的实际 payload 形状都只有离线单测覆盖。
- **`切换账本` 仍是名称匹配**而非选择卡片；同名账本明确拒绝而不是猜。
- **e2e 用例部分已补**：绑定码并发消费、事件去重、解绑后重新绑定已写进 `pnpm e2e:api`
  （`feishuDbConstraints`）；卡片操作越权、会话按 chat 隔离需要 service 层集成测试 harness，暂未覆盖。
