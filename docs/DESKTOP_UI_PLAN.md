# 桌面端（PC）UI 改造方案与执行流程

> 本文档是桌面端改造的**权威任务书**，供多个 AI 智能体分工执行。
> 每个执行者动手前必读：`AGENTS.md` → `docs/PROJECT_GUIDE.md` → 本文档全文 → 自己认领的工作包（WP）章节。
> 状态维护在 §6 任务看板；完成一个 WP 必须更新看板并满足该 WP 的验收标准。

---

## 1. 背景与目标

现状：移动端优先 PWA，PC 上仅以 430px 容器居中展示（`MobileAppShell`，`--space-app-width`）。

目标终态：

- **一棵路由树，页面级双实现**：4 个高频核心页（bills / accounts / stats / budget）提供独立桌面版式（主从布局、表格化、宽屏网格）；`more/*` 等长尾页走「自适应兜底」（单列限宽 + 弹层转 Modal），不做双实现。
- **逻辑与 UI 分离**：数据层（`lib/data`、`lib/api`、`lib/money`、providers）已可复用；补齐缺口——把 Screen/表单组件内联的交互状态与 mutation 抽成 headless「视图模型 hook」，双端 UI 共享。
- **视觉同源**：桌面 UI 沿用现有 CSS 变量 token 与 `Surface` 视觉语言；引入 headless 行为库（见 §2 决策 D3），**不引入** Ant Design / MUI 等带视觉体系的组件库。

非目标（明确不做）：

- 不做 Electron/Tauri 客户端；不改后端 API；不新增路由段（如 `/desktop/*`）。
- 不重写移动端：移动端行为**零回归**是全程红线。
- 不动 `globals.css` 既有规则：桌面样式只做增量（新 class / `@media (min-width: 1024px)` 段 / Tailwind `lg:` 变体）。

## 2. 已定技术决策（执行者不要重新讨论）

| # | 决策 | 说明 |
|---|---|---|
| D1 | 断点 1024px | `lg`。≥1024 桌面壳，<1024 维持现有移动壳。结构分支用 `useIsDesktop()`（matchMedia）；SSR/首帧渲染移动壳，挂载后切换（页面数据本就是客户端加载、有 loading 态，闪烁可接受）。纯样式差异优先用 CSS 变体而非 JS 分支。 |
| D2 | 页面级双实现，仅限 4 个核心页 | `page.tsx` 按 `useIsDesktop` 选择 `XxxScreen`（现有移动版）或 `XxxScreen.desktop.tsx`。其余页面单实现。 |
| D3 | headless 行为库白名单 | 允许：`@tanstack/react-table`（表格）、`@radix-ui/react-dialog`（桌面 Modal 的焦点圈禁/Esc）、`react-day-picker`（桌面日历面板）。按需引入，能用现有 `SheetShell`/`PopoverMenu` 满足的不引。禁止：AntD、MUI、Chakra 等带视觉的库（AGENTS.md 规则 9 的延伸，WP-A4 会更新该规则表述）。**A3 落地备注**：本机 `node_modules` 由 pnpm 11（store v11）安装，与仓库 `packageManager` 固定的 pnpm 10（store v10）store 格式不兼容，`pnpm add` 无法在不整体重装的情况下写入依赖；故桌面弹层的焦点圈禁/Esc/aria 由自建 `components/desktop/DesktopDialog.tsx`（复用已装的 framer-motion）实现，未引入 radix。后续如需 `react-day-picker`（B5）等新依赖，需先由维护者统一 `pnpm install` 对齐 pnpm 版本再安装。 |
| D4 | 弹层底座统一分支 | 在 `SheetShell` 一处做桌面分支：桌面默认渲染居中 Modal，可选右侧 Drawer（`desktopVariant` prop）。40+ 个业务 `*Sheet` 组件不改自身代码即获得桌面形态。`SheetStackProvider` 的浏览器返回映射保留，桌面补 Esc 关闭。 |
| D5 | 视图模型 hook 规范 | 命名 `useXxxModel`，与页面同目录（`_model/` 或就近）。运行时依赖仅 `lib/*`、providers、React——**运行时不得引入任何 React 组件、不含 JSX**；返回 `{ state..., actions..., options..., mutationState }`，可被 vitest 直接测。落地判定：曾放在 `components/*` 的**运行时常量**（如筛选默认值 `defaultFilterValue`）须迁至 `lib/*`（已迁 `lib/data/filter-types.ts`，`components/business` 处保留再导出兼容旧引用），避免模型经 barrel 拉入组件；纯展示工具（如 `insuranceTypeMeta`/`typeGlyph`，仅依赖 `lib/*`、零组件依赖）与 `import type` 的组件 prop 类型（编译期擦除、不进运行时图）可接受。 |
| D6 | 桌面专属组件放 `components/desktop/` | `DesktopShell`、`DesktopSidebar`、`Modal`、`Drawer`、`DataTable`、`DesktopDatePicker`、`FormSelect` 等。移动组件目录不动。 |
| D7 | 金额/契约红线不变 | 金额仍走 `lib/money`（micros bigint），禁止 `number` 计算；不改 `contracts.ts`（本次改造不涉及后端）。 |

