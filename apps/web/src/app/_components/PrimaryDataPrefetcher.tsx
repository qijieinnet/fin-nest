"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { defaultFilterValue } from "@/lib/data/filter-types";
import { prefetchPrimaryLedgerData } from "@/lib/data/records";
import { useAuth, useDecimalPlaces, useLedger } from "@/providers";
import {
  currentMonthKey,
  filterToQuery,
  timeRangeFromFilter,
} from "../bills/_components/bill-utils";

/**
 * 登录且选定账本后，空闲时预取主导航 tab 的首屏数据（见 prefetchPrimaryLedgerData），
 * 首次切 tab 直接渲染缓存而非转菊花。挂在根 layout 的 AppProviders 内，全局仅一份。
 * 账单列表的查询 key 含筛选条件，这里用与账单页完全相同的工具函数构造默认筛选，
 * 保证 key 精确命中。
 */
export function PrimaryDataPrefetcher() {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { ledgerId } = useLedger();
  const decimalPlaces = useDecimalPlaces();

  useEffect(() => {
    // 未确认登录态前不预取：会话失效时发请求只会得到一串 401。
    if (status !== "authenticated" || !ledgerId) return;
    const run = () => {
      const billsQuery = {
        ...filterToQuery(defaultFilterValue, decimalPlaces),
        ...timeRangeFromFilter(defaultFilterValue),
      };
      void prefetchPrimaryLedgerData(queryClient, ledgerId, billsQuery, currentMonthKey());
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 500);
    return () => window.clearTimeout(id);
  }, [queryClient, status, ledgerId, decimalPlaces]);

  return null;
}
