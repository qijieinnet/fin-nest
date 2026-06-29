# Fin Nest 前端设计与实现约束

版本：v0.3  
状态：前端基线，所有未明确标注为 v1 之外的内容均按本文执行  
依据：`claude-design/记账本.dc.html`、`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`，以及移动端优先和 Liquid Glass 方向讨论

## 1. 设计目标

Fin Nest 是个人/家庭使用的记账 Web 应用，v1 只重点服务移动端。PC 端不做完整桌面体验，只居中展示移动端容器。

前端目标：

- 移动端优先，优先适配 iPhone 尺寸和移动浏览器。
- 还原接近 iOS Liquid Glass 的层次、模糊、折射、高光和弹性感。
- 保持记账流程高效，不能为了视觉效果牺牲输入效率。
- 业务功能必须完整承接原型，不把复杂业务规则写在页面组件里。
- 所有核心财务规则、权限判断、余额变更、文件权限都以后端 API 为准。

视觉风格：

- 清透、轻盈、有层次，但不是大面积低对比的“糊玻璃”。
- 重要操作可以更有光泽和弹性；高频列表、表单、明细必须清晰可读。
- 背景需要有足够的色彩和明暗变化，让玻璃效果可见，但不能喧宾夺主。
- 页面整体要像一个精致的移动工具，而不是营销落地页。

## 2. 技术结论

前端采用 Next.js。

基础栈：

```txt
Next.js App Router
TypeScript
Tailwind CSS
Zod
TanStack Query
React Hook Form
framer-motion
lucide-react
liquid-glass-react
```

说明：

- Next.js 负责路由、页面、PWA、移动端交互和轻量聚合。
- 表单 schema 由前端 Zod schema 和 OpenAPI 生成类型共同约束，避免前后端校验口径不一致。
- 数据请求层必须支持缓存失效、乐观更新、错误回滚。
- 动效用 `framer-motion` 承担，避免在业务组件中散落手写动画。
- 图标使用 `lucide-react`；分类图标通过统一 `CategoryIcon` 封装。
- `liquid-glass-react` 只作为底层玻璃效果能力，不直接暴露给业务页面。

禁止：

- v1 使用 Ant Design、MUI 这类桌面导向的重型 UI 组件库。
- 把 `claude-design/记账本.dc.html` 拆出来直接复用为生产页面。
- 在 Next.js 页面里直接访问数据库或实现核心财务逻辑。

## 3. 移动端布局基线

第一阶段按移动端应用来设计。

布局约束：

- 主应用容器按 `min(100vw, 430px)` 设计，PC 上居中展示。
- 页面底部必须考虑 iOS safe area。
- 底部 Tab、浮动快捷入口、Bottom Sheet 要避开系统手势区域。
- 主要内容使用自然滚动，避免嵌套多个难以控制的滚动容器。
- 列表页要优先保证扫描效率，不能每一行都做成厚重卡片。
- 表单页要按记账设置动态调整字段顺序和显隐。
- 金额输入、日期选择、分类选择、账户选择是高频路径，交互优先级高于装饰效果。

PC 临时策略：

- 先展示移动端容器。
- 背景可以铺满视口，但业务内容不扩展成桌面多栏。
- 不为 PC 单独添加未设计过的信息密度和快捷入口。

## 4. Liquid Glass 实现策略

基于 `rdev/liquid-glass-react` 写组件，但必须包一层自研组件。

原因：

- 该库提供折射、模糊、饱和度、色散、弹性和 hover/click 效果，适合快速搭建 Liquid Glass 基础能力。
- 该库 README 明确 Safari 和 Firefox 只部分支持，displacement 效果不可见或不完整。
- 该库 issue 中已有 React 18、定位、Firefox 表现等兼容反馈，不能把业务直接绑定到它的 API。
- Next.js SSR 场景下需要 client-only 处理，避免 DOM/window 依赖导致服务端渲染问题。

组件封装原则：

- 业务组件只能 import 我们自己的 `GlassSurface`、`GlassButton`、`GlassTabBar` 等组件。
- `liquid-glass-react` 只允许出现在 `components/glass` 内部。
- 所有参数预设、浏览器降级、性能开关、SSR 动态加载都在 `components/glass` 内处理。
- 第三方玻璃库只存在于封装层，业务页面不得感知其 API。

