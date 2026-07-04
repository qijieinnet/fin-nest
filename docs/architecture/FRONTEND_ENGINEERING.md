# Fin Nest 前端工程规范

版本：v0.3
状态：前端编码基线，改前端代码前必须先遵守
依据：`FRONTEND_DESIGN.md`、`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`

> v0.3 变更：项目已移除 Liquid Glass（“去掉玻璃”提交），`components/glass` / `liquid-glass-react` 不再存在；页面组织从设想的 `features/*` 改为 Next.js App Router 的 `app/<域>/` 就近组织；`/__dev/ui` 样板页尚未落地。本版按当前真实代码结构重写，删除了已不适用的规则。

## 1. 目标

约束 AI agent 和开发者写前端代码的方式，重点解决：

- 不重复造相似组件。
- 不把业务规则、数据请求写散到页面。
- 不让页面直接 `fetch`、直接拼 API URL、直接算金额 micros。
- 关键信息（金额、日期、分类、账户）始终清晰可读，视觉效果不压过可读性。

## 2. 目录结构（当前真实结构）

```txt
apps/web/src/
  app/                      # Next.js App Router：路由 + 页面装配
    bills/
      page.tsx              # 极薄 route 包装
      BillsScreen.tsx       # 页面组合
      [transactionId]/      # 动态路由段
      _components/          # 该域私有组件、工具（下划线前缀不进路由）
    accounts/ budget/ stats/ ledgers/ more/ login/ register/
    layout.tsx  globals.css  manifest.ts
  components/
    ui/                     # 无业务语义的基础组件
    business/               # 跨模块复用的业务组件
    app/                    # 应用级壳/占位（如 ComingSoonScreen）
    auth/                   # 鉴权门禁（AuthGate、RequireLedger）
  lib/
    api/                    # client、endpoints、错误、契约类型
    data/                   # records.ts：所有查询 hooks；options.ts：选项映射
    query/                  # query-keys.ts：统一查询 key
    money/ format/ route/ config/ id/ generated/
  providers/                # 全局 provider（Query/Auth/Ledger/Toast/SheetStack/Preferences）
```

共享代码在 monorepo 的 `packages/`：`backend`、`db`、`shared`、`config`、`eslint-config`、`tsconfig`。

目录职责：

- `app`：路由、layout、page，以及就近的 `XxxScreen.tsx` 页面组合与 `_components/` 私有件。
- `components/ui`：无业务语义的基础组件（Button、IconButton、Input、Sheet、Menu、PopoverMenu、Switch、Tabs…）。
- `components/business`：知道业务语义、但不拥有业务事实的组件（FilterSheet、AmountInput、CategoryPicker、AccountPicker、TransactionRow、SwipeActionRow…）。
- `lib/api`：请求封装、路径拼接、错误结构、后端契约类型。
- `lib/data/records.ts`：集中定义 `useXxx` 查询 hooks。
- `lib/query/query-keys.ts`：集中定义查询 key。
- `lib/money`：金额解析、格式化、micros 转换。
- `providers`：QueryClient、Auth、Ledger、Toast、SheetStack、Preferences。

## 3. 路由与页面职责

`app/<域>/page.tsx` 只做极薄包装（读路由参数、套鉴权门禁、渲染 Screen）：

```tsx
export default function BillsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <BillsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
```

`XxxScreen.tsx` 负责页面组合：

- 调用 `lib/data` 的查询 hooks 取数据。
- 组合布局和组件。
- 处理页面级 loading / empty / error。
- 用 `useMutation` + `lib/api` 的 `apiRequest` 发起写操作，成功后失效相关查询。

页面/Screen 禁止：

- 直接 `fetch` 或手拼 API URL（用 `apiRequest` + `ledgerApiPath` 等）。
- 直接算金额 micros。
- 直接手写复杂表单控件、筛选、日期选择、分类/账户选择（用 business 组件）。
- 手写 backdrop + 绝对定位的下拉菜单（用 `PopoverMenu`，见 §11）。

## 4. 组件分层

- **基础 UI（`components/ui`）**：不知道账本、交易、账户等概念。
- **业务组件（`components/business`）**：知道业务语义，接收 `data / value / onChange / loading / disabled`，不直接决定权限和财务规则。
- **域内组件（`app/<域>/_components`）**：组合业务组件、hooks、mutation，可有域专属 UI，但不得复制已有通用组件。

新增通用交互优先做成 `components/ui` 或 `components/business` 组件，不在页面内私有实现。

## 5. 命名规范

- React 组件：`PascalCase.tsx`。
- hooks：`useSomething`（查询 hooks 集中写在 `lib/data/records.ts`）。
- 工具函数文件：`kebab-case.ts`（如 `bill-utils.ts`）。
- `Page` 只用于 route 文件的极薄包装；`Screen` 用于完整页面组合；`Sheet` 用于底部弹层；`Picker` 用于选择器；`Row` 用于列表行；`Card` 只用于真正独立卡片。
- 不使用 `CommonPanel2`、`NewCard`、`NiceButton` 这类无语义名字。

## 6. API Client 与请求

统一通过 `lib/api` 访问后端，页面和组件不得直接 `fetch`。

- 请求走 `apiRequest`，路径用 `ledgerApiPath(ledgerId, path)` / `ledgerMembersPath` 等拼接，不手写字符串 URL。
- session 走 HttpOnly Cookie，请求需带 `credentials`。
- API 错误转成统一错误类型，用 `getApiErrorMessage` 取文案，配合 Toast 或字段错误展示。
- 文件上传先向 API 取签名 URL / 上传凭证，再传对象存储，不直接暴露 object key。
- **契约类型**：当前手写在 `lib/api/contracts.ts`（镜像后端 service 返回结构）。OpenAPI 生成管线（`lib/generated/api-types.ts`）尚为占位，可用后再迁移；在此之前改接口字段要同步 `contracts.ts`。

