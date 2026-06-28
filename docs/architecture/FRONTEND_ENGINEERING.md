# Fin Nest 前端工程规范

版本：v0.2  
状态：前端编码基线，开始写 Next.js 项目前必须先遵守  
依据：`FRONTEND_DESIGN.md`、`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`

## 1. 目标

这份文档用于约束 AI agent 和开发者写前端代码的方式，重点解决：

- 不重复造相似组件。
- 不把业务规则写散到页面。
- 不让页面直接 fetch、直接拼 UI、直接处理财务一致性。
- 不因为 Liquid Glass 视觉效果破坏性能和可读性。
- 不让开发样板页、调试入口进入生产环境。

## 2. 目录结构

```txt
apps/web/
  src/
    app/
      (auth)/
      (app)/
      __dev/
    components/
      ui/
      glass/
      business/
    features/
      bills/
      accounts/
      plans/
      more/
      stats/
      auto-rules/
      quick-templates/
      insurances/
      items/
      settings/
    lib/
      api/
      auth/
      config/
      format/
      money/
      query/
      route/
      generated/
    providers/
    styles/
    types/
```

目录职责：

- `app`：Next.js 路由、layout、page，只做页面装配。
- `components/ui`：无业务语义的基础组件。
- `components/glass`：Liquid Glass 封装和降级。
- `components/business`：跨模块复用的业务组件。
- `features/*`：模块页面组合、模块 hooks、模块 adapter。
- `lib/api`：API client、请求封装、错误处理。
- `lib/money`：金额解析、格式化、micros 转换。
- `lib/format`：日期、数字、文本展示。
- `lib/generated`：从 OpenAPI 生成的类型或 API client。
- `providers`：QueryClient、Auth、Ledger、Toast、SheetStack 等全局 provider。

## 3. 开发顺序

开始业务页面前，必须先完成：

1. 项目基础结构、路径别名、Lint、格式化。
2. `components/ui` 基础组件。
3. `components/glass` 玻璃组件封装。
4. `providers`：Query、Auth、Ledger、Toast、SheetStack。
5. 仅开发环境可访问的 UI 样板页 `/__dev/ui`。
6. `components/business` 第一批业务通用组件。
7. 再开始账单、账户、计划、更多等业务页面。

这一步很重要。没有基础组件和样板页时，不允许直接开写业务页面。

## 4. 路由与页面职责

页面文件只负责：

- 读取路由参数。
- 调用 feature hooks 获取数据。
- 组合布局和组件。
- 处理页面级 loading、empty、error。
- 把用户操作转发给 mutation 或导航函数。

页面文件禁止：

- 直接写复杂表单控件。
- 直接 `fetch`。
- 直接拼接 API URL。
- 直接计算金额 micros。
- 直接实现筛选、日期选择、分类选择、账户选择。
- 直接 import `liquid-glass-react`。

页面结构：

```tsx
export default function BillsPage() {
  return <BillsScreen />
}
```

真正的页面组合放在 feature 内：

```txt
features/bills/screens/BillsScreen.tsx
```

## 5. 组件分层规则

基础 UI：

- 不知道账本、交易、账户这些业务概念。
- 例如 `Button`、`IconButton`、`Input`、`Sheet`、`Toast`、`Tabs`。

Glass 组件：

- 只封装视觉材质和交互反馈。
- 只允许在 `components/glass` 里依赖 `liquid-glass-react`。
- 对外暴露稳定 API，例如 `GlassSurface`、`GlassButton`、`GlassBottomSheet`。

Business 组件：

- 知道业务语义，但不直接拥有业务事实。
- 例如 `FilterSheet`、`AmountInput`、`CategoryPicker`、`AccountPicker`、`PersonPicker`、`TransactionRow`。
- 接收数据、value、onChange、loading、disabled。
- 不直接决定最终权限和财务规则。

Feature 组件：

- 组合业务组件、hooks、API mutation。
- 允许有模块专属 UI，但不能复制已有通用组件。

## 6. 命名规范

文件命名：

