import { describe, expect, it } from "vitest";
import {
  applyKeypadKey,
  EMPTY_KEYPAD_STATE,
  keypadDisplayValue,
  keypadExpressionText,
  keypadHasPendingOperation,
  type KeypadKey,
  type KeypadState,
} from "./keypad-expression";

/** 用一串按键描述测试意图："12.5+7.5=" 比逐个构造 KeypadKey 可读得多。 */
function press(sequence: string, decimalPlaces = 2, from: KeypadState = EMPTY_KEYPAD_STATE) {
  let state = from;
  for (const char of sequence) {
    const key: KeypadKey =
      char === "+" || char === "-"
        ? { kind: "operator", value: char }
        : char === "="
          ? { kind: "equals" }
          : char === "."
            ? { kind: "dot" }
            : char === "<"
              ? { kind: "backspace" }
              : char === "C"
                ? { kind: "clear" }
                : { kind: "digit", value: char };
    state = applyKeypadKey(state, key, { decimalPlaces });
  }
  return state;
}

function value(sequence: string, decimalPlaces = 2): string {
  return keypadDisplayValue(press(sequence, decimalPlaces), decimalPlaces);
}

describe("金额键盘表达式", () => {
  it("按 bigint micros 做加减，不经浮点", () => {
    expect(value("12.5+7.5=")).toBe("20.00");
    // 0.1 + 0.2 在 IEEE754 下是 0.30000000000000004。
    expect(value("0.1+0.2=")).toBe("0.30");
    expect(value("1234.05+0.95=")).toBe("1235.00");
  });

  it("每按一次运算符先结算左侧，支持连续运算", () => {
    expect(value("1+2+3=")).toBe("6.00");
    expect(value("10-3-2=")).toBe("5.00");
    expect(value("100-200+150=")).toBe("50.00");
  });

  it("不按等号时显示值就是当前结算结果", () => {
    // 输到一半（"12.5+7"）时表单拿到的应该是 19.50，而不是 7。
    expect(value("12.5+7")).toBe("19.50");
    expect(value("12.5+")).toBe("12.50");
  });

  it("允许中间结果为负，由表单校验拦截而不是键盘拒绝", () => {
    expect(value("100-200=")).toBe("-100.00");
    expect(value("100-200+150=")).toBe("50.00");
  });

  it("按账本小数位约束输入", () => {
    expect(value("12.345", 2)).toBe("12.34");
    expect(value("12.345", 3)).toBe("12.345");
    // 0 位小数的账本没有小数点可按。
    expect(value("12.5", 0)).toBe("125");
  });

  it("规范化前导零与小数点", () => {
    expect(value("05")).toBe("5");
    expect(value(".5")).toBe("0.5");
    expect(value("1..5")).toBe("1.5");
  });

  it("退格逐位删除，删空后撤销运算符并放回累计值", () => {
    expect(value("128<")).toBe("12");
    const afterOp = press("12+");
    expect(keypadHasPendingOperation(afterOp)).toBe(true);
    const undone = applyKeypadKey(afterOp, { kind: "backspace" }, { decimalPlaces: 2 });
    expect(keypadHasPendingOperation(undone)).toBe(false);
    const restored = applyKeypadKey(undone, { kind: "backspace" }, { decimalPlaces: 2 });
    expect(restored.entry).toBe("12.00");
  });

  it("清空回到初始状态", () => {
    expect(press("12+7C")).toEqual(EMPTY_KEYPAD_STATE);
    expect(value("12+7C")).toBe("");
  });

  it("连按运算符只改方向，不产生空段", () => {
    expect(value("5+-3=")).toBe("2.00");
  });

  it("表达式回显只在有待结算运算时出现", () => {
    expect(keypadExpressionText(press("12"), 2)).toBe("");
    expect(keypadExpressionText(press("12+"), 2)).toBe("12.00 +");
    expect(keypadExpressionText(press("12+7"), 2)).toBe("12.00 + 7");
    expect(keypadExpressionText(press("12+7="), 2)).toBe("");
  });

  it("表达式与金额区用同一套千分位", () => {
    expect(keypadExpressionText(press("12300+6"), 2)).toBe("12,300.00 + 6");
    expect(keypadExpressionText(press("1234567+1000"), 2)).toBe("1,234,567.00 + 1,000");
  });

  it("等号后可继续参与下一段运算", () => {
    const afterEquals = press("12+8=");
    expect(keypadDisplayValue(afterEquals, 2)).toBe("20.00");
    expect(keypadDisplayValue(press("+5=", 2, afterEquals), 2)).toBe("25.00");
  });
});