目录：

```txt
apps/web/src/components/glass/
  GlassProvider.tsx
  GlassSurface.tsx
  GlassButton.tsx
  GlassIconButton.tsx
  GlassTabBar.tsx
  GlassBottomSheet.tsx
  GlassSegmentedControl.tsx
  glass-tokens.ts
  glass-support.ts
```

`GlassSurface` 承担：

- 根据浏览器能力选择 `liquid`、`cssFallback`、`solidFallback`。
- 根据 `variant` 套用不同强度。
- 控制是否启用 displacement、aberration、elasticity。
- 统一 radius、padding、border、高光、阴影、背景透明度。
- 支持 `interactive`、`pressed`、`disabled`、`selected` 等状态。

API 约定示例：

```tsx
<GlassSurface variant="bar" interactive>
  ...
</GlassSurface>

<GlassButton tone="primary" icon={<Plus />}>
  记一笔
</GlassButton>
```

业务页面不应直接写：

```tsx
import LiquidGlass from 'liquid-glass-react'
```

## 5. 玻璃效果使用边界

Liquid Glass 不是全页面材质，必须克制使用。

适合使用玻璃效果：

- 底部 Tab Bar。
- 顶部浮动导航。
- 快捷记账浮动按钮。
- Bottom Sheet 容器。
- Segmented Control。
- 弹窗、菜单、筛选面板。
- 重要操作按钮。
- 月份选择、日期滚轮等浮层控件。

不适合使用重玻璃效果：

- 交易列表每一行。
- 长表单每一个字段。
- 统计图表内部。
- 大量重复卡片。
- 文字密集的明细区。

规则：

- 高频列表以可读性为第一优先，只使用轻量半透明分隔或普通背景。
- 同屏重玻璃组件数量要少，避免移动端掉帧。
- 页面滚动时固定玻璃层必须测试性能。
- 金额、日期、分类名等关键信息不得放在低对比玻璃层上。
- 玻璃层背后必须有可感知背景，否则效果会变成灰色透明块。

## 6. Apple 官方资料优先规则

所有 iOS 风格、Liquid Glass 风格、类系统控件在设计和实现前，必须先查 Apple 官方资料，再进入组件实现。

必须优先查阅：

- Apple Human Interface Guidelines：确认控件用途、层级、平台惯例、可访问性和交互要求。
- Apple Developer Documentation：确认 UIKit / SwiftUI 对应控件的行为、状态和命名。
- Apple Design Resources：如有可用资源，优先参考官方模板、符号和平台尺寸基线。

执行规则：

- 新增或重做 `Button`、`IconButton`、`Tabs`、`SegmentedControl`、`Select`、`Menu`、`Sheet`、`Dialog`、`NavigationBar`、`TabBar` 等基础控件前，必须先完成官方资料检查。
- 官方资料给出明确约束时，以官方资料为底线，例如可点击区域、语义、平台行为和可访问性要求。
- 官方资料没有给出固定视觉尺寸时，不臆造“官方尺寸”；应按截图、系统截图测量、现有设计 token 和常规 iOS 尺寸基线落地。
- 用户提供截图时，截图用于确定目标观感、密度、颜色、圆角、阴影、菜单位置和具体状态；官方资料用于校准交互和平台边界。
- 没有截图时，可以按官方资料和项目设计系统做合理 iOS 风格，但必须在交付说明中说明哪些尺寸是项目约定，而不是 Apple 明确数值。
- 每次实现相关组件时，交付说明或代码评审说明中应记录查过的 Apple 官方页面和最终采用的尺寸/交互依据。

## 7. 视觉 Token

前端必须抽象设计 token，不在页面里散落随机颜色。

token 分层：

```txt
color
  bg.app
  bg.surface
  text.primary
  text.secondary
  text.muted
  accent.expense
  accent.income
  accent.transfer
  accent.warning
  accent.success

glass
  tint
  border
  highlight
  shadow
  blur
  saturation
  displacement
  aberration
  elasticity
  radius

motion
  duration.fast
  duration.normal
  spring.soft
  spring.snappy

space
  pageX
  sheetX
  controlHeight
  tabBarHeight
```