- React 组件：`PascalCase.tsx`。
- hooks：`useSomething.ts`。
- 工具函数：`kebab-case.ts` 或按目录既有风格统一。
- 类型：靠近使用方，跨模块共享类型放 `types` 或 `packages/shared`。
- schema：`something.schema.ts`。
- API：`something.api.ts`。
- query hooks：`something.queries.ts`。
- mutations：`something.mutations.ts`。

命名原则：

- 组件名表达业务语义，不使用 `CommonPanel2`、`NewCard`、`NiceButton` 这类名字。
- `Page` 只用于 Next.js route 文件或极薄包装。
- `Screen` 用于完整页面组合。
- `Sheet` 用于底部弹层。
- `Picker` 用于选择器。
- `Row` 用于列表行。
- `Card` 只用于真正的独立卡片，不把页面 section 都叫 card。

## 7. API Client 与请求

统一通过 `lib/api` 访问后端。

要求：

- 后端接口契约是 REST + OpenAPI。
- 前端类型从 OpenAPI 生成；`packages/shared` 只放跨端常量和通用 schema。
- 页面和组件不能直接 `fetch`。
- API client 统一处理 base URL、credentials、JSON、错误结构。
- session 使用 HttpOnly Cookie 时，客户端请求必须带 `credentials`。
- API 错误必须转换成统一错误类型，便于 Toast 和表单错误展示。
- 文件上传必须先向 API 请求签名 URL 或上传凭证，再上传到 MinIO。

结构：

```txt
lib/api/
  client.ts
  errors.ts
  endpoints.ts

features/bills/api/
  bills.api.ts
  bills.queries.ts
  bills.mutations.ts
```

## 8. Query 与缓存

Server State 使用统一请求缓存层。

规则：

- 查询 key 必须包含 `ledgerId`。
- 当前账本切换时，不得复用上个账本的查询结果。
- 创建、编辑、删除交易后，必须失效交易列表、账户、统计、计划相关查询。
- 编辑账户余额后，必须失效账户列表、账户详情、账户流水、净资产相关查询。
- 上传或删除附件后，必须失效对应业务对象详情。
- 乐观更新只用于 UI 体验，最终以后端返回为准。

query key：

```ts
['ledger', ledgerId, 'transactions', filter]
['ledger', ledgerId, 'accounts']
['ledger', ledgerId, 'account', accountId]
['ledger', ledgerId, 'plans']
['ledger', ledgerId, 'stats', filter]
['ledger', ledgerId, 'reminder-summary']
```

红点提醒：

- v1 不做站内提醒中心。
- 主 Tab “更多”显示所有提醒数量合计。
- 更多页二级入口显示各自提醒数量。
- 数字为 0 不显示红点，过大可显示 `99+`。
- 提醒计数只来自 `GET /ledgers/:ledgerId/reminder-summary`。

## 9. 表单规范

表单统一使用 schema 校验。

规则：

- 表单字段默认由 schema 和后端 DTO 对齐。
- 新增/编辑交易表单必须读取 `record_settings`。
- 支出、收入、转账使用同一套表单框架，通过配置控制字段差异。
- 字段排序、字段显隐、账户必填、人员必填、金额小数位来自账本设置。
- 表单错误必须显示在字段附近。
- Toast 只能作为辅助提醒，不能替代字段错误。
- 保存中要禁用重复提交。
- 未保存离开时，复杂表单应提示用户。

## 10. 金额规范

前端不得用 `number` 做精确金额计算。

规则：

- 输入态保存字符串。
- 提交 API 使用 `amountMicros` 字符串或 bigint 可序列化形式。
- 展示统一使用 `MoneyText`。
- micros 转换统一放 `lib/money`。
- 交易列表展示 `effectiveAmountMicros`。
- 账户余额展示以后端返回为准。

工具：

```txt
lib/money/
  parse-money.ts
  format-money.ts
  micros.ts
```

## 11. Sheet 栈与返回

多级弹出必须统一使用 Sheet 栈。

要求：