## 3. 架构约定（目录与代码形态）

```txt
apps/web/src/
  components/
    ui/                 # 既有移动原语（SheetShell 增加桌面分支，其余不动行为）
    desktop/            # 新增：桌面壳与桌面控件（D6）
    business/           # 双端共享的业务展示组件（尽量保持双端可用）
  app/bills/
    page.tsx                    # 断点分发
    BillsScreen.tsx             # 移动版（现有，重构后只剩渲染）
    BillsScreen.desktop.tsx     # 桌面版（新增）
    _model/useBillsModel.ts     # 共享视图模型（新增）
    _components/
      TransactionForm.tsx               # 移动渲染层（瘦身后）
      TransactionForm.desktop.tsx       # 桌面渲染层（WP-B5）
      _model/useTransactionFormModel.ts # 共享表单视图模型（WP-A1）
```

视图模型抽取的行为等价验证方法（所有抽取类 WP 通用）：先抽 hook → 移动端组件接上新 hook → 手动过一遍该页面全部交互路径 → 确认无行为差异后才算完成。禁止「抽取顺便改行为/改样式」。

## 4. 工作包（WP）分解

依赖关系总览：

```txt
Phase A（地基，先行）        Phase B（核心页，可 4-5 个执行者并行）   Phase C（长尾与打磨）
A1 表单视图模型 ─────┬────→ B5 桌面表单控件+TransactionForm.desktop ─→ C2/C3
A2 核心页视图模型 ───┼────→ B1 bills / B2 accounts / B3 stats / B4 budget
A3 桌面壳与弹层底座 ─┘        （B1 依赖 A2+A3+B5；B2-B4 依赖 A2+A3）
A4 文档与规则更新（随 A3 一起）                                    C1/C2/C3/C4（依赖 B 完成）
```

---

### WP-A1：抽取交易表单视图模型（工作量最大，优先启动）

- **目标**：把 `app/bills/_components/TransactionForm.tsx`（约 1066 行，30+ `useState` + 内联 `useMutation`）拆为 `useTransactionFormModel` + 纯渲染组件。
- **涉及文件**：`TransactionForm.tsx`（改）、新增 `_model/useTransactionFormModel.ts`、纯函数可放 `_model/transaction-form-utils.ts`。
- **任务**：
  1. 将全部字段状态（type/amount/occurredOn/category/person/account/from/to/note/各 enabled 开关/关联项/附件/保险/物品）、派生 options（`catOptions` 等 useMemo）、`validationMessage`、`buildPayload`/`buildPendingPatch`/`buildRelations`、提交 mutation、`resetForContinuousEntry`、附件增删迁入 hook。
  2. `TransactionForm.tsx` 只保留 JSX 与事件绑定，目标 <450 行。
  3. `buildPayload`/`buildRelations`/`splitInitialRelations` 等纯函数补 vitest 单测（金额边界：0、负、超关联合计）。
- **验收**：`pnpm typecheck`、`pnpm --filter @fin-nest/web test` 通过；手动回归新建/编辑/待确认编辑/连续记账/附件/保险物品关联全路径，行为与改造前一致；hook 文件无组件 import。
- **禁止**：改任何 UI 样式或交互行为；改后端调用方式。

### WP-A2：抽取四个核心页的视图模型