色彩原则：

- 不能做单一蓝紫渐变主题。
- 收入、支出、转账、提醒要有清晰语义色。
- 背景可以有柔和多色，但不能干扰文本。
- v1 只实现浅色模式；token 层保留暗色字段位，但不实现暗色模式切换。

## 8. 核心组件清单

第一批应优先实现以下组件，而不是直接在页面里临时拼 UI。

应用骨架：

- `MobileAppShell`：移动端容器、safe area、全局背景。
- `MobilePage`：页面标题区（支持 `leading` / `action` 插槽）、内容滚动区、底部留白。
- `AppTabBar`：账单、账户、计划、更多四个主入口。
- `FloatingActionButton`：快捷记账/新增记账入口。

通用控件（`components/ui`）：

- `EmojiPicker`：通用 emoji 选择弹窗（Bottom Sheet），内容与 iOS 表情键盘分组一致（笑脸与人物 / 动物与自然 / 食物与饮料 / 活动 / 旅行与地点 / 物品 / 符号 / 旗帜），底部分类导航 + 网格 + 选中高亮。新建/编辑账本、分类、账户等任何需要选图标的表单统一复用，不允许各自实现 emoji 网格。默认分组数据导出为 `EMOJI_CATEGORIES`，可通过 `categories` 自定义。

玻璃组件：

- `GlassSurface`
- `GlassButton`
- `GlassIconButton`
- `GlassTabBar`
- `GlassBottomSheet`
- `GlassMenu`
- `GlassSegmentedControl`

记账业务组件：

- `AmountInput`
- `TransactionTypeSwitch`
- `CategoryPicker`
- `AccountPicker`
- `PersonPicker`
- `DateWheelPicker`
- `MonthWheelPicker`
- `FieldOrderForm`
- `AttachmentPicker`
- `RecoverablePayableEditor`

列表与筛选：

- `TransactionList`
- `TransactionGroup`
- `TransactionRow`
- `SwipeActionRow`
- `FilterSheet`
- `EmptyState`
- `LoadingState`

数据展示：

- `MoneyText`
- `TrendChart`
- `CategoryRingChart`
- `PlanProgress`
- `BudgetProgress`
- `AccountBalanceCard`

组件边界：

- 通用组件不能直接调用业务 API。
- 业务组件可以接收数据和事件，但不要自己决定权限。
- 页面负责组合 hooks、API、路由和业务组件。
- 金额格式化统一走 `MoneyText` 或金额工具函数。

## 9. 组件复用与禁止重复实现规则

AI agent 写前端时必须优先复用已有组件。不能因为某个页面看起来有一点差异，就在页面目录里重新写一套相似 UI。

分层：

```txt
apps/web/src/components/ui/          # 基础 UI：Button、Input、Sheet、Tabs、Toast
apps/web/src/components/glass/       # 玻璃风格底层组件
apps/web/src/components/business/    # 跨模块业务组件：筛选、选择器、金额、日期、附件
apps/web/src/features/bills/         # 账单模块页面组合与少量模块专属组件
apps/web/src/features/stats/
apps/web/src/features/accounts/
apps/web/src/features/plans/
```

新增 UI 前必须执行：

- 先搜索 `components/ui`、`components/glass`、`components/business` 和相关 `features` 目录。
- 如果已有同类组件，优先通过 props、variant、slots、字段配置扩展它。
- 如果同一类 UI 会在 2 个及以上页面出现，必须抽到 `components/business` 或更低层通用组件。
- 页面组件只能组合数据、状态、事件和布局，不应内联实现复杂选择器、筛选器、弹窗、金额输入、日期选择。
- 如果确实需要页面专属组件，文件名和注释必须说明它为什么不能复用已有组件。

禁止页面私有重复实现的组件：

- `FilterSheet`
- `FilterBar`
- `DateRangePicker`
- `MonthWheelPicker`
- `DateWheelPicker`
- `CategoryPicker`
- `AccountPicker`
- `PersonPicker`
- `AmountInput`
- `MoneyText`
- `BottomSheet`
- `SegmentedControl`
- `TransactionRow`
- `SwipeActionRow`
- `EmptyState`
- `LoadingState`
- `AttachmentPicker`
- `EmojiPicker`

