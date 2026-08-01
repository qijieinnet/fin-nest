# Fin Nest — AI 协作说明

面向 AI 编码助手（Claude Code / Codex 等）的团队级说明。`CLAUDE.md` 通过 `@AGENTS.md` 导入本文件，二者内容一致，只需维护这一份。

## 项目一句话

个人/家庭自部署记账应用（v1 已完成）：`apps/api`（NestJS 11 + Prisma 6/PostgreSQL）、`apps/worker`（后台任务）、`apps/web`（Next.js 16 App Router + Tailwind 4 + TanStack Query）、`packages/*`（共享代码）、MinIO 附件存储。

## 必读

- **项目现状、功能清单、架构与工作流：[`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md)**（权威入口，动手前先读；与代码冲突时以代码为准并更新文档）。

## 硬规则（改代码必须遵守）

1. 金额一律 micros `bigint`（×1,000,000），TS 禁止用 `number` 做金额计算。
2. ledger-scoped 的 service 方法第一行 `assertMember/assertOwner`；查询 where 必带 `ledgerId`。
3. 账户余额只能经 `AccountsService.applyEntry` 变更（内部行锁 + 写 `account_entries`）；编辑/删除交易走反向流水，不物理删旧流水。
4. 统计/预算/计划用有效金额（原始 − 关联合计），账户流水用原始金额。
5. 金额写操作保留 `Idempotency-Key` 支持；财务多表写放在 `DatabaseTransactionService.run` 事务内。
6. 自动记账/快捷模板/AI 不直接写交易表，只生成待确认或调用 `TransactionsService`。
7. 改后端响应结构时，同步更新前端手写契约 `apps/web/src/lib/api/contracts.ts`（无编译期保护，靠自查）。桌面端双 UI 后，改后端响应需同步检查三处：`contracts.ts` + 移动 UI + 桌面 UI。
8. 迁移显式执行（`pnpm db:migrate`），禁止启动时自动迁移；软删/归档优先，有关联数据禁硬删。**新增表会自动进入系统备份**（表清单由 Prisma DMMF 现算）；只有运维台账类的表才登记进 `packages/backend/src/system-backup/table-registry.ts` 的排除名单，并写清理由。
9. 前端弹出选择统一 `PopoverMenu + Menu`、弹层用 `Surface` 风格；允许按需引入 headless 行为库（白名单见 [`docs/DESKTOP_UI_PLAN.md`](docs/DESKTOP_UI_PLAN.md) §2 D3），**禁止**引入 AntD / MUI / Chakra 等带视觉体系的组件库或视觉特效类库。

## 验证

改动后至少跑 `pnpm typecheck`；后端行为改动跑 `pnpm e2e:api`（需本地 DB：`pnpm infra:up && pnpm db:migrate`）。
