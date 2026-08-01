# 桌面端改造 — 双端走查清单（WP-C3）

> 配套 [`DESKTOP_UI_PLAN.md`](DESKTOP_UI_PLAN.md)。逐页在两个断点（移动 <1024px / 桌面 ≥1024px）走查。
> 图例：✅ 已验证 · 🟡 仅编译/构建级验证（需本机后端补真实数据走查）· ⛔ 阻塞。

## 环境说明

- 本机 **Docker 不可用** → 起不了 postgres/minio → 无法登录 → 数据驱动页面无法做真实数据下的视觉/交互走查。
- 本机 **pnpm store 版本不匹配**（node_modules 由 pnpm 11 装，仓库固定 pnpm 10）→ 无法 `pnpm add` 新依赖，故 radix / react-day-picker / @tanstack/react-table 均以自建实现替代（见 PLAN §2 D3）。
- 已完成的自动化验证：`pnpm typecheck` ✅、`pnpm lint`（仅 5 条既有告警，0 error）✅、`pnpm --filter @fin-nest/web test`（33 通过；2 个失败为既有 `parse-money` 用例，与本次无关）✅、`pnpm --filter @fin-nest/web build`（27 页构建成功，4 个核心页静态预渲染通过）✅。
- 待后端可用后补：`pnpm e2e:api`、各数据驱动页面的真实数据视觉/交互回归、iOS Safari 视口、PWA 安装态。

## 一级页面（双实现）

| 页面 | 移动 <1024 | 桌面 ≥1024 | 备注 |
|---|---|---|---|
| bills 账单 | ✅ 构建保留原实现 | 🟡 主从表格+详情、?tx 同步、记一笔 Modal + N 快捷键、/ 开筛选、汇总条含预算进度 | 桌面表格自建 |
| accounts 账户 | ✅ | 🟡 左列表+右详情，账户分类内拖拽排序（pointer/鼠标可用），子账户/余额调整 Modal | 复用 useAccountDetailModel；子账户排序仍走移动详情页（次要） |
| stats 统计 | ✅ | 🟡 2 列 dashboard，分类下钻右侧 Drawer | — |
| budget 计划 | ✅ | 🟡 卡片网格，详情/编辑 Modal | — |
| 交易表单（新建/编辑/待确认/连续记账） | ✅ 原实现整体平移 | 🟡 桌面两列版式；FormSelect/DesktopDatePicker **控件已浏览器实测** ✅ | 共享 A1 模型 |

## 断点分发与壳层

| 项 | 状态 | 备注 |
|---|---|---|
| useIsDesktop 断点分发（首帧移动壳，挂载后切换） | ✅ | — |
| DesktopShell 侧边栏 5 项导航 + 「更多」二级项 | ✅ 浏览器实测 | 登录页桌面壳截图确认 |
| 弹层桌面 Modal 化 / 右侧 Drawer | 🟡 | SheetShell 分支 + SheetStack desktopVariant；Esc 仅关栈顶 ✅（单测式逻辑 + 冒泡阶段） |
| FormSelect 过滤/键盘、DesktopDatePicker 日历 | ✅ 浏览器实测 | 过滤、↑↓/Enter、日历网格、月切换均通过 |

## 长尾页（自适应兜底，WP-C1）

| 页面 | 状态 | 备注 |
|---|---|---|
| 登录 / 注册 | ✅ 浏览器实测 | 桌面全屏渐变 + 居中卡片、**无 app 侧边栏**；移动版不变 |
| more/* 各页 | 🟡 | 单列限宽（DesktopShell 内容区 720）+ 弹层 Modal 化（A3 自动覆盖）；需登录走查错位/溢出 |
| ledgers / ledgers/join | 🟡 | 同上 |
| 账单子页（详情/编辑/待确认） | 🟡 | 详情/编辑在桌面直接路由访问时走单列 + Modal；SwipeActionRow 桌面与移动端一致（拖拽露出，不 hover 显操作） |
| 导入预览等宽内容 overflow-x 容器 | ✅ 代码 | 桌面 Modal 内 `.import-preview-sheet__scroll` 已加 `overflow-x: auto`；真实数据下再核对 |

## 交互打磨（WP-C2）

| 项 | 状态 | 备注 |
|---|---|---|
| ~~SwipeActionRow `(hover:hover)` hover 显操作~~ | ⛔ 已回退 | 与移动端口径不一致，改为「横向拖拽才露出」（鼠标可拖），`desktopClickable` 特例一并移除；主桌面面（bills 表/accounts 面板）本就是可见按钮，不受影响 |
| 全局 N 记一笔 / `/` 开筛选（输入态与弹层时忽略） | 🟡 | 逻辑就绪，待登录走查 |
| Esc 逐级关弹层（与栈联动） | ✅ 逻辑 | DesktopDialog dialogStack 仅栈顶响应；FormSelect Esc stopPropagation 只关下拉 |
| DateWheelPicker/MonthWheelPicker 桌面替换 | ✅ 代码 | `DateWheelPicker` 已在桌面断点自动分支为 `DesktopDatePicker`（label 保留）→ 7 个共享编辑弹层一处收口全覆盖；`MonthWheelPicker` 本就是原生 `<input type=month>`，鼠标可用无需改 |

## 移动端零回归红线（WP-C3）

| 项 | 状态 | 备注 |
|---|---|---|
| `.mobile.tsx` 为原实现整体平移（仅导出改名） | ✅ | 未改 JSX/样式 |
| 分发器首帧渲染移动版 | ✅ | useIsDesktop 初值 false |
| 桌面样式只增量（globals.css `/* ===== desktop ===== */` 段） | ✅ | 未改既有 selector（filter-types 迁移为再导出，行为等价） |
| 真实移动设备不触发桌面 hover 段 | ✅ 设计 | `(hover:hover)` 媒体查询 |
| iOS Safari 视口 / PWA 安装态 | 🟡 待补 | 需真机/后端 |
