# Fin Nest — AI 协作说明

面向 AI 编码助手（Claude Code / Codex 等）的团队级说明。`CLAUDE.md` 通过 `@AGENTS.md` 导入本文件，二者内容一致，只需维护这一份。

这是一个 monorepo 记账应用：`apps/api`（NestJS + Prisma）、`apps/web`（Next.js App Router）、`packages/*`（共享代码）。

改代码前先读对应领域的工程文档：

- 前端：`docs/architecture/FRONTEND_ENGINEERING.md`、`docs/architecture/FRONTEND_DESIGN.md`
- 后端：`docs/architecture/BACKEND_ENGINEERING.md`
- 数据库：`docs/architecture/DATABASE_DESIGN.md`
- 测试：`docs/architecture/TESTING_STRATEGY.md`

## 前端 UI 约定（团队级，务必遵守）

### 弹出菜单 / 表单选值：统一用 PopoverMenu + Menu

弹出式菜单（导航「更多」菜单、下拉、表单里的选项选择等）统一使用：

- `apps/web/src/components/ui/PopoverMenu.tsx` — 锚定弹层（透明背板点击关闭 + 锚点下方弹出），放在 `position: relative` 的父容器内使用。
- `apps/web/src/components/ui/Menu.tsx` — iOS 上下文菜单风格的列表面板。

`MenuItem` 支持：`icon`、`description`（副标题）、`danger`（红色危险项）、`disabled`、`selected`（右侧对勾，用于表单选值）、`items`（二级菜单，自带返回行）。`groups` 用二维数组表示分组，组间显示粗分隔条。样式在 `globals.css` 的 `.ui-menu*` / `.ui-popover-menu*`。

不要在页面里手写 backdrop + 绝对定位的下拉菜单。表单选值也用这套，不要再造 Picker 弹层。参考用法见 `apps/web/src/app/bills/BillsScreen.tsx` 头部「更多」菜单，规范见 `FRONTEND_ENGINEERING.md` §11。

### 液态玻璃（Liquid Glass）已废弃

项目曾用 iOS「液态玻璃」风格封装弹层（`liquid-glass.tsx`），但已在「去掉玻璃」提交中移除，`components/glass` / `liquid-glass-react` 已不存在。**不要恢复或新增玻璃组件。** 弹层、菜单、浮层统一用实心表面 + 柔和阴影：复用 `Surface`（`variant="menu" | "sheet"` 等，样式在 `globals.css` 的 `.ui-surface--*`）、`Menu`、`BottomSheet`，阴影用 `--shadow-soft`。
