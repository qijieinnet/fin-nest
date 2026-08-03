"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/format/class-names";
import type { KeypadKey } from "./keypad-expression";

type NumericPanelProps = {
  decimalPlaces: number;
  expressionText: string;
  /** 无待结算运算时 = 键置灰：没有东西可求值。 */
  hasPendingOperation: boolean;
  onKey: (key: KeypadKey) => void;
};

type KeySpec = {
  id: string;
  label: string;
  ariaLabel?: string;
  icon?: "backspace";
  variant?: "function";
  key: KeypadKey;
  /** 长按（右键）时的替代动作，目前只有退格 → 清空。 */
  longPress?: KeypadKey;
};

const digit = (value: string): KeySpec => ({
  id: value,
  label: value,
  key: { kind: "digit", value },
});

/**
 * 键位按**行**声明，不是「先所有数字再所有功能键」。
 * 网格是 4 列、按 DOM 顺序逐行填充的，扁平顺序会把功能键挤到最后一行、
 * 数字整体左移错位——渲染出来就是一堆乱序数字。
 */
export const KEY_ROWS: KeySpec[][] = [
  [
    digit("7"),
    digit("8"),
    digit("9"),
    {
      id: "backspace",
      label: "",
      ariaLabel: "退格",
      icon: "backspace",
      variant: "function",
      key: { kind: "backspace" },
      longPress: { kind: "clear" },
    },
  ],
  [
    digit("4"),
    digit("5"),
    digit("6"),
    { id: "minus", label: "−", ariaLabel: "减", variant: "function", key: { kind: "operator", value: "-" } },
  ],
  [
    digit("1"),
    digit("2"),
    digit("3"),
    { id: "plus", label: "+", ariaLabel: "加", variant: "function", key: { kind: "operator", value: "+" } },
  ],
  [
    { id: "dot", label: ".", ariaLabel: "小数点", key: { kind: "dot" } },
    digit("0"),
    // "00" 直接压两次 0，复用同一条约束链（小数位满了自然被拦）。
    { id: "double-zero", label: "00", key: { kind: "digit", value: "0" }, longPress: undefined },
    { id: "equals", label: "=", ariaLabel: "求值", variant: "function", key: { kind: "equals" } },
  ],
];

/** 数字键区。提交与快捷记账在外壳底部那一排，切页签也看得见。 */
export function NumericPanel({
  decimalPlaces,
  expressionText,
  hasPendingOperation,
  onKey,
}: NumericPanelProps) {
  const isDisabled = (spec: KeySpec) =>
    (spec.id === "dot" && decimalPlaces <= 0) || (spec.id === "equals" && !hasPendingOperation);

  return (
    <div className="amount-keypad__numeric">
      {/* 表达式行常驻占位，避免出现/消失时键区上下跳动。 */}
      <div aria-live="polite" className="amount-keypad__expression">
        {expressionText}
      </div>

      <div className="amount-keypad__keys">
        {KEY_ROWS.flat().map((spec) => (
          <button
            aria-label={spec.ariaLabel}
            className={cn(
              "amount-keypad__key",
              spec.variant === "function" && "amount-keypad__key--function",
            )}
            disabled={isDisabled(spec)}
            key={spec.id}
            onClick={() => {
              onKey(spec.key);
              // "00" 是两次 0，第二次在同一处理链里再压一遍。
              if (spec.id === "double-zero") onKey(spec.key);
            }}
            onContextMenu={
              spec.longPress
                ? (event) => {
                    event.preventDefault();
                    onKey(spec.longPress!);
                  }
                : undefined
            }
            type="button"
          >
            {spec.icon === "backspace" ? <Delete size={20} /> : spec.label}
          </button>
        ))}
      </div>
    </div>
  );
}
