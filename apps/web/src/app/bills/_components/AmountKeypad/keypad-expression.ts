import { groupMoneyDisplay, microsToInput, parseMoneyToMicros } from "@/lib/money";

/**
 * 金额键盘的表达式状态机。
 *
 * 只支持加减：记账里的真实场景是 AA 分摊与多件商品累加，乘除极少，
 * 而一旦引入除法就必须定义舍入口径——那是唯一会和「金额禁止 number 计算」正面冲突的地方。
 * 加减全程走 bigint micros，无舍入、无精度损失。
 */
export type KeypadOperator = "+" | "-";

export type KeypadState = {
  /** 正在输入的那一段数字（显示态字符串，可能是 "" 或 "12."）。 */
  entry: string;
  /** 已结算的累计值。null 表示还没有累计段。 */
  settledMicros: bigint | null;
  /** 待应用到下一段的运算符。 */
  pendingOp: KeypadOperator | null;
};

export type KeypadKey =
  | { kind: "digit"; value: string }
  | { kind: "dot" }
  | { kind: "operator"; value: KeypadOperator }
  | { kind: "equals" }
  | { kind: "backspace" }
  | { kind: "clear" };

export type KeypadOptions = {
  decimalPlaces: number;
};

export const EMPTY_KEYPAD_STATE: KeypadState = {
  entry: "",
  settledMicros: null,
  pendingOp: null,
};

/** 从一个已有的显示值（编辑既有交易、快捷模板预填）恢复状态机。 */
export function keypadStateFromValue(value: string): KeypadState {
  return { ...EMPTY_KEYPAD_STATE, entry: value };
}

function entryToMicros(entry: string, decimalPlaces: number): bigint | null {
  if (!entry || entry === "." || entry === "-") return null;
  // 允许负的中间结果（100 − 200 + 150 是合法路径），最终为负由表单校验拦截。
  const parsed = parseMoneyToMicros(entry, { allowNegative: true, decimalPlaces });
  return parsed.ok ? BigInt(parsed.amountMicros) : null;
}

/** 把当前 entry 并入 settledMicros，返回合并后的累计值。 */
function settle(state: KeypadState, decimalPlaces: number): bigint | null {
  const entryMicros = entryToMicros(state.entry, decimalPlaces);
  if (entryMicros === null) return state.settledMicros;
  if (state.settledMicros === null) return entryMicros;
  return state.pendingOp === "-"
    ? state.settledMicros - entryMicros
    : state.settledMicros + entryMicros;
}

function appendDigit(entry: string, digit: string, decimalPlaces: number): string {
  const dotIndex = entry.indexOf(".");
  if (dotIndex >= 0) {
    // 小数段已满：多按的数字直接丢弃，而不是让它进去再被校验拒绝。
    if (entry.length - dotIndex - 1 >= decimalPlaces) return entry;
    return entry + digit;
  }
  // 前导零：0 后按数字替换掉那个 0（"0" + "5" → "5"），但 "0." 不受影响。
  if (entry === "0") return digit;
  return entry + digit;
}

export function applyKeypadKey(
  state: KeypadState,
  key: KeypadKey,
  { decimalPlaces }: KeypadOptions,
): KeypadState {
  switch (key.kind) {
    case "digit":
      return { ...state, entry: appendDigit(state.entry, key.value, decimalPlaces) };

    case "dot": {
      // 0 位小数的账本没有小数段可言；已经有小数点也不再插第二个。
      if (decimalPlaces <= 0 || state.entry.includes(".")) return state;
      return { ...state, entry: state.entry === "" ? "0." : `${state.entry}.` };
    }

    case "operator": {
      const settled = settle(state, decimalPlaces);
      // 连按运算符只改方向，不产生空段（"5 + -" 应当等价于 "5 -"）。
      if (settled === null) return { ...state, pendingOp: state.entry ? key.value : state.pendingOp };
      return { entry: "", settledMicros: settled, pendingOp: key.value };
    }

    case "equals": {
      const settled = settle(state, decimalPlaces);
      if (settled === null) return state;
      return {
        entry: microsToInput(settled, { decimalPlaces, omitZeroFraction: false }),
        settledMicros: null,
        pendingOp: null,
      };
    }

    case "backspace": {
      if (state.entry) return { ...state, entry: state.entry.slice(0, -1) };
      // entry 已空：退格撤销待应用的运算符，把累计值放回 entry 继续编辑。
      if (state.pendingOp) return { ...state, pendingOp: null };
      if (state.settledMicros !== null) {
        return {
          entry: microsToInput(state.settledMicros, { decimalPlaces, omitZeroFraction: false }),
          settledMicros: null,
          pendingOp: null,
        };
      }
      return state;
    }

    case "clear":
      return EMPTY_KEYPAD_STATE;
  }
}

/** 表单实际要保存的值：有未结算的表达式时取结算结果，否则就是 entry。 */
export function keypadDisplayValue(state: KeypadState, decimalPlaces: number): string {
  if (state.settledMicros === null) return state.entry;
  const settled = settle(state, decimalPlaces);
  if (settled === null) return state.entry;
  return microsToInput(settled, { decimalPlaces, omitZeroFraction: false });
}

/** 键区上方那行表达式回显；没有待结算的运算时返回空串（不占位）。 */
export function keypadExpressionText(state: KeypadState, decimalPlaces: number): string {
  if (state.settledMicros === null || !state.pendingOp) return "";
  // 与金额区同一套千分位，否则「12,306」和「12300 + 6」两行对不上。
  const left = groupMoneyDisplay(
    microsToInput(state.settledMicros, { decimalPlaces, omitZeroFraction: false }),
  );
  return `${left} ${state.pendingOp} ${groupMoneyDisplay(state.entry)}`.trimEnd();
}

/** 是否还有未结算的运算——「完成」键据此显示 = 还是提交。 */
export function keypadHasPendingOperation(state: KeypadState): boolean {
  return state.settledMicros !== null && state.pendingOp !== null;
}
