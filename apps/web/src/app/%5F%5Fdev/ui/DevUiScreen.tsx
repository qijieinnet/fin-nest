"use client";

import { useState } from "react";
import {
  BadgeDollarSign,
  Bell,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  Home,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  ShoppingBag,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import {
  AccountBalanceCard,
  AccountPicker,
  AmountInput,
  AttachmentPicker,
  CategoryPicker,
  CategoryRingChart,
  DateWheelPicker,
  EmptyState,
  FilterBar,
  FilterSheet,
  LoadingState,
  MoneyText,
  MonthWheelPicker,
  PersonPicker,
  PlanLimitCard,
  RecoverablePayableEditor,
  SwipeActionRow,
  TransactionGroup,
  TransactionRow,
  TransactionTypeSwitch,
  TrendChart,
  type AttachmentItem,
  type BusinessFilterValue,
  type BusinessOption,
  type CategoryOption,
  type RecoverablePayableItem,
  type TransactionType,
} from "@/components/business";
import {
  GlassBottomSheet,
  GlassButton,
  GlassMenu,
  GlassSegmentedControl,
} from "@/components/glass";
import {
  ActionButton,
  Button,
  IconButton,
  Input,
  MobileAppShell,
  MobilePage,
  NavigationBar,
  SelectField,
  Sheet,
  Switch,
  TabBar,
  Tabs,
} from "@/components/ui";
import { useSheetStack, useToast } from "@/providers";

const tabItems = [
  { label: "账单", value: "bills", icon: <Home size={20} /> },
  { label: "账户", value: "accounts", icon: <WalletCards size={20} /> },
  { label: "计划", value: "plans", icon: <CalendarDays size={20} /> },
  { label: "更多", value: "more", icon: <MoreHorizontal size={20} />, badge: 3 },
];

const typeItems = [
  { label: "支出", value: "expense", icon: <CircleDollarSign size={16} /> },
  { label: "收入", value: "income", icon: <BadgeDollarSign size={16} /> },
  { label: "转账", value: "transfer", icon: <CreditCard size={16} /> },
];

const categoryOptions: CategoryOption[] = [
  { id: "food", label: "餐饮", color: "#ff8a3d", iconName: "food", kind: "expense" },
  { id: "food-lunch", label: "午餐", color: "#ff8a3d", iconName: "food", parentId: "food", kind: "expense" },
  { id: "food-drink", label: "饮料", color: "#ff8a3d", iconName: "coffee", parentId: "food", kind: "expense" },
  { id: "shopping", label: "购物", color: "#0a84ff", iconName: "shopping", kind: "expense" },
  { id: "shopping-digital", label: "数码", color: "#0a84ff", iconName: "shopping", parentId: "shopping", kind: "expense" },
  { id: "salary", label: "工资", color: "#2f9e77", iconName: "income", kind: "income" },
];

const accountOptions: BusinessOption[] = [
  { id: "cash", label: "现金账户", description: "日常支出" },
  { id: "cash-default", label: "默认", description: "现金账户", parentId: "cash" },
  { id: "cash-travel", label: "旅行备用金", description: "现金账户", parentId: "cash" },
  { id: "card", label: "信用卡", description: "本月待还" },
  { id: "card-main", label: "主卡", description: "信用卡", parentId: "card" },
];

const personOptions: BusinessOption[] = [
  { id: "me", label: "我" },
  { id: "family", label: "家人" },
];

const attachmentItems: AttachmentItem[] = [
  { id: "receipt", name: "晚餐小票.jpg", contentType: "image/jpeg", sizeBytes: 246000 },
  { id: "policy", name: "保单.pdf", contentType: "application/pdf", sizeBytes: 860000 },
];

const chartSegments = [
  { id: "food", label: "餐饮", valueMicros: "1280000000", color: "#ff8a3d", icon: "food" },
  { id: "shopping", label: "购物", valueMicros: "860000000", color: "#0a84ff", icon: "shopping" },
  { id: "traffic", label: "交通", valueMicros: "520000000", color: "#2f9e77", icon: "bus" },
];

export function DevUiScreen() {
  const [tab, setTab] = useState("bills");
  const [type, setType] = useState<TransactionType>("expense");
  const [listType, setListType] = useState("standard");
  const [budgetAlert, setBudgetAlert] = useState(true);
  const [plainTab, setPlainTab] = useState("first");
  const [plainSheetOpen, setPlainSheetOpen] = useState(false);
  const [glassSheetOpen, setGlassSheetOpen] = useState(false);
  const [amount, setAmount] = useState("128.50");
  const [categoryId, setCategoryId] = useState<string | null>("food");
  const [accountId, setAccountId] = useState<string | null>("cash-default");
  const [personId, setPersonId] = useState<string | null>("me");
  const [date, setDate] = useState("2026-06-28");
  const [month, setMonth] = useState("2026-06");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<BusinessFilterValue>({ timePreset: "month", type: "expense" });
  const [attachmentEnabled, setAttachmentEnabled] = useState(true);
  const [recoverableEnabled, setRecoverableEnabled] = useState(true);
  const [statsDrill, setStatsDrill] = useState<string | null>(null);
  const [recoverableItems, setRecoverableItems] = useState<RecoverablePayableItem[]>([
    { id: "rp-1", accountId: "cash-default", amount: "38.00" },
  ]);
  const { showToast } = useToast();
  const sheetStack = useSheetStack();
  const transactionActions = [
    {
      icon: <Pencil size={20} />,
      label: "编辑",
      onClick: () => showToast({ message: "编辑交易" }),
    },
    {
      icon: <Trash2 size={20} />,
      label: "删除",
      onClick: () => showToast({ message: "删除交易", tone: "error" }),
      tone: "danger" as const,
    },
  ];

  function openStackLevelOne() {
    sheetStack.push({
      title: "第一层 Sheet",
      content: (
        <div className="dev-sheet-content">
          <p>这里模拟记账表单进入分类选择。</p>
          <Button
            icon={<Layers size={17} />}
            onClick={() =>
              sheetStack.push({
                title: "第二层 Sheet",
                content: (
                  <div className="dev-sheet-content">
                    <p>按浏览器返回键会先回到第一层。</p>
                    <Button icon={<Check size={17} />} onClick={sheetStack.clear}>
                      清空 Sheet 栈
                    </Button>
                  </div>
                ),
              })
            }
            variant="secondary"
          >
            打开第二层
          </Button>
        </div>
      ),
    });
  }

  return (
    <MobileAppShell>
      <MobilePage title="组件预览">
        <div className="dev-ui">
          <section className="dev-section">
            <h2>按钮</h2>
            <div className="dev-row">
              <ActionButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" />
              <ActionButton
                icon={<Check size={24} strokeWidth={2.6} />}
                label="确认"
                tone="primary"
              />
              <ActionButton
                disabled
                icon={<Check size={24} strokeWidth={2.6} />}
                label="确认不可用"
                tone="primary"
              />
            </div>
            <div className="dev-row">
              <Button icon={<Plus size={17} />}>新增</Button>
              <Button variant="secondary">次要</Button>
              <Button variant="ghost">轻量</Button>
              <Button variant="danger">删除</Button>
              <Button disabled>禁用</Button>
            </div>
            <div className="dev-row">
              <IconButton icon={<Bell size={18} />} label="提醒" />
              <IconButton icon={<Settings size={18} />} label="设置" />
              <Button
                onClick={() =>
                  showToast({ title: "保存成功", message: "这是一条 Toast。", tone: "success" })
                }
                variant="secondary"
              >
                Toast
              </Button>
            </div>
          </section>

          <section className="dev-section">
            <h2>输入框</h2>
            <Input label="备注" placeholder="晚餐、交通、房租..." />
            <Input error="金额不能为空" label="金额" placeholder="0.00" prefix="¥" />
            <AmountInput
              label="业务金额"
              onMicrosChange={() => undefined}
              onValueChange={setAmount}
              value={amount}
            />
            <div className="dev-row">
              <MoneyText amountMicros="-128500000" />
              <MoneyText amountMicros="9800000000" showPositiveSign />
              <MoneyText amountMicros="0" tone="muted" />
            </div>
          </section>

          <section className="dev-section">
            <h2>开关</h2>
            <div className="dev-control-row">
              <div className="dev-control-copy">
                <strong>预算提醒</strong>
                <span>超过本月预算时提醒</span>
              </div>
              <Switch checked={budgetAlert} label="预算提醒" onCheckedChange={setBudgetAlert} />
            </div>
            <div className="dev-control-row">
              <div className="dev-control-copy">
                <strong>自动归档</strong>
                <span>不可用状态示例</span>
              </div>
              <Switch checked={false} disabled label="自动归档" />
            </div>
          </section>

          <section className="dev-section">
            <h2>选择组件</h2>
            <SelectField
              label="列表类型"
              onValueChange={setListType}
              options={[
                { label: "标准", value: "standard" },
                { label: "日常采购", value: "shopping" },
                { label: "智能列表", value: "smart" },
              ]}
              value={listType}
            />
            <TransactionTypeSwitch onValueChange={setType} value={type} />
            <CategoryPicker
              onValueChange={setCategoryId}
              options={categoryOptions}
              value={categoryId}
            />
            <AccountPicker onValueChange={setAccountId} options={accountOptions} value={accountId} />
            <PersonPicker onValueChange={setPersonId} options={personOptions} value={personId} />
            <DateWheelPicker onValueChange={setDate} value={date} />
            <MonthWheelPicker onValueChange={setMonth} value={month} />
            <FilterBar
              onOpen={() => setFilterOpen(true)}
              onReset={() => setFilter({ timePreset: "month", type: "all" })}
              value={filter}
            />
          </section>

          <section className="dev-section">
            <h2>Tab 切换</h2>
            <Tabs
              items={[
                { label: "日", value: "first" },
                { label: "月", value: "second" },
                { label: "年", value: "third" },
              ]}
              onValueChange={setPlainTab}
              value={plainTab}
            />
          </section>

          <section className="dev-section">
            <h2>导航</h2>
            <NavigationBar
              action={<IconButton icon={<Settings size={18} />} label="设置" />}
              title="账单"
              variant="inline"
            />
            <TabBar items={tabItems} onValueChange={setTab} value={tab} />
          </section>

          <section className="dev-section">
            <h2>玻璃材质</h2>
            <GlassSegmentedControl
              items={typeItems}
              onValueChange={(nextValue) => setType(nextValue as TransactionType)}
              value={type}
            />
            <div className="dev-row">
              <GlassButton icon={<Plus size={17} />} tone="primary">
                记一笔
              </GlassButton>
              <GlassButton tone="neutral">筛选</GlassButton>
            </div>
            <GlassMenu
              items={[
                {
                  label: "快捷记账",
                  icon: <Plus size={16} />,
                  onSelect: () => showToast({ message: "已选择快捷记账" }),
                },
                {
                  label: "提醒设置",
                  icon: <Bell size={16} />,
                  onSelect: () => showToast({ message: "已选择提醒设置" }),
                },
              ]}
            />
          </section>

          <section className="dev-section">
            <h2>Sheet / Toast</h2>
            <div className="dev-row">
              <Button onClick={() => setPlainSheetOpen(true)} variant="secondary">
                普通 Sheet
              </Button>
              <GlassButton onClick={() => setGlassSheetOpen(true)} tone="neutral">
                玻璃 Sheet
              </GlassButton>
              <Button onClick={openStackLevelOne} variant="ghost">
                Sheet 栈
              </Button>
            </div>
          </section>

          <section className="dev-section">
            <h2>交易列表</h2>
            <TransactionGroup dateLabel="6月27日 周六" incomeMicros="0" totalMicros="-211000000">
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  amountMicros="-5000000"
                  categoryColor="#ff8a3d"
                  categoryIcon="coffee"
                  categoryName="咖啡"
                  icon="☕️"
                  recordName="启杰_记"
                  title="咖啡"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  amountMicros="-8000000"
                  categoryColor="#ff8a3d"
                  categoryIcon="food"
                  categoryName="吃饭"
                  icon="🍛"
                  recordName="启杰_记"
                  title="吃饭"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  amountMicros="-26000000"
                  categoryColor="#ff8a3d"
                  categoryIcon="food"
                  categoryName="吃饭"
                  icon="🍛"
                  recordName="启杰_记"
                  title="吃饭"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  accountName="沙县充值"
                  amountMicros="-98000000"
                  categoryColor="#ff8a3d"
                  categoryIcon="food"
                  categoryName="吃饭"
                  icon="🍛"
                  recordName="启杰_记"
                  title="吃饭"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  amountMicros="-39000000"
                  categoryColor="#ff8a3d"
                  categoryIcon="wear"
                  categoryName="美发"
                  icon="💇‍♀️"
                  recordName="启杰_记"
                  title="美发"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
            </TransactionGroup>
            <TransactionGroup dateLabel="6月26日 周五" incomeMicros="0" totalMicros="-73000000">
              <SwipeActionRow actions={transactionActions}>
                <TransactionRow
                  accountName="家庭"
                  amountMicros="-73000000"
                  categoryColor="#0a84ff"
                  categoryIcon="home"
                  categoryName="基金"
                  icon="⌛️"
                  recordName="启杰_记"
                  title="基金"
                  type="expense"
                  onClick={() => showToast({ message: "打开记录详情" })}
                />
              </SwipeActionRow>
            </TransactionGroup>
          </section>

          <section className="dev-section">
            <h2>附件与关联</h2>
            <AttachmentPicker
              enabled={attachmentEnabled}
              items={attachmentItems}
              onEnabledChange={setAttachmentEnabled}
              onFilesSelected={(files) => showToast({ message: `选择了 ${files.length} 个文件` })}
              onOpen={(item) => showToast({ message: `打开 ${item.name}` })}
              onRemove={(id) => showToast({ message: `移除 ${id}` })}
            />
            <RecoverablePayableEditor
              accountOptions={accountOptions}
              enabled={recoverableEnabled}
              hint="这笔支出中可向他人收回的部分，打开后选择项目并填写金额"
              items={recoverableItems}
              label="可收回"
              onChange={setRecoverableItems}
              onEnabledChange={setRecoverableEnabled}
            />
          </section>

          <section className="dev-section">
            <h2>数据展示</h2>
            <AccountBalanceCard
              balanceMicros="1280000000"
              icon={<span aria-hidden>💵</span>}
              name="现金"
              subtitle="储蓄账户"
            />
            <PlanLimitCard
              endDate="2026-06-30"
              limitMicros="8000000000"
              name="月限额"
              startDate="2026-06-01"
              usedMicros="1431000000"
            />
            <PlanLimitCard
              endDate="2026-12-31"
              limitMicros="150000000000"
              name="年限额"
              startDate="2026-01-01"
              usedMicros="28520000000"
            />
            <TrendChart
              points={[
                { label: "1月", valueMicros: "2800000000" },
                { label: "2月", valueMicros: "3600000000" },
                { label: "3月", valueMicros: "2200000000" },
                { label: "4月", valueMicros: "4200000000", highlight: true },
              ]}
            />
            {statsDrill ? (
              <Button onClick={() => setStatsDrill(null)} variant="secondary">
                返回分类占比
              </Button>
            ) : null}
            <CategoryRingChart
              onSegmentClick={(segment) => {
                setStatsDrill(segment.label);
                showToast({ message: `下钻到 ${segment.label}` });
              }}
              segments={statsDrill ? chartSegments.filter((segment) => segment.label === statsDrill) : chartSegments}
              title={statsDrill ? `${statsDrill}明细` : "分类占比"}
            />
            <EmptyState
              action={<Button icon={<ShoppingBag size={16} />}>去添加</Button>}
              title="还没有记录"
              message="这里会展示当前条件下的业务数据。"
            />
            <LoadingState />
          </section>

          <div className="dev-tab-preview">
            <TabBar items={tabItems} onValueChange={setTab} value={tab} />
          </div>
        </div>
      </MobilePage>

      <Sheet
        onClose={() => setPlainSheetOpen(false)}
        open={plainSheetOpen}
        title="普通 Bottom Sheet"
      >
        <div className="dev-sheet-content">
          <p>用于基础 UI 的可读实底弹层。</p>
          <Button onClick={() => setPlainSheetOpen(false)}>完成</Button>
        </div>
      </Sheet>

      <GlassBottomSheet
        onClose={() => setGlassSheetOpen(false)}
        open={glassSheetOpen}
        title="玻璃 Bottom Sheet"
      >
        <div className="dev-sheet-content">
          <p>玻璃层在 Safari/Firefox 会自动降级为可读的 CSS fallback。</p>
          <GlassSegmentedControl
            items={typeItems}
            onValueChange={(nextValue) => setType(nextValue as TransactionType)}
            value={type}
          />
        </div>
      </GlassBottomSheet>

      <FilterSheet
        accountOptions={accountOptions}
        categoryOptions={categoryOptions}
        creatorOptions={personOptions}
        fields={["type", "category", "dateRange", "account", "person", "creator", "amountRange", "keyword"]}
        onApply={() => showToast({ message: "筛选已应用" })}
        onChange={setFilter}
        onOpenChange={setFilterOpen}
        onReset={() => setFilter({ timePreset: "month", type: "all" })}
        open={filterOpen}
        personOptions={personOptions}
        value={filter}
      />
    </MobileAppShell>
  );
}
