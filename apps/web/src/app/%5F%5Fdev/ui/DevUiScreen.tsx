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
  Plus,
  Settings,
  WalletCards,
  X,
} from "lucide-react";
import {
  GlassBottomSheet,
  GlassButton,
  GlassIconButton,
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

export function DevUiScreen() {
  const [tab, setTab] = useState("bills");
  const [type, setType] = useState("expense");
  const [listType, setListType] = useState("standard");
  const [budgetAlert, setBudgetAlert] = useState(true);
  const [plainTab, setPlainTab] = useState("first");
  const [plainSheetOpen, setPlainSheetOpen] = useState(false);
  const [glassSheetOpen, setGlassSheetOpen] = useState(false);
  const { showToast } = useToast();
  const sheetStack = useSheetStack();

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
      <MobilePage
        action={<GlassIconButton icon={<Settings size={18} />} label="设置" />}
        title="组件预览"
      >
        <div className="dev-ui">
          <section className="dev-section">
            <h2>按钮</h2>
            <div className="dev-row">
              <ActionButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" />
              <ActionButton icon={<Check size={24} strokeWidth={2.6} />} label="确认" tone="primary" />
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
                onClick={() => showToast({ title: "保存成功", message: "这是一条 Toast。", tone: "success" })}
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
            <GlassSegmentedControl items={typeItems} onValueChange={setType} value={type} />
            <div className="dev-row">
              <GlassButton icon={<Plus size={17} />} tone="primary">
                记一笔
              </GlassButton>
              <GlassButton tone="neutral">筛选</GlassButton>
            </div>
            <GlassMenu
              items={[
                { label: "快捷记账", icon: <Plus size={16} />, onSelect: () => showToast({ message: "已选择快捷记账" }) },
                { label: "提醒设置", icon: <Bell size={16} />, onSelect: () => showToast({ message: "已选择提醒设置" }) },
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

          <div className="dev-tab-preview">
            <TabBar items={tabItems} onValueChange={setTab} value={tab} />
          </div>
        </div>
      </MobilePage>

      <Sheet onClose={() => setPlainSheetOpen(false)} open={plainSheetOpen} title="普通 Bottom Sheet">
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
          <GlassSegmentedControl items={typeItems} onValueChange={setType} value={type} />
        </div>
      </GlassBottomSheet>
    </MobileAppShell>
  );
}
