"use client";

import { Check, ChevronDown, LoaderCircle, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format/class-names";
import { groupMoneyDisplay } from "@/lib/money";
import {
  applyKeypadKey,
  keypadDisplayValue,
  keypadExpressionText,
  keypadHasPendingOperation,
  keypadStateFromValue,
  type KeypadKey,
  type KeypadState,
} from "./keypad-expression";
import { NumericPanel } from "./NumericPanel";

/** 键盘页签。amount 恒在首位，其余按记账设置的字段顺序动态生成。 */
export type KeypadTabId = "amount" | "category" | "account" | "person" | "date";

export type KeypadTab = {
  id: KeypadTabId;
  /** 未选中时显示字段名，选中后显示值。 */
  label: string;
  value?: string;
  panel: ReactNode;
};

type AmountKeypadProps = {
  amount: string;
  canSubmit: boolean;
  decimalPlaces: number;
  onAmountChange: (value: string) => void;
  onClose: () => void;
  /** 快捷记账入口：键盘展开时 FAB 让位，它的功能搬到这里。 */
  onQuickTemplates?: () => void;
  onSubmit: () => void;
  /** 把日期设回今天。仅在存在日期页签时展示（转账下键盘只有金额页签）。 */
  onToday?: () => void;
  open: boolean;
  /** amount 之外的页签，由调用方按 orderedFieldsForType + visibleFields 组装。 */
  tabs: KeypadTab[];
  submitting?: boolean;
};

export function AmountKeypad({
  amount,
  canSubmit,
  decimalPlaces,
  onAmountChange,
  onClose,
  onQuickTemplates,
  onSubmit,
  onToday,
  open,
  submitting = false,
  tabs,
}: AmountKeypadProps) {
  const [activeTab, setActiveTab] = useState<KeypadTabId>("amount");
  const [state, setState] = useState<KeypadState>(() => keypadStateFromValue(amount));
  const rootRef = useRef<HTMLDivElement>(null);
  // onClose 由调用方内联创建，每次按键都换新引用；存进 ref 才不会每敲一下就重挂监听。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 点键盘外部即收起——与页签行右端的收起按钮互为备份，必须可靠。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || rootRef.current?.contains(target)) return;
      // 金额展示区负责重新展开，层叠在键盘之上的 sheet / 弹出菜单也不算「外部」，
      // 否则点分类的「更多」弹层或快捷记账弹层会把身下的键盘一并关掉。
      if (target.closest(".biz-amount, .sheet-root, .ui-popover-menu")) return;
      onCloseRef.current();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // 状态机的最新值同时存进 ref：
  //   1. 「00」键会在同一个事件里连按两次 onKey，闭包里的 state 第二次已过期；
  //   2. 提交更新必须在事件回调里做，不能塞进 setState 的 updater——那个函数由 React
  //      在 render 阶段调用，在里面调父组件的 setAmount 就是「渲染 A 时更新 B」。
  const stateRef = useRef(state);
  const commitState = (next: KeypadState) => {
    stateRef.current = next;
    setState(next);
  };

  // 表单侧改了金额（选快捷模板、连续记账清空）时重建状态机，
  // 但不要覆盖键盘自己刚写出去的值——那会打断正在输入的表达式。
  useEffect(() => {
    if (keypadDisplayValue(stateRef.current, decimalPlaces) === amount) return;
    // commitState 只写 ref 与 setState，不需要进依赖数组。
    commitState(keypadStateFromValue(amount));
  }, [amount, decimalPlaces]);

  // 键盘收起时回到金额页签：下次展开总是从「输金额」开始。
  useEffect(() => {
    if (!open) setActiveTab("amount");
  }, [open]);

  const handleKey = (key: KeypadKey) => {
    const next = applyKeypadKey(stateRef.current, key, { decimalPlaces });
    commitState(next);
    onAmountChange(keypadDisplayValue(next, decimalPlaces));
  };

  const allTabs = useMemo<KeypadTab[]>(
    () => [
      {
        id: "amount",
        label: "金额",
        value: amount ? `¥${groupMoneyDisplay(amount)}` : undefined,
        panel: (
          <NumericPanel
            decimalPlaces={decimalPlaces}
            expressionText={keypadExpressionText(state, decimalPlaces)}
            hasPendingOperation={keypadHasPendingOperation(state)}
            onKey={handleKey}
          />
        ),
      },
      ...tabs,
    ],
    // handleKey 依赖 state，随 state 一起重建即可。
    [amount, decimalPlaces, state, tabs],
  );

  const active = allTabs.find((tab) => tab.id === activeTab) ?? allTabs[0];

  // 必须 portal 到 body：祖先 .mobile-page 带入场动画（transform: translateY），
  // 而**任何**带 transform 的祖先都会让后代的 position: fixed 改为相对该祖先定位——
  // 键盘会被钉在整页内容的底部而不是视口底部，进页面那 220ms 直接飞出屏幕。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={cn("amount-keypad", open && "amount-keypad--open")}
      ref={rootRef}
    >
      <div className="amount-keypad__tabs">
        <div className="amount-keypad__tab-scroll">
          {allTabs.map((tab) => (
            <button
              aria-selected={tab.id === active?.id}
              className={cn(
                "amount-keypad__tab",
                tab.id === active?.id && "amount-keypad__tab--active",
              )}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <span className="amount-keypad__tab-name">{tab.label}</span>
              {tab.value ? <strong className="amount-keypad__tab-value">{tab.value}</strong> : null}
            </button>
          ))}
        </div>
        {/* 收起按钮固定在页签行右端（不进 __tab-scroll，页签再多也不会被滚走）。 */}
        <button
          aria-label="收起键盘"
          className="amount-keypad__collapse"
          onClick={onClose}
          title="收起"
          type="button"
        >
          <ChevronDown size={20} />
        </button>
      </div>

      {/* 操作区：高度固定，切页签时底部不跳，各面板内部自滚。 */}
      <div className="amount-keypad__body">
        <div className="amount-keypad__panel">{active?.panel}</div>
      </div>

      {/* 底部动作条在操作区之外，因此切到任何页签都在：左侧快捷记账、右侧保存。 */}
      <div className="amount-keypad__actions">
        <div className="amount-keypad__actions-lead">
          {onQuickTemplates ? (
            <button
              aria-label="快捷记账"
              className="amount-keypad__action"
              onClick={onQuickTemplates}
              title="快捷记账"
              type="button"
            >
              <Zap size={20} />
            </button>
          ) : null}
          {/* 只在日期页签下出现：它作用于日期，挂在别的页签上既看不出会改什么，
              按下去的效果也在屏幕外。快捷记账与保存的位置不受影响——
              前者左对齐、后者右对齐，中间增删不会让它们移动。 */}
          {onToday && active?.id === "date" ? (
            <button
              className="amount-keypad__action amount-keypad__action--text"
              onClick={onToday}
              type="button"
            >
              今天
            </button>
          ) : null}
        </div>

        <button
          aria-disabled={!canSubmit ? true : undefined}
          className={cn("amount-keypad__submit", !canSubmit && "amount-keypad__submit--idle")}
          disabled={submitting}
          onClick={onSubmit}
          type="button"
        >
          {submitting ? (
            <LoaderCircle className="ui-button__spinner" size={18} />
          ) : (
            <>
              <Check size={18} strokeWidth={2.8} />
              <span>保存</span>
            </>
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}