- **目标**：为桌面版复用做准备，把页面级逻辑抽为 `useBillsModel` / `useAccountsModel` / `useStatsModel` / `useBudgetModel`。
- **涉及文件**：`app/bills/BillsScreen.tsx`（筛选状态、`billsFilterCache`、删除 mutation、分组派生）、`app/accounts/AccountsScreen.tsx` 及详情屏、`app/stats/StatsScreen.tsx`、`app/budget/PlansScreen.tsx`；各页新增 `_model/`。
- **任务**：状态/派生/mutation 迁入 hook，UI 弹层开关类状态（如 `filterOpen`）可留在组件；`bill-utils.ts` 等纯函数保持原位被 hook 引用。
- **验收**：同 A1（typecheck + 各页全交互手动回归零差异）。四个页面可由不同执行者并行，互不依赖。

### WP-A3：桌面壳、断点与弹层底座（B 阶段的总闸门）

- **目标**：≥1024px 出现桌面外壳与侧边栏；全站弹层在桌面自动变 Modal。
- **涉及文件**：新增 `components/desktop/DesktopShell.tsx`、`DesktopSidebar.tsx`、`lib/hooks/useIsDesktop.ts`（或 `components/ui` 内）、`components/desktop/Modal.tsx`、`Drawer.tsx`；改 `components/ui/SheetShell.tsx`（分支）、`providers/SheetStackProvider.tsx`（Esc）；`globals.css` 追加桌面段。
- **任务**：
  1. `useIsDesktop()`：matchMedia + 挂载后生效（D1）。
  2. `DesktopShell`：左侧固定侧边栏（宽约 240px，导航项与 `MobileTabBar` 一致：账单/账户/统计/预算/更多；「更多」直接展开二级项，含红点 `DotBadge`），内容区单列限宽约 720px 居中（B 阶段各页可自行放宽）。`MobileAppShell` 在桌面断点由 `DesktopShell` 替代——建议在各 Screen 外提一层公共 shell 分发，避免逐页改；`MobilePage` 的 `pb-[tab-bar-height]` 在桌面归零。
  3. `SheetShell` 桌面分支：默认居中 Modal（基于 `@radix-ui/react-dialog` 获得焦点圈禁 + Esc + aria，面板视觉仍用 `Surface`），`desktopVariant="drawer"` 时右侧滑出（宽约 480px）。移动路径代码零改动。
  4. 桌面 hover/focus-visible 基线：为 `Button`、`Menu`、`IconButton`、`TransactionRow` 等追加 `@media (hover: hover)` 下的 hover 态与 focus-visible 环。
- **验收**：桌面断点下登录后 5 个一级导航可用、任意页面打开任意 Sheet 呈现为居中 Modal 且 Esc 可关；<1024px 与改造前逐像素一致（重点回归 iOS Safari 视口）；typecheck 通过。
- **依赖**：无（可与 A1/A2 并行）。

### WP-A4：规则与文档更新（小，随 A3 提交）

- 更新 `AGENTS.md` 规则 9：表述为「弹出选择统一 PopoverMenu + Menu、弹层 Surface 风格；**允许 headless 行为库（白名单见 docs/DESKTOP_UI_PLAN.md §2 D3），禁止带视觉体系的组件库**」。
- `docs/PROJECT_GUIDE.md`：§1 的「PC 居中展示移动容器」改为指向本方案的双形态描述；§9 文档地图加本文件一行。
- `AGENTS.md` 硬规则 7 后追加提醒：双 UI 后改后端响应需同步检查 contracts.ts + 移动 UI + 桌面 UI 三处。

---

### WP-B5：桌面表单控件与 TransactionForm 桌面版（B1 的前置）

- **目标**：桌面端表单从「点行弹选」换成直接可见控件；产出桌面版交易表单。
- **涉及文件**：新增 `components/desktop/FormSelect.tsx`（锚定下拉，基于现有 `PopoverMenu` 行为，支持键盘上下/回车/输入过滤）、`DesktopDatePicker.tsx`（`react-day-picker` 日历面板替代滚轮）、`TransactionForm.desktop.tsx`（消费 A1 的 `useTransactionFormModel`）。
- **任务**：桌面表单为两列版式（金额+类型置顶，分类/账户/人员/日期为可见控件，备注/关联/附件折叠区），Tab 键可顺序遍历，Enter 提交（textarea 除外）。
- **验收**：桌面断点新建/编辑交易全路径可用，键盘可完成一笔支出录入（不碰鼠标）；金额输入仍走 `lib/money`；移动端表单不受影响。
- **依赖**：A1、A3。