### 8.1 筛选组件边界

筛选是第一个必须配置驱动复用的业务组件。

账单、统计、计划、账户关联记录、保险关联记录、物品关联记录都不应各写一套筛选 UI。统一使用 `FilterSheet` 和必要的轻量入口组件，例如 `FilterBar`。

API：

```tsx
<FilterSheet
  value={filter}
  fields={[
    'type',
    'category',
    'dateRange',
    'account',
    'person',
    'creator',
    'amountRange',
    'keyword',
  ]}
  onChange={setFilter}
  onApply={applyFilter}
  onReset={resetFilter}
/>
```

不同页面只能通过配置微调：

```tsx
<FilterSheet
  value={filter}
  fields={['type', 'category', 'dateRange', 'person']}
  onChange={setFilter}
  onApply={applyFilter}
/>
```

筛选字段定义集中管理：

```txt
components/business/filter/
  FilterSheet.tsx
  FilterBar.tsx
  filter-fields.ts
  filter-types.ts
  filter-utils.ts
```

筛选组件负责：

- 展示统一的筛选入口、筛选项、已选状态和重置/确认操作。
- 按 `fields` 控制出现哪些筛选条件。
- 复用分类、账户、人员、日期范围、金额范围等选择器。
- 输出结构化 filter value。

筛选组件不负责：

- 绕过 API 权限。
- 自己请求所有业务数据。
- 自己决定统计口径。
- 把筛选条件作为业务实体保存。

页面负责：

- 提供当前 `ledgerId`。
- 提供可选项数据或调用对应 hooks。
- 决定 filter 如何映射到当前页面 API 查询。
- 决定应用筛选后需要失效或刷新哪些查询。

### 8.2 复用判断标准

只要满足任一条件，就应优先复用或抽象：

- UI 结构相似，只是字段数量不同。
- 交互相似，只是数据来源不同。
- 同样使用 Bottom Sheet、Picker、Segmented Control 等移动端模式。
- 同样处理金额、日期、分类、账户、人员、附件。
- 同一视觉组件只是颜色、图标、文案、尺寸不同。

允许新建组件的情况：

- 业务语义不同，复用会让 props 变得难以理解。
- 交互流程不同，强行复用会增加大量条件分支。
- 组件只在单个复杂页面内服务一个局部流程，并且没有跨页面复用价值。

如果出现“复制已有组件然后改一点”的冲动，应该先停下来改原组件 API。

## 10. 页面与导航结构

页面应按业务模块拆分，不复刻原型单文件。

主 Tab 固定为：

- 账单：交易列表、月度汇总、筛选、交易详情、新增/编辑记账入口。
- 账户：账户、子账户、净资产、账户流水、余额调整、收款/还款。
- 计划：支出限额、收入目标、周期计划、计划详情、命中明细。
- 更多：统计、自动记账、快捷记账、保险、物品、分类、人员、记账设置、成员、系统设置等二级入口。

规则：

- 不使用“我的”作为主 Tab 名称。
- 统计不作为 v1 主 Tab，放入“更多”入口。
- 保险、物品、自动记账、快捷记账都从“更多”进入。
- 账本切换入口可以放在账单页顶部或更多页顶部，但切换后所有账本范围数据必须刷新。
- 更多页是功能入口集合，不是个人主页；用户资料、登录设备、注册开关等系统设置可以作为更多页里的二级入口。

提醒红点：

- v1 不做站内提醒中心。
- “更多”主 Tab 显示所有二级入口提醒数量合计。
- 更多页中的对应入口显示自己的提醒数量。
- 红点为红色圆圈，圆圈内显示数量。
- 数量为 0 时不显示。
- 数量过大时显示 `99+`。
- 点击入口后进入对应功能页，不进入统一消息中心。

路由：

