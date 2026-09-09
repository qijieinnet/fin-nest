# Fin Nest

> 自己部署的记账应用，个人和家庭都能用。手机、电脑、飞书里随手记一笔；一个 **AI Agent** 帮你记账、查账，还能在你想买点什么的时候翻出你自己的账本，算给你看这钱花不花得起。数据全部留在你自己的服务器上。

<p>
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white">
</p>

手机上像原生 App（可以添加到主屏幕、收通知），电脑上是侧边栏布局，同一套账本。一条 `docker compose` 命令部署到自己的 NAS 或 VPS，对外只开一个端口。

> 界面预览可在此补充截图。将图片放入 `docs/assets/` 后，用 `![首页](docs/assets/home.png)` 引入即可。

---

## 能做什么

**🤖 AI Agent** —— 一句话记一笔账，问一句就出统计图；想换手机、想买台相机时，它会翻出你的旧物持有成本、近一年月均收支、手头能动的钱和本月预算，再上网查查现在什么价，告诉你划不划算。记账前一律先出草稿卡片，你点确认才入账。👉 [详见下文](#-ai-agent从记一笔到该不该买)

**💬 飞书里就能用** —— 私聊机器人说「买菜 86」就记完了，卡片上点一下确认。订阅要续费、保单要到期、自动记账有待确认，也都推到飞书，按钮直接处理。👉 [详见下文](#-飞书把记账和提醒搬进聊天窗口)

**✍️ 记账**
- 支出、收入、转账三种；一级 / 二级分类、人员、账户与子账户、备注、附件（票据拍照存着）。
- 借出去的钱、欠别人的钱单独记一类，收回和归还自动对得上。
- 一笔账可以挂到某张保单、某件物品、某个订阅上，事后知道这钱花在哪。
- 多条件筛选，筛完就有一张汇总卡片。

**💳 账户与净资产**
- 储蓄卡 / 信用卡 / 投资账户，可以再拆子账户（比如一张卡里的几笔理财）。
- 改余额会留一条调整记录，不静默改数；每个账户都有完整流水可查。
- 账户可以标归属人，净资产曲线能按家里的人分开看。

**🎯 预算与计划**
- 月度总预算 + 分类预算，按自然月滚动。
- 计划：给某类支出设上限、给某项收入设目标，按金额或次数，周 / 月 / 年都行，超了会提醒。

**🔁 自动记账与快捷记账**
- 房租、话费这种固定支出配成规则，到期自动生成一条**待确认**，你点确认才入账。
- 常记的账做成快捷模板，一键记账或预填表单。

**🗂️ 保险 / 物品 / 订阅档案**
- 保单：险种、保司、保额保费、缴费周期与期数、被保人、起止日期，到期前提醒。
- 物品：买入价、预期寿命、已用进度、报废或转卖，AI 算日均持有成本时就用这里的数据。
- 订阅：iCloud、Claude、Apple Music 之类，费用、计费周期、下次续费日，到期前提醒续不续。

**📊 统计**
- 月度收支、分类占比与下钻、人员排行、趋势、净资产曲线、现金流曲线。

**🔔 提醒**
- 订阅续费、保单到期、自动记账待确认、「今天还没记账」都会提醒。
- 一条提醒可以配最多 5 档（先提醒自己，临到期再抄送家人）。
- 你只需要选「提醒谁」，走飞书还是手机通知由收到的人自己定；同一条提醒不管从哪点，只会生效一次。
- iPhone 收通知不需要 Apple 开发者账号，网页加到主屏幕就能收。

**👨‍👩‍👧 多人协作**
- 多账本、多成员；发邀请码 → 对方申请 → 账本创建者审批。
- 每个账本自己的币种和权限，互相看不到。

**💾 数据是你的**
- Excel 导入导出、记账模板下载；账本级 JSON 备份与恢复。
- 整站自动备份：数据库、附件原文、每个账本的 Excel 一起打包成 zip，定时跑、可设保留份数，换机器直接传回去就能恢复。

**🔐 安全**
- 应用锁：打开就要 Face ID / Touch ID（或输密码）才能看账，在飞书里默认免验证。
- 首个注册的人是管理员，可以关掉注册、禁用用户；改密码自动踢掉其它设备。

---

## 🤖 AI Agent：从「记一笔」到「该不该买」

> 可选功能，配好模型地址就启用；不配就当它不存在，界面上连入口都不会出现。

### 一句话记一笔，你点确认才入账

```text
你：昨天在山姆买菜 328，从招行卡出
AI：[草稿卡片] 支出 · 食品生鲜 / 生鲜 · 招商银行储蓄卡 · 09-08 · ¥328.00
                        [ 确认入账 ]  [ 编辑 ]
```

AI **不能直接动你的账本**——它只会生成一张草稿卡片，你点确认才真正入账，觉得哪里不对可以先进表单改完再存。手快点了两下也不会记成两笔。金额怎么换算、这个分类和账户是不是你这个账本的，都由后端算和校验，模型说了不算。也可以直接说「用『地铁通勤』模板记一笔」，套用你自己存好的快捷模板。

### 问一句，出的是卡片和图，不是一段空话

| 你问 | 你得到 |
|---|---|
| 上个月餐饮花了多少 | 总额 + 分类饼图 + 一级分类汇总；只问支出就不给你掺收入 |
| 最近半年支出趋势怎么样 | 再附一条趋势折线，日 / 周 / 月的粒度自动挑 |
| 这个月老婆记了哪些账 | 逐笔明细，能按「谁花的」和「谁记的」分开筛，排序随你 |
| 我现在各账户还有多少钱 | 账户余额卡片 |
| 这个月预算还剩多少 | 预算进度卡片 |
| 我有哪些订阅 / 保单什么时候到期 / 有什么待确认 | 订阅、保单、物品、计划进度、自动记账待确认，逐条说给你听 |

算出来的数和网页上的完全一致，不会出现「AI 说的和页面对不上」。

### 想买点什么时，它替你算一遍

```text
你：我那台 iPhone 用了快四年，想换 iPhone 17 Pro，该换吗？
```

它会先把你自己的账本翻一遍：

- 旧的那台买了多久、连配件耗材一共花了多少、**平均每天多少钱**（物品档案没建的话，就去翻备注里提到过它的历史支出）；
- 近半年到一年每个月挣多少、花多少、月均是多少（**当月没过完不算进去**，不然月均会虚低）；
- 手头能动的现金、净资产、本月预算还剩多少、每月固定要交的订阅有多少。

再上网查一下现在什么价、二手行情如何，最后给你一句结论。

联网搜索是可选的，而且只会用你部署时指定的那一家（博查 / Tavily / 自建 SearXNG）——模型只能决定搜什么词，不能让它去抓任意网址。这东西通常跑在家里的 NAS 上，放开抓取等于把内网门打开。搜回来的内容一律当外部资料看，里面写了什么指令都不执行。

> 一条红线：不做投资顾问，不给股票 / 基金 / 保险的买卖建议，只帮你算量入为出。

### 接哪家模型都行

DeepSeek、通义、OpenAI，或者家里自己跑的 Ollama 都可以，填好地址和 key 就能用。请求里固定要求上游不保存对话，你的账本数据不会留在别人服务器上。

---

## 💬 飞书：把记账和提醒搬进聊天窗口

> 可选功能，填好飞书自建应用的两项配置就启用。是**主动连出去**的长连接，不需要公网回调地址，家里的 NAS 不用做端口映射也能用。

### 绑定一次，之后就是聊天

网页上「更多 → 飞书机器人」拿一个绑定码（10 分钟有效，只显示一次），私聊机器人发「绑定 &lt;码&gt;」就好了。绑定码只能在私聊里用，群里发会被拒绝；随时可以解绑或换账本。

### 记账、查账，和网页上是同一个 AI Agent

私聊直接说话、群里 @ 一下机器人，上面那些能力一个不少——记账、统计、账户余额、预算进度、要不要买。草稿以飞书卡片的形式发出来，点「确认入账」当场落库；网页和飞书用的是同一套去重，两边重复点也不会记成两笔。

### 提醒也能在飞书里直接办完

订阅到期的卡片上带「退订 / 确认续订」，自动记账待确认带「删除 / 确认入账」，保单到期带「已确认」，点一下就办完了，不用再打开网页。卡片上的字段和网页详情一致，没填的字段不会占位。

一条提醒配了好几档提前量时，**处理过一次，后面几档就不再打扰你**；同一条提醒在飞书和手机通知之间只会生效一次——你在飞书点了「确认续订」，家人从 iPhone 通知点进去看到的是「已由 XX 处理」。

### 别人点不了你的账

卡片上的按钮会校验点击者：必须是绑过号的本人，群里其他人点不动，也不能拿这张卡片的按钮去操作别的东西。另外，开了 Face ID 应用锁的人在飞书里默认免验证——能打开页面说明已经过了飞书自己的登录和设备锁，没必要再验一遍（只在飞书内生效）。

---

## 📋 功能细节

> 上面「能做什么」是概览，这一节是逐项的实现说明，供想改代码或评估的人看。

### 认证与系统管理
- 邮箱 / 账号 + 密码注册登录；**首个注册用户自动成为系统管理员**并获得一个默认账本。
- 管理员能力：开关全站注册、禁用 / 启用用户、授予 / 撤销管理员（**保底至少保留一名管理员**）、管理 service token。
- 会话安全：改密自动吊销其它会话；禁用用户即时吊销其全部会话。
- **应用锁（Face ID / Touch ID）**：账号级开关，开启后该用户在任何设备整页加载都先弹锁定屏。iPhone / iPad 注册 WebAuthn 平台 passkey（公钥与计数器存服务端），其它设备回退输入登录密码；开关与凭证都在服务端，换浏览器登录后自动恢复。飞书客户端内默认免验证（能打开页面就已经过了飞书自己的登录态与设备锁）。
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
- **归属人员**：账户可挂到某个人员（可空 = 未指定），净资产序列支持按人拆分曲线。

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

### AI Agent（可选启用）
> 能做什么见上文「🤖 AI Agent」一节，这里只列启用条件与实现细节。
- 配置 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 即启用；未配置时接口返回未启用、前端自动隐藏入口。
- 两种上游协议：OpenAI-compatible `/chat/completions`（默认）与 OpenAI Responses API `/responses`；按 `AI_BASE_URL` 末段推断，必要时用 `AI_PROTOCOL=chat|responses` 显式指定。
- 聊天页 `/ai`（移动端底部导航独立入口 / 桌面侧边栏入口），SSE 流式输出（事件 `delta` / `card` / `done` / `error`），思维链不透出；非流式 `POST /ai/chat` 保留同构结果。
- 每轮用户请求的首轮必须选择一个结构化工具（闲聊 / 缺参数走 `respond_text`），避免模型仅用文字声称已生成卡片；卡片一旦生成即结束该轮。
- 会话按创建者私有并持久化（`ai_conversations` / `ai_messages`，软删）；工具循环上限 8 轮（决策链更长：`analyze_purchase` → `web_search` → 文字结论）。
- 联网搜索另配 `SEARCH_PROVIDER` / `SEARCH_API_KEY` 或 `SEARCH_BASE_URL`（`SEARCH_MAX_RESULTS` 默认 5）；不配则 `web_search` 工具不下发。

### 飞书机器人（可选启用）
> 怎么用见上文「💬 飞书」一节，这里只列启用条件与实现细节。
- 配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（飞书自建应用）即启用；长连接形态，无需公网回调地址与签名校验。未配置时不建连、前端自动隐藏入口。
- 绑定时会尝试拉取飞书昵称供 Web 端辨认（需应用开通 `contact:user.base:readonly`；未开通时降级显示 open_id 尾段，不影响绑定）。
- 消息事件落 `feishu_events`（`event_id` 唯一去重）后异步消费；卡片按钮回调同步处理，卡片更新由回调响应带回（不走 `PATCH /im/v1/messages`）。
- 按钮 value 只带 `notificationId`，账本与业务 id 全部反查；动作回落到与 Web 端相同的 service 方法。

### 推送通知（飞书 / Web Push）
- **只选人，不选渠道**：在订阅、保单、自动记账规则、记账提醒里配的是「推送给谁」（账本成员），走飞书还是浏览器通知由**接收人自己**在「更多 → 通知」里决定。加一条渠道不需要动任何业务表单。
- **多档到期提醒**：订阅 / 保单的到期提醒可配**最多 5 档**，每档独立的提前量、提醒时刻与接收人（先发的那档只提醒自己、临到期那档抄送家人）。任一档被处理后，同一轮的后续档自动中止。
- **记账提醒**：按每天 / 每周选星期 / 每月选日号 + 提醒时间推送，卡片带上「今日已记 N 笔」；每月选中的日号当月不存在时（如 31 号遇到 2 月）在当月最后一天提醒。
- **可操作卡片**：订阅到期挂「退订 / 确认续订」，自动记账待确认挂「删除待确认 / 确认入账」，动作一律回落到 Web 端同一批 service 方法，鉴权、幂等、审计都在里面。
- **Web Push / PWA（可选启用）**：配 `VAPID_*` 三项即启用（`pnpm gen:vapid` 生成）。走标准 Web Push 协议，服务端只往浏览器给的 endpoint 投递加密密文，**不需要 Apple 开发者账号或上架**。
- **iPhone 用法**：Safari 打开站点 → 分享 → 添加到主屏幕 → **从主屏图标打开**，再到「更多 → 通知」开启。这是 iOS 的硬性要求（Safari 标签页里收不到），站点还必须是有效证书的 HTTPS。
- **动作**：飞书卡片上的「确认续订 / 退订 / 确认入账」在手机通知上点不了（iOS 不支持通知按钮），改为点通知打开落地页处理。两边共享同一次抢占，**同一条提醒只会生效一次**——在飞书点过之后，手机上看到的是「已由 XX 处理」。
- 详见 [`docs/NOTIFY_CHANNELS_PLAN.md`](docs/NOTIFY_CHANNELS_PLAN.md)。

### 提醒红点
- `reminder-summary` 聚合入口，一处汇总：自动待确认、加入申请（owner）、保险 30 天内到期、订阅 30 天内续费、计划超限、计划周期待确认、预算超限。

### 导入导出与账本备份
- Excel 全量导出 / 记账模板下载 / 增量导入（`dryRun` 同步返回预览，正式导入入队后台 job，`import_jobs` 表跟踪状态）。
- JSON 全量备份与**覆盖式恢复**（仅 owner，需输入账本名二次确认；恢复时重新生成全部 UUID）。

### 系统级自动备份与恢复（仅管理员）
- **备份内容**：整套系统打进一个 zip 落到 `BACKUP_DIR` —— `manifest.json` + `database/<表>.jsonl`（表清单与列类型由 Prisma DMMF 现算，**新增表自动纳入**）+ `files/<对象键>`（附件原文）+ `excel/<账本>.xlsx`（含软删账本，每个账本一份全量 Excel）+ `README.txt`。数据库 JSONL 与 Excel 在同一个 PostgreSQL `REPEATABLE READ` 快照里生成，数量 / 大小 / 行数对不上就整份失败、不产出正式 zip。
- **周期策略**：每天 / 每周某几天 / 每月某几号 + 本地时刻 + 保留份数；只有成功才推进游标，失败退避 5 分钟当天继续重试；停机跨过预定日会**补跑一次**（回看至多 31 天，不为每个错过的日子各跑一遍）。
- **恢复**：要求管理员输入**自己的登录密码**二次确认，随后进入全局维护态——先完整读取归档、核对每张表 / 每个附件 / 每份 Excel，全部预检通过后才在一个**可回滚的事务**里执行 `TRUNCATE` + 按外键拓扑恢复 + 改写附件对象键；任一表失败旧数据库原样保留。恢复期间普通请求与 worker 暂停，崩溃遗留的恢复态会自动转失败并退出维护。
- **导入外部归档**：换机器时可直接在网页上传别处拿到的备份（写入走备份目录内的 `.part` 再同盘 rename，避免 GB 级归档跨设备移动失败），同名一律拒绝覆盖。

### 附件
- 客户端 multipart 上传 → API 校验（成员 + 归属 + MIME 白名单 + 20MB 上限）→ 服务端写入 MinIO。
- 下载由 API 鉴权后代理流式返回（不使用预签名 URL）；对象 key 不含原始文件名。
- 删除业务对象联动清理附件，MinIO 删除失败入 `file.delete` job 自动重试。

> 预留能力：`ServiceToken` 鉴权链路（scope / CIDR 白名单 / 代表用户）已建模但暂未接入业务端点，为将来外部系统集成（如 iOS 捷径）预留；应用内 AI Agent走用户自己的 session 鉴权，不经 service token。

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
  worker/   # NestJS Worker（消费 background_jobs：自动记账生成、附件删除重试；扫描到期提醒并推送、执行周期备份）
  web/      # Next.js Web（纯前端交互层，经同源 /api 代理调 API）
packages/
  backend/        # api/worker 共享平台：Prisma 注入、事务、幂等、审计、通知推送、飞书客户端、系统备份、异常过滤、BigInt 序列化
  db/             # Prisma schema + 迁移 + client（55 个模型）
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
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | AI Agent（可选）：三项都配置才启用 |
| `AI_PROTOCOL` | AI 上游协议 `chat`（`/chat/completions`，默认）或 `responses`（OpenAI Responses API）；不填按 `AI_BASE_URL` 末段推断 |
| `SEARCH_PROVIDER` / `SEARCH_API_KEY` / `SEARCH_BASE_URL` | AI 联网搜索（可选）：provider 取 `bocha` / `tavily`（需 key）或 `searxng`（需 base url，零 key、查询不外泄）；`SEARCH_MAX_RESULTS` 默认 5 |
| `BACKUP_DIR` | 系统级备份归档目录（默认 `./data/backups`）；docker 部署映射到宿主机目录，**api 与 worker 必须挂同一个** |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书机器人（可选）：两项都配置才启用，长连接形态无需回调地址 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push 通知（可选）：三项都配置才启用，`pnpm gen:vapid` 生成；subject 须为 `mailto:` 或 `https://`。api 与 worker 都要拿到 |
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
| `pnpm gen:vapid` | 生成 Web Push 的 VAPID 密钥对（一个部署生成一次，之后不要更换） |
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
- **应用锁**：WebAuthn 平台 passkey（Face ID / Touch ID）或登录密码，开关与凭证均在服务端；RP ID 取 `APP_LOCK_RP_ID` 或 `WEB_ORIGIN` 首项 hostname，改动会让已注册凭证全部失效。定位是隐私锁，session token 本身不受影响。
- **AI 联网搜索不开放任意 URL 抓取**：搜索端点只能由部署方经环境变量指定，模型只能决定搜什么词——避免内网部署被 SSRF；返回内容按不可信文本清洗后再进上下文。
- 附件 MIME 白名单（图片 / PDF / Office / 视频），无 SVG / HTML 等可执行类型，上限 20MB。
- DTO 全局 `ValidationPipe`（`whitelist` + `forbidNonWhitelisted`）；CORS 仅放行 `WEB_ORIGIN`。

---

## 🧮 数据模型（55 个模型）

| 分组 | 模型 |
|---|---|
| 身份与系统 | User, AppSetting, Session, AppLockCredential, ServiceToken |
| 账本协作 | Ledger, LedgerMember, LedgerInvite, LedgerJoinRequest |
| 记账配置 | RecordSetting, EntryReminder, Category, Subcategory, Person |
| 账户 | Account, SubAccount, AccountAdjustment, AccountEntry |
| 交易 | Transaction, TransactionAccountRelation, TransactionLink |
| 自动化 | AutoRule, AutoPendingTransaction, QuickTemplate |
| 计划预算 | Plan, PlanPeriod, PlanShareToken, BudgetSetting, CategoryBudget |
| 档案 | Insurance, InsuranceInsuredPerson, InsuranceTypeOrder, ItemType, Item, SubscriptionCategory, Subscription |
| AI Agent | AiConversation, AiMessage |
| 飞书机器人 | FeishuBinding, FeishuChatSession, FeishuBindCode, FeishuEvent |
| 文件 | File, Attachment |
| 提醒推送 | ReminderSchedule, ReminderTarget, PushSubscription, Notification |
| 系统备份 | BackupSetting, BackupRecord, RestoreRecord |
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
| [`docs/NOTIFY_CHANNELS_PLAN.md`](docs/NOTIFY_CHANNELS_PLAN.md) | 推送渠道方案（只选人不选渠道、多档提醒、跨渠道抢占） |
| [`infra/docker/README.md`](infra/docker/README.md) | Docker 部署细节 |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI 协作须知（硬规则 + 指向 PROJECT_GUIDE） |

---

## 📄 License

[MIT](LICENSE) © 2026 BreezeJ
