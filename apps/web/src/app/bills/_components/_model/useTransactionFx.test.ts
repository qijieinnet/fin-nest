import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/api";
import { useTransactionFx, type FxInitial } from "./useTransactionFx";

// 汇率固定 1 USD = 7 CNY，不走网络；mockRates.ready = false 模拟「汇率还没返回」。
const mockRates = vi.hoisted(() => ({ ready: true }));
vi.mock("@/lib/data/fx", () => ({
  useFxRate: (_ledgerId: string, from: string | null, to: string | null) => ({
    data:
      mockRates.ready && from === "USD" && to === "CNY"
        ? { from, to, date: "2026-10-01", rate: "7", source: "manual" }
        : null,
    isFetching: !mockRates.ready,
  }),
}));

function account(id: string, currency: string): Account {
  return {
    id,
    ledgerId: "l",
    type: "savings",
    name: id,
    icon: null,
    personId: null,
    person: null,
    currency,
    balanceMicros: "0",
    baseBalanceMicros: null,
    fxRate: null,
    includeInNetWorth: true,
    creditLimitMicros: null,
    investment: null,
    counterparty: null,
    dueDate: null,
    billDay: null,
    repayDay: null,
    settledAt: null,
    sortOrder: 0,
    archivedAt: null,
    subAccounts: [],
  };
}

const accounts = [account("cny", "CNY"), account("usd", "USD"), account("cny2", "CNY")];

function useHarness(
  initial: FxInitial | null,
  accountSel: string | null,
  accountsLoaded = true,
  transfer?: { from: string; to: string },
  initialAmount?: string,
  toOverride?: string,
) {
  const [amount, setAmount] = useState(
    initialAmount ?? (initial?.grossAmountMicros ? "80.00" : ""),
  );
  const fx = useTransactionFx({
    ledgerId: "l",
    type: transfer ? "transfer" : "expense",
    accounts,
    accountsLoaded,
    accountEnabled: accountSel !== null,
    accountSel,
    fromSel: transfer?.from ?? null,
    toSel: toOverride ?? transfer?.to ?? null,
    occurredOn: "2026-10-01",
    amount,
    setAmount,
    baseCurrency: "CNY",
    ledgerDecimalPlaces: 2,
    initial,
  });
  return { fx, amount, setAmount };
}

