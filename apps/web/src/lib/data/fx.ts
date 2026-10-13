"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest, type FxOverview, type FxQuote, ledgerApiPath } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * 某天 from→to 的汇率（to 缺省为账本本币）。from === to 时不发请求，直接给 1。
 * 后端取不到时 quote 为 null：表单据此提示「去补汇率」并让用户手填折合金额。
 */
export function useFxRate(
  ledgerId: string | null,
  from: string | null,
  to: string | null,
  date: string,
) {
  const same = Boolean(from && to && from === to);
  return useQuery({
    queryKey: queryKeys.fxRate(ledgerId ?? "none", from ?? "", to ?? "", date),
    queryFn: async () => {
      const result = await apiRequest<{ quote: FxQuote | null }>(
        ledgerApiPath(ledgerId!, "/fx/rate"),
        { query: { from: from!, ...(to ? { to } : {}), date } },
      );
      return result.quote;
    },
    enabled: Boolean(ledgerId && from && to) && !same,
    staleTime: 10 * 60_000,
  });
}

export function useFxOverview(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.fxRates(ledgerId ?? "none"),
    queryFn: () => apiRequest<FxOverview>(ledgerApiPath(ledgerId!, "/fx/rates")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}