### WP-B1：bills 桌面版（主从布局 + 表格 + 快速记账）

- **涉及文件**：`app/bills/page.tsx`（断点分发）、新增 `BillsScreen.desktop.tsx`、`components/desktop/DataTable.tsx`（`@tanstack/react-table` 封装，金额列右对齐 `MoneyText`）。
- **任务**：
  1. 左侧交易表格（列：日期/分类/备注/人员/账户/金额；沿用 `useInfiniteTransactions` 无限滚动；顶部沿用 `FilterBar` 逻辑但控件横排展开）+ 右侧详情面板（点行原地展示，替代跳 `/bills/[id]`；详情内编辑用 Modal 打开桌面表单）。URL 同步 `?tx=<id>` 以支持刷新/分享，但不做整页跳转。
  2. 顶部常驻「记一笔」按钮 + 全局快捷键 `N` 呼出快速记账 Modal（B5 的表单）。
  3. 汇总卡片/预算进度移至右栏或顶部横条。
- **验收**：桌面断点列表-详情-编辑-删除-筛选-待确认入口全可用；移动端 `/bills` 全部路径不变；typecheck 通过。
- **依赖**：A2、A3、B5。

### WP-B2：accounts 桌面版

- **任务**：左列账户列表（含净资产卡）+ 右侧选中账户详情（子账户、流水表格化、余额调整 Modal）；账户/子账户拖拽排序在鼠标下验证可用（`useDragSort` 若仅 touch 事件则补 pointer 支持）。
- **验收**：账户全操作（增改、调整余额、归档、排序、子账户）桌面可用，移动端不变。
- **依赖**：A2、A3。

### WP-B3：stats 桌面版

- **任务**：图表卡片 2 列 dashboard 网格（趋势/分类环图/人员排行/净资产/现金流）；分类下钻在桌面用右侧 Drawer（`desktopVariant="drawer"`）而非整页 Sheet；月份选择用 `DesktopDatePicker` 的月模式或横向月份条。
- **验收**：宽屏无横向滚动、图表随容器自适应；移动端不变。
- **依赖**：A2、A3（月选择器如复用 B5 控件则加依赖 B5）。

### WP-B4：budget 桌面版

- **任务**：计划/预算卡片网格化（2-3 列）；计划详情与编辑走 Modal/Drawer；进度条与超限红点保持现有组件。
- **验收**：计划 CRUD、停止/恢复、历史周期、预算设置桌面可用；移动端不变。
- **依赖**：A2、A3。

---

### WP-C1：长尾页自适应验收（`more/*`、ledgers、登录注册、账单子页）

- **任务**：逐页在桌面断点走查（A3 的 Modal 化已自动覆盖弹层）：单列限宽是否成立、有无溢出/错位、导入预览等宽内容加 `overflow-x` 容器；登录/注册页居中卡片化。产出问题清单并修复。
- **验收**：附走查记录（页面 × 通过/修复项）；移动端不变。
- **依赖**：A3（不必等 B）。

### WP-C2：桌面交互打磨（键盘与悬停）

- **任务**：`SwipeActionRow` 在 `(hover: hover)` 设备 hover 显示操作按钮（滑动保留给触屏）；全局快捷键（`N` 记一笔、`/` 聚焦筛选、Esc 逐级关弹层——与 `SheetStackProvider` 栈联动）；`DateWheelPicker`/`MonthWheelPicker` 桌面替换收口（确认无残留调用点）。
- **依赖**：B1-B5。

### WP-C3：移动端回归与双端验证

- **任务**：两断点全站走查清单化执行（每页 × 移动/桌面）；`pnpm typecheck`、`pnpm lint`、`pnpm --filter @fin-nest/web test`、`pnpm e2e:api`（确认后端未被波及）；重点：iOS Safari 视口、PWA 安装态、`SheetStackProvider` 返回键行为。
- **依赖**：全部 B + C1/C2。

