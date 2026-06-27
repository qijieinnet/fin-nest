# Fin Nest 后端工程规范

版本：v0.1  
状态：后端编码基线，开始写 Nest.js 项目前必须先遵守  
依据：`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`、`DATABASE_DESIGN.md`

## 1. 接口契约

后端 API 采用 Nest.js REST + OpenAPI。

选择原因：

- REST 对 Web 前端、外部系统和 v1 之后 Dify 等集成都更直观。
- OpenAPI 可以生成前端类型或 API client，减少手写 DTO 跑偏。
- Nest.js 原生支持 Swagger/OpenAPI，适合模块化单体。
- service token、外部系统 scope、文件授权、AI 草稿接口都适合明确的 HTTP API 边界。

规则：

- Controller 必须声明 DTO、响应结构和 OpenAPI 注解。
- 前端类型从 OpenAPI 生成，不靠手写猜字段。
- API URL 使用资源语义，避免把业务动作藏在模糊命名里。
- 关键写操作要支持幂等键或业务唯一约束。
- API 错误结构必须统一，便于前端 Toast、表单错误和日志处理。

错误结构：

```json
{
  "code": "TRANSACTION_ACCOUNT_REQUIRED",
  "message": "账户为必填项",
  "details": {}
}
```

## 2. ORM 与迁移

v1 使用 Prisma 作为主要 ORM 和迁移工具。

选择原则：

- Prisma 与 Nest.js、TypeScript、AI agent 协作都比较稳定。
- Prisma Migrate 负责常规 schema 演进。
- PostgreSQL 特性，例如 `citext`、复杂 partial index、必要 check constraint，可以通过 raw SQL migration 补充。
- 金额字段使用 `BigInt` 映射，应用层不得用 `number` 做精确金额计算。

明确不使用：

- v1 不使用 TypeORM。
- 不把核心业务一致性放进数据库触发器。

Prisma 使用规则：

- Prisma schema 放在 `packages/db`。
- 数据库迁移必须显式执行，不允许 API 和 Worker 启动时并发自动迁移。
- 所有财务写操作必须使用事务。
- 交易、账户流水、可收回/需归还派生变更必须在同一事务内完成。
- 涉及金额计算时，应用层使用 `bigint`、字符串或 Decimal 封装。
- Prisma 无法优雅表达的 PostgreSQL 能力，用 raw SQL migration，但要在迁移文件中写明原因。

## 3. 模块与代码分层

Nest.js 模块保持模块化单体。

分层：

```txt
apps/api/src/modules/
  auth/
  users/
  ledgers/
  transactions/
  accounts/
  categories/
  people/
  record-settings/
  stats/
  plans/
  auto-accounting/
  quick-accounting/
  insurances/
  items/
  files/
  reminders/
  integrations/

packages/db/
packages/shared/
packages/config/
```

Controller：

- 只处理 HTTP 入参、鉴权上下文、响应格式。
- 不写财务规则。

Service：

- 承载业务编排。
- 处理权限校验、事务边界、跨模块调用。

Repository 或 Prisma Access Layer：

- 封装复杂查询。
- 不承载业务决策。

DTO：

- 入参必须校验。
- 响应结构要稳定。
- 与 OpenAPI 保持同步。

## 4. 初始化数据

首次启动注册的第一个用户自动成为系统管理员。

第一个用户注册成功后，系统自动创建：

- 默认账本。
- 该用户在默认账本中的 owner membership。
- 默认记账设置。
- 默认人员“我”。
- 基础收入分类和支出分类。

不自动创建：

- 默认账户。

原因：

- 账户默认非必填，用户可以先记账再逐步维护账户。
- 账户类型、余额和是否计入净资产比较个人化，自动创建容易产生误导。

新建任何账本时，系统自动创建：

- 默认记账设置。
- 默认人员“我”。
- 基础收入分类和支出分类。

初始化必须幂等：

- 重试不会创建重复默认人员。
- 重试不会创建重复默认分类。
- 重试不会创建重复 record settings。

## 5. 导入导出边界

v1 不做导入导出。

v1 排除内容：

- CSV/Excel 导入。
- CSV/Excel/PDF 导出。
- 附件打包导出。
- 备份恢复。
- 导出文件生成任务。

v1 边界：

- 数据模型和服务边界不得阻碍 v1 之后导入导出。
- Worker 架构可以保留，但 v1 不实现导入导出任务。
- MinIO 作为 v1 之后导出文件存储，但当前不围绕导出开发功能。

## 6. 提醒与红点计数

v1 不做站内提醒中心。

提醒只体现在菜单入口的红色圆圈数字上：

- “更多”主 Tab 展示所有二级入口提醒数量的合计。
- 更多页中的功能入口展示各自提醒数量。
- 数字为 0 时不显示红点。
- 数字过大时可显示 `99+`。

第一批可计数来源：

- 自动记账待确认数量。
- 账本加入申请待审批数量。
- 保险即将续费或即将到期数量。
- 计划超支或异常数量。

规则：

- 红点计数是读模型，不是独立消息事实。
- 不保存“已读/未读提醒”状态。
- 不做站内消息列表。
- 不做推送、邮件、短信。
- 后端提供统一 summary endpoint；前端不得自行聚合多个模块的 count endpoint。

接口：

```txt
GET /ledgers/:ledgerId/reminder-summary
```

响应示意：

```json
{
  "total": 5,
  "items": {
    "autoPending": 2,
    "joinRequests": 1,
    "insurance": 1,
    "plans": 1
  }
}
```

## 7. 禁止事项

- 不使用 GraphQL/tRPC 作为 v1 主接口契约。
- 不使用 TypeORM。
- 不在 Controller 里写财务业务规则。
- 不让 API 和 Worker 并发自动执行迁移。
- 不在 v1 实现导入导出。
- 不做站内提醒中心或已读未读消息系统。
- 不用数据库触发器承载核心交易和账户一致性。