describe("useTransactionFx", () => {
  const stored: FxInitial = {
    grossAmountMicros: "80000000",
    originalCurrency: "USD",
    originalAmountMicros: "10000000",
  };

  it("keeps the stored base amount when editing (does not re-convert at today's rate)", async () => {
    const { result } = renderHook(() => useHarness(stored, "cny"));
    await waitFor(() => expect(result.current.fx.entryCurrency).toBe("USD"));
    expect(result.current.amount).toBe("10.00");
    const built = result.current.fx.buildFx();
    expect(built).toEqual({
      ok: true,
      value: {
        grossInput: "80.00",
        fields: { originalCurrency: "USD", originalAmountMicros: "10000000" },
      },
    });
  });

  it("re-converts once the user changes the foreign amount", async () => {
    const { result } = renderHook(() => useHarness(stored, "cny"));
    await waitFor(() => expect(result.current.amount).toBe("10.00"));
    act(() => result.current.setAmount("20"));
    await waitFor(() => expect(result.current.fx.baseAmount).toBe("140.00"));
  });

  it("follows a newly selected foreign account and books the account currency", async () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(null, sel), {
      initialProps: { sel: "cny" as string | null },
    });
    rerender({ sel: "usd" });
    await waitFor(() => expect(result.current.fx.entryCurrency).toBe("USD"));
    act(() => result.current.setAmount("20"));
    await waitFor(() => expect(result.current.fx.baseAmount).toBe("140.00"));
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value.fields).toEqual({
      originalCurrency: "USD",
      originalAmountMicros: "20000000",
    });
  });

  it("keeps the stored base amount when accounts finish loading later", async () => {
    const { result, rerender } = renderHook(({ loaded }) => useHarness(stored, "cny", loaded), {
      initialProps: { loaded: false },
    });
    rerender({ loaded: true });
    await waitFor(() => expect(result.current.amount).toBe("10.00"));
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value.grossInput).toBe("80.00");
  });

  it("keeps stored amounts when editing a USD → CNY transfer", async () => {
    const { result } = renderHook(() => useHarness(stored, null, true, { from: "usd", to: "cny" }));
    await waitFor(() => expect(result.current.amount).toBe("10.00"));
    expect(result.current.fx.baseAmount).toBe("80.00");
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value).toEqual({
      grossInput: "80.00",
      fields: { originalCurrency: "USD", originalAmountMicros: "10000000" },
    });
  });

  it("keeps the stored received amount when editing a CNY → USD transfer", async () => {
    const { result } = renderHook(() => useHarness(stored, null, true, { from: "cny", to: "usd" }));
    await waitFor(() => expect(result.current.fx.sideCurrency).toBe("USD"));
    await waitFor(() => expect(result.current.fx.sideAmount).toBe("10.00"));
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value).toEqual({
      grossInput: "80.00",
      fields: { originalCurrency: "USD", originalAmountMicros: "10000000" },
    });
  });

  it("still converts a template whose estimate equals the foreign amount text", async () => {
    // 回显不改变任何 state（金额本来就是 10.00）：自动折算也必须补上，不能一直空着。
    const template: FxInitial = {
      grossAmountMicros: "10000000",
      originalCurrency: "USD",
      originalAmountMicros: "10000000",
      fxRecompute: true,
    };
    const { result } = renderHook(() => useHarness(template, "usd", true, undefined, "10.00"));
    await waitFor(() => expect(result.current.fx.baseAmount).toBe("70.00"));
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value.grossInput).toBe("70.00");
  });

  it("recomputes the base amount of a CNY → USD transfer template from the foreign side", async () => {
    const template: FxInitial = {
      grossAmountMicros: "80000000",
      originalCurrency: "USD",
      originalAmountMicros: "10000000",
      fxRecompute: true,
    };
    const { result } = renderHook(() =>
      useHarness(template, null, true, { from: "cny", to: "usd" }),
    );
    await waitFor(() => expect(result.current.amount).toBe("70.00"));
    expect(result.current.fx.sideAmount).toBe("10.00");
    const built = result.current.fx.buildFx();
    expect(built.ok && built.value).toEqual({
      grossInput: "70.00",
      fields: { originalCurrency: "USD", originalAmountMicros: "10000000" },
    });
  });

  it("does not let a late exchange rate overwrite an amount the user already changed", async () => {
    mockRates.ready = false;
    try {
      const template: FxInitial = {
        grossAmountMicros: "80000000",
        originalCurrency: "USD",
        originalAmountMicros: "10000000",
        fxRecompute: true,
      };
      const { result, rerender } = renderHook(() =>
        useHarness(template, null, true, { from: "cny", to: "usd" }),
      );
      await waitFor(() => expect(result.current.fx.pendingRecompute).not.toBeNull());
      // 等汇率期间不能按估算值提交。
      expect(result.current.fx.buildFx().ok).toBe(false);
      act(() => result.current.setAmount("90"));
      await waitFor(() => expect(result.current.fx.pendingRecompute).toBeNull());
      mockRates.ready = true;
      rerender();
      // 汇率回来了也不再反推：金额保持用户填的 ¥90。
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current.amount).toBe("90");
      expect(result.current.fx.pendingRecompute).toBeNull();
    } finally {
      mockRates.ready = true;
    }
  });

  it("keeps the user's amount when the edit and the late rate land in the same render", async () => {
    mockRates.ready = false;
    try {
      const template: FxInitial = {
        grossAmountMicros: "80000000",
        originalCurrency: "USD",
        originalAmountMicros: "10000000",
        fxRecompute: true,
      };
      const { result } = renderHook(() =>
        useHarness(template, null, true, { from: "cny", to: "usd" }),
      );
      await waitFor(() => expect(result.current.fx.pendingRecompute).not.toBeNull());
      act(() => {
        mockRates.ready = true;
        result.current.setAmount("90");
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current.amount).toBe("90");
      expect(result.current.fx.pendingRecompute).toBeNull();
    } finally {
      mockRates.ready = true;
    }
  });

  it("drops the template recompute when the destination account changes in the same render", async () => {
    mockRates.ready = false;
    try {
      const template: FxInitial = {
        grossAmountMicros: "80000000",
        originalCurrency: "USD",
        originalAmountMicros: "10000000",
        fxRecompute: true,
      };
      const { result, rerender } = renderHook(
        ({ to }) => useHarness(template, null, true, { from: "cny", to: "usd" }, undefined, to),
        { initialProps: { to: "usd" } },
      );
      await waitFor(() => expect(result.current.fx.pendingRecompute).not.toBeNull());
      act(() => {
        mockRates.ready = true;
        rerender({ to: "cny2" });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current.amount).toBe("80.00");
      expect(result.current.fx.pendingRecompute).toBeNull();
    } finally {
      mockRates.ready = true;
    }
  });
});