## 5. 执行流程与协作规则（多智能体）

1. **认领**：按 §6 看板认领 WP，状态改为 `进行中` 并署名（会话/分支名）。同一 WP 不并发。
2. **分支**：每 WP 一个分支，命名 `desktop/<wp-id>-<slug>`（如 `desktop/a1-transaction-form-model`）。基于最新 `main`；B 阶段分支必须包含已合并的 A 阶段成果。
3. **顺序门**：A1/A2/A3 可并行；**任何 B 包开工前 A3 必须已合并**，B1 另需 B5；C 阶段在对应依赖合并后开工。
4. **每包收尾必做**：跑 `pnpm typecheck` + `pnpm --filter @fin-nest/web test`；按该 WP 验收标准自查并在看板记录结果；涉及 UI 的用浏览器在 375px 与 1280px 两档各截图验证。
5. **红线**（违反即返工）：
   - 移动端（<1024px）任何行为/样式变化都算回归，除非 WP 明确要求；
   - 不改 `contracts.ts`、不改后端、不绕过 `lib/money`；
   - `globals.css` 只增不改（改既有 selector 需在 PR 说明里单独列出理由）；
   - 不引入 D3 白名单外的 UI 依赖。
6. **冲突面控制**：`globals.css` 桌面样式统一追加到文件末尾的 `/* ===== desktop ===== */` 区块并按 WP 注释分段；`components/ui/index.ts`、`components/desktop/index.ts` 导出按字母序插入，降低并行冲突。
7. **提交**：commit message 前缀 `feat(desktop): <WP-id> ...`；PR 描述附验收自查清单。

## 6. 任务看板（执行者自行更新）

| WP | 内容 | 依赖 | 状态 | 认领 | 备注 |
|---|---|---|---|---|---|
| A1 | 交易表单视图模型抽取 | – | 已完成 | pc-ui | TransactionForm 1066→~290 行；`_model/useTransactionFormModel.ts`（无 JSX）+ `transaction-form-utils.ts`（16 项 vitest） |
| A2 | 四核心页视图模型抽取 | – | 已完成 | pc-ui | useBillsModel/useAccountsModel/useStatsModel/useBudgetModel + 账户详情/子账户详情模型（useAccountDetailModel/useSubAccountDetailModel）；筛选默认值迁 `lib/data/filter-types`（D5）；UI 弹层开关留在组件 |
| A3 | 桌面壳/断点/弹层底座 | – | 已完成 | pc-ui | B 阶段总闸门。弹层焦点圈禁改用自建 DesktopDialog（见 §2 D3 备注），未引入 radix；嵌套弹层用弹层栈保证一次 Esc 只关栈顶 |
| A4 | AGENTS/GUIDE 文档更新 | 随 A3 | 已完成 | pc-ui | |
| B5 | 桌面表单控件 + 交易表单桌面版 | A1, A3 | 待认领 | | |
| B1 | bills 桌面主从布局 | A2, A3, B5 | 待认领 | | |
| B2 | accounts 桌面版 | A2, A3 | 待认领 | | |
| B3 | stats 桌面版 | A2, A3 | 待认领 | | |
| B4 | budget 桌面版 | A2, A3 | 待认领 | | |
| C1 | 长尾页自适应走查 | A3 | 待认领 | | 可与 B 并行 |
| C2 | 键盘/悬停打磨 | B1-B5 | 待认领 | | |
| C3 | 双端回归验证 | 全部 | 待认领 | | |

## 7. 风险与应对

| 风险 | 应对 |
|---|---|
| 视图模型抽取引入行为回归 | §3 的「先抽取、移动端先接线、全路径手动回归」流程；纯函数补单测 |
| SSR 首帧移动壳 → 桌面切换闪烁 | 页面本有 loading 态，可接受；若明显，允许对壳层（仅壳层）用 CSS 双渲染优化 |
| `globals.css` 并行冲突 | §5.6 追加区块约定 |
| Radix Dialog 与现有 `SheetStackProvider` 栈冲突 | A3 中 Modal 的开关仍由业务层受控（`open`/`onClose`），Radix 仅托管焦点与 Esc；返回键映射逻辑不动 |
| 双 UI 后契约漏改面变宽 | A4 在 AGENTS.md 固化三处检查提醒 |