```txt
/login
/register
/ledgers
/ledgers/join
/app/:ledgerId/bills
/app/:ledgerId/bills/new
/app/:ledgerId/bills/:transactionId
/app/:ledgerId/accounts
/app/:ledgerId/accounts/:accountId
/app/:ledgerId/plans
/app/:ledgerId/more
/app/:ledgerId/stats
/app/:ledgerId/auto-rules
/app/:ledgerId/quick-templates
/app/:ledgerId/insurances
/app/:ledgerId/items
/app/:ledgerId/settings
/app/:ledgerId/settings/categories
/app/:ledgerId/settings/people
/app/:ledgerId/settings/record
/app/:ledgerId/settings/members
```

说明：

- Next.js App Router 必须按以上信息架构落地；实际文件夹可使用 route group，但 URL 结构保持一致。
- 账本选择和当前 `ledgerId` 是全局上下文。
- 交易新增/编辑页面必须读取记账设置，动态控制字段顺序、显隐、必填。
- 自动记账待确认列表放在“更多 -> 自动记账”内，支持编辑后确认、批量确认、删除/忽略。

### 9.1 多级弹出与返回

移动端允许使用 Bottom Sheet、全屏 Sheet、Picker Sheet 等多级弹出。

规则：

- 如果内容是从多级弹出中打开的，关闭时必须原路返回上一层。
- Sheet 栈必须有统一管理方式，不能每个页面自己写一套返回逻辑。
- 从记账表单打开分类选择，再打开二级分类或新增分类，关闭时应回到分类选择，再回到记账表单。
- 从附件预览关闭时，应回到原交易详情或表单，不丢失未保存内容。
- 系统返回键或浏览器返回必须尽量与可见层级一致，避免直接退出整个记账流程。

### 9.2 开发环境样板页

开始写业务页面前，必须先实现基础 UI 组件和开发环境样板页。

样板页要求：

- 只在开发环境可访问，生产环境不可访问。
- 用于展示基础 UI、玻璃组件、业务通用组件和关键状态。
- 至少覆盖按钮、图标按钮、Tab Bar、Bottom Sheet、Segmented Control、Toast、输入框、金额输入、日期选择、筛选面板、交易行、空状态、加载状态、附件预览入口。
- 新增基础组件或业务通用组件时，必须同步补充样板页。
- 样板页不是用户功能，不进入正式导航。

样板页路由：

```txt
/__dev/ui
```

## 11. 状态与数据请求

前端状态分三类：

- Server State：用户、账本、交易、账户、统计、计划等来自 API 的数据。
- UI State：sheet 展开、筛选面板、当前 tab、临时选中项。
- Form State：新增/编辑交易、设置、筛选条件。

规则：

- Server State 使用统一请求缓存层管理，不散落 `useEffect + fetch`。
- 创建/编辑/删除交易后，必须失效交易列表、账户、统计、计划相关缓存。
- 乐观更新只用于可安全回滚的 UI；账户余额和统计最终以后端返回为准。
- 当前账本切换时，必须清理或隔离上一账本的查询缓存。
- 筛选条件使用 URL 状态；不作为业务实体落库。
- v1 不保存常用筛选。

## 12. 表单与金额

记账表单必须由账本设置驱动。

新增/编辑记账表单以 `claude-design/记账本.dc.html` 的字段和交互为基线，样式先按原型方向实现，再用项目自有组件体系重构。不能因为工程方便删减原型中的记账字段。

字段规则：

- 字段顺序来自 `record_settings.field_order`。
- 字段显隐来自 `record_settings.visible_fields`。
- 账户是否必填来自 `record_settings.acct_required`。
- 人员是否必填来自 `record_settings.person_required`。
- 金额小数位来自 `record_settings.amount_decimal_places`。
- 支出、收入、转账的字段差异必须由统一表单配置表达，不为每种类型复制一套表单。
- 字段排序只影响可排序字段。
- 可排序字段为：分类、账户、日期、人员、备注、附件、可收回/需归还、关联保单、关联物品。
- 固定字段为：交易类型、金额、保存操作；固定字段不参与排序。

金额规则：

- 前端输入允许按设置小数位输入。
- 前端提交给 API 时使用字符串或 `amountMicros`，不要使用浮点数承载精确金额。
- 展示金额统一使用 `MoneyText`。
- 列表展示交易有效金额，不展示原始金额，除非详情中解释可收回/需归还拆分。
- 支出、收入、转账颜色语义要统一。

