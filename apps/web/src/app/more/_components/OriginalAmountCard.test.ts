import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useOriginalAmount } from "./OriginalAmountCard";

const mockRates = vi.hoisted(() => ({ ready: false }));
vi.mock("@/lib/data/fx", () => ({
  useFxRate: (_ledgerId: string, from: string | null) => ({
    data:
      mockRates.ready && from === "USD"
        ? { from, to: "CNY", date: "2026-10-01", rate: "7", source: "manual" }
        : null,
    isFetching: !mockRates.ready,
  }),
}));
vi.mock("@/providers", () => ({
  useBaseCurrency: () => ({ code: "CNY", symbol: "¥" }),
  useDecimalPlaces: () => 2,
}));

function useHarness() {
  const [base, setBase] = useState("");
  const original = useOriginalAmount({
    initialCurrency: null,
    initialMicros: null,
    ledgerId: "l",
    baseValue: base,
    onSuggestBase: setBase,
  });
  return { base, setBase, original };
}

describe("useOriginalAmount", () => {
  it("fills the base estimate from today's rate", () => {
    mockRates.ready = true;
    const { result } = renderHook(() => useHarness());
    act(() => result.current.original.setCurrency("USD"));
    act(() => result.current.original.setAmount("10"));
    expect(result.current.base).toBe("70");
  });

  it("does not overwrite a hand-typed estimate when the rate arrives late", () => {
    mockRates.ready = false;
    const { result, rerender } = renderHook(() => useHarness());
    act(() => result.current.original.setCurrency("USD"));
    act(() => result.current.original.setAmount("10"));
    act(() => result.current.setBase("80"));
    act(() => {
      mockRates.ready = true;
    });
    rerender();
    expect(result.current.base).toBe("80");
  });
});