- `SheetStackProvider` 管理当前弹层层级。
- 打开新选择器时 push。
- 关闭当前选择器时 pop，回到上一层。
- 关闭整个流程时 clear。
- 浏览器返回键或系统返回映射到 pop 当前可见弹层。
- 不允许每个页面私有实现一套多级弹出返回。

典型流程：

```txt
记账表单 -> 分类选择 -> 二级分类选择 -> 返回分类选择 -> 返回记账表单
记账详情 -> 附件预览 -> 返回记账详情
```

## 12. 附件与预览

附件组件统一放在 `components/business/attachment`。

规则：

- 图片和 PDF 支持点击预览。
- 预览使用统一 `AttachmentPreview`。
- 预览 URL 必须来自后端授权。
- 不直接暴露 MinIO object key 给用户操作。
- 上传中、失败、重试、删除要有明确状态。
- 删除业务对象后附件清理由后端处理，前端只负责发起业务删除。

## 13. UI 样板页

`/__dev/ui` 是开发环境组件样板页。

规则：

- 只允许开发环境访问。
- 生产环境必须返回 404 或不打包入口。
- 不进入正式导航。
- 不依赖真实用户数据，使用本地 mock。
- 每新增一个基础组件或业务通用组件，都必须补充样板。

样板页至少展示：

- 基础按钮、图标按钮、输入框、开关、分段控件。
- 玻璃 Tab Bar、玻璃按钮、玻璃 Bottom Sheet。
- 金额输入、日期选择、月份选择。
- 筛选面板。
- 交易列表行和左滑操作。
- 空状态、加载状态、错误状态。
- 附件图片/PDF 预览入口。

## 14. 样式规范

使用 Tailwind 和设计 token。

规则：

- 页面不写随机颜色值，颜色必须来自 token。
- 不在页面里散落复杂阴影、blur、border，高频样式抽成组件或 token。
- 不使用大面积单一蓝紫渐变。
- 文本不能用 viewport 单位缩放。
- 按钮最小点击区域 44px。
- safe area 通过统一 layout 处理。
- 交易列表行不使用重玻璃效果。

## 15. 图标规范

图标使用 `lucide-react`。

规则：

- 工具按钮使用图标表达。
- 不为常见动作手写 SVG。
- 分类图标通过统一 `CategoryIcon` 渲染，v1 不引入第二套图标系统。
- 图标尺寸、线宽、颜色通过组件统一控制。

## 16. 环境变量

前端环境变量必须分清服务端和客户端。

规则：

- 只有明确可公开的信息使用 `NEXT_PUBLIC_`。
- API base URL 是公开客户端配置。
- service token、模型 key、MinIO secret、数据库连接串绝不能进入前端环境变量。
- 开发样板页开关使用明确配置，例如 `NEXT_PUBLIC_ENABLE_DEV_UI`，生产构建必须关闭。

## 17. 禁止事项

- 禁止页面直接 import `liquid-glass-react`。
- 禁止页面直接 `fetch` 业务 API。
- 禁止复制已有组件后改名。
- 禁止每个页面各写一套筛选条件。
- 禁止在前端实现账户余额最终计算。
- 禁止前端直接访问 MinIO 私有对象。
- 禁止把 AI API key 写入浏览器代码。
- 禁止为了视觉效果让金额、日期、分类等关键信息难以阅读。
- 禁止开发环境样板页进入正式导航或生产环境。

## 18. Agent 开发检查清单

每次让 AI agent 写前端代码前，必须检查：

- 已读 `FRONTEND_DESIGN.md` 和本文档。
- 已先搜索已有组件。
- iOS 风格、Liquid Glass 风格或类系统控件已先查 Apple 官方资料，并记录参考页面、采用的交互依据和尺寸依据。
- 新增通用组件优先于页面内实现。
- 已确认对主 Tab、更多页入口或 Sheet 栈的影响。
- 已使用统一 API client 和 query hooks。
- 已处理 loading、empty、error、disabled、saving 状态。
- 已遵守金额 micros 规则。
- 已遵守附件授权和预览规则。
- 已同步处理红点提醒计数。
- 已同步更新 `/__dev/ui` 样板页。