快捷记账规则：

- 未开启直接记账：点击模板打开记账编辑器并预填。
- 开启直接记账：点击模板直接创建交易，不打开编辑器。
- 只有除日期外的所有必填字段已在模板内填写，才能开启直接记账。
- 触发当天作为交易日期。

附件规则：

- 记账表单和详情页都支持附件展示。
- 图片和 PDF 附件可以点击预览。
- 预览必须通过后端授权后的临时 URL 或代理接口访问，不能直接拼 MinIO 地址。
- 预览关闭时必须回到打开预览前的页面或弹出层。
- 删除未保存附件只影响本地草稿；删除已保存附件必须调用 File/Attachment API。

## 13. 交互动效

动效要服务操作反馈。

动效规则：

- Tab 切换有轻微弹性和玻璃高光移动。
- Bottom Sheet 上拉/关闭使用 spring。
- 按钮按下有压缩、亮度和折射变化。
- 列表左滑操作要有明确阈值和回弹。
- 日期/月份滚轮要有惯性和选中反馈。
- 保存成功/失败使用 Toast，不阻塞主流程。

禁止：

- 大面积背景持续动画导致移动端耗电。
- 每个列表项都有复杂 hover 动效。
- 为了炫技延迟记账保存。
- 动效遮挡金额、分类、日期等关键信息。

## 14. 可访问性与可读性

Liquid Glass 风格必须通过可读性检查。

规则：

- 关键文本对比度优先，不够就降低透明度或改用实底。
- 按钮点击区域不小于 44px。
- 仅靠颜色表达状态时，需要辅以文字或图标。
- 输入错误要靠近字段展示。
- Toast 不能作为唯一错误说明，表单错误必须可回看。
- 触摸反馈要清晰，尤其是玻璃按钮和浮层。

## 15. PWA 与移动浏览器

v1 是 Web/PWA，不做原生 App。

PWA 规则：

- 配置 manifest、应用图标、启动图标。
- 支持添加到主屏幕后全屏或 standalone 显示。
- 处理 iOS Safari 的 viewport、safe area、键盘遮挡。
- 文件上传支持拍照/相册选择。
- v1 不支持离线完整记账。

## 16. 与后端边界

前端不能承担最终业务事实。

前端可以：

- 做表单预校验。
- 做交互级权限隐藏。
- 做缓存和乐观 UI。
- 做草稿状态。
- 调用 API 获取签名上传 URL。

前端不可以：

- 直接计算并落库账户余额。
- 直接访问 PostgreSQL。
- 直接持有 MinIO 永久凭证。
- 只靠前端判断账本权限。
- 绕过 Transaction API 创建交易。
- 绕过 File API 访问私有附件。
- 把 AI API key 或模型编排写在浏览器里。

## 17. 给 Agent 的硬约束

- 开发前先读 `ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`、`DATABASE_DESIGN.md`、本文档和 `FRONTEND_ENGINEERING.md`。
- 新增任何 UI 前，必须先搜索已有组件；同类 UI 已存在时优先扩展，不重复实现。
- 前端以移动端为主，PC 端先按移动容器处理。
- 主 Tab 只能是账单、账户、计划、更多；其它功能作为更多页二级入口。
- 写业务页面前必须先完成基础 UI 组件和仅开发环境可访问的 UI 样板页。
- 业务功能以 `claude-design/记账本.dc.html` 为原型来源。
- 不恢复旧 `PRD.md`，不按旧单体 HTML 做工程结构。
- `liquid-glass-react` 必须经过 `components/glass` 封装后使用。
- 同屏大量重复内容不能滥用重玻璃效果。
- 交易、账户、文件、权限的最终规则必须调用后端 API。
- 任何新组件都要优先考虑触摸尺寸、safe area、性能和可读性。
- UI 还原 iOS Liquid Glass 是方向，但不能牺牲记账效率和财务信息清晰度。

## 18. 参考链接

- `liquid-glass-react` GitHub: https://github.com/rdev/liquid-glass-react
- 原型文件：`claude-design/记账本.dc.html`