## 7. Query 与缓存

Server State 用 TanStack Query，查询 key 集中在 `lib/query/query-keys.ts`。

- 查询 key 必须包含 `ledgerId`，账本切换后不得复用上个账本的结果。
- 查询 hooks 集中写在 `lib/data/records.ts`；mutation 就近写在 Screen / Sheet 组件里。
- 创建/编辑/删除交易后，必须失效交易列表、账户、预算、统计等相关查询。
- 编辑账户余额后，失效账户列表、详情、流水、净资产相关查询。
- 上传/删除附件后，失效对应业务对象详情。
- 待确认（定时记账）确认/删除后，失效 `autoPending`、`reminder-summary`，确认还要失效交易/账户/预算。

红点提醒：

- 提醒计数只来自 `GET /ledgers/:ledgerId/reminder-summary`。
- 主 Tab“更多”显示提醒合计，二级入口显示各自数量；为 0 不显示，过大显示 `99+`。

## 8. 表单规范

- 新增/编辑交易表单必须读取 `record_settings`（字段排序、显隐、账户/人员必填、金额小数位来自账本设置）。
- 支出、收入、转账共用同一套表单框架，用配置控制字段差异。
- 表单错误显示在字段附近；Toast 只作辅助，不替代字段错误。
- 保存中禁用重复提交；复杂表单未保存离开应提示。
- 表单内的枚举/选项选择用 `PopoverMenu`（见 §11），不另造 Picker 弹层。

## 9. 金额规范

前端不得用 `number` 做精确金额计算。

- 输入态存字符串，提交用 `amountMicros` 字符串。
- 展示统一用 `MoneyText`；micros 转换统一放 `lib/money`。
- 交易列表展示 `effectiveAmountMicros`；账户余额以后端返回为准。

## 10. Sheet 栈与返回

多级弹出统一用 `SheetStackProvider`（`useSheetStack` 的 `push` / `pop` / `stack`）。

- 打开选择器 push，关闭当前 pop，关闭整个流程 clear。
- 系统/浏览器返回映射到 pop 当前可见弹层。
- 不允许每个页面各写一套多级弹出返回。

## 11. 弹出菜单与选值组件

弹出式菜单和表单选值统一用两个基础组件，不在页面内手写 backdrop + 绝对定位下拉：

- `components/ui/PopoverMenu.tsx`：锚定弹层，透明背板点击关闭，锚点下方弹出。放在 `position: relative` 父容器内，`align="start" | "end"` 控制对齐。
- `components/ui/Menu.tsx`：iOS 上下文菜单风格列表面板。

`MenuItem` 能力：`icon` + `label`、`description`（副标题）、`danger`（红色危险项）、`disabled`、`selected`（右侧对勾，表单选值）、`items`（二级菜单，自带返回行）、`groups`（二维数组分组，组间粗分隔条）。样式集中在 `globals.css` 的 `.ui-menu*` / `.ui-popover-menu*`，面板复用 `Surface` 的 menu 变体。参考实现：`app/bills/BillsScreen.tsx` 头部“更多”菜单。

## 12. 附件与预览

- 图片、PDF 用统一 `AttachmentPreview` 点击预览。
- 预览 URL 必须来自后端授权，不暴露对象存储 key。
- 上传中、失败、重试、删除要有明确状态。
- 删除业务对象后附件清理由后端处理，前端只发起业务删除。

## 13. 样式规范

用 Tailwind + 设计 token。

- 颜色必须来自 token，页面不写随机颜色值。
- 高频的复杂阴影 / blur / border 抽成组件或 token，不散落在页面。
- 弹层、菜单、浮层用实心 `Surface`（`.ui-surface--*`）+ 柔和阴影（`--shadow-soft`），**不恢复玻璃效果**。
- 文本不用 viewport 单位缩放；按钮最小点击区域 44px；safe area 由统一 layout 处理。

## 14. 图标规范

图标用 `lucide-react`。

- 工具按钮用图标表达，不为常见动作手写 SVG。
- 分类图标通过统一 `CategoryIcon` 渲染，不引入第二套图标系统。
- 图标尺寸、线宽、颜色通过组件统一控制。

## 15. 环境变量

- 只有明确可公开的信息用 `NEXT_PUBLIC_`（如 API base URL）。
- service token、模型 key、对象存储 secret、数据库连接串绝不进前端环境变量。

## 16. 禁止事项

- 禁止页面直接 `fetch` 业务 API 或手拼 API URL。
- 禁止复制已有组件后改名。
- 禁止每个页面各写一套筛选条件 / 多级弹出返回 / 下拉菜单。
- 禁止在前端实现账户余额最终计算。
- 禁止前端直接访问对象存储私有对象。
- 禁止把 AI API key 写入浏览器代码。
- 禁止为视觉效果让金额、日期、分类等关键信息难以阅读。
- 禁止恢复 Liquid Glass / 新增玻璃组件。

## 17. Agent 开发检查清单

每次写前端代码前检查：

- 已读 `FRONTEND_DESIGN.md` 和本文档。
- 已先搜索已有组件（ui / business / 域内 `_components`），优先复用。
- 新增通用交互做成组件，而非页面内私有实现。
- 数据走 `lib/data` 的查询 hooks + `lib/api` 的 `apiRequest`；未直接 `fetch`。
- 写操作后已失效相关查询，并处理红点提醒计数。
- 已处理 loading / empty / error / disabled / saving 状态。
- 已遵守金额 micros、附件授权、Sheet 栈规则。
- 弹出菜单 / 表单选值用了 `PopoverMenu`。
- 未引入玻璃效果。
