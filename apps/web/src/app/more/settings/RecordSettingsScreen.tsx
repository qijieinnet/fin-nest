"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type RecordSetting,
} from "@/lib/api";
import { useRecordSetting } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useToast } from "@/providers";

// 记账页面可调整展示/顺序的字段（type/amount 固定在顶部，不参与配置）。
const FIELD_META: Record<string, { name: string; icon: string }> = {
  category: { name: "分类", icon: "🏷️" },
  account: { name: "账户", icon: "💳" },
  date: { name: "日期", icon: "📅" },
  person: { name: "人员", icon: "👥" },
  note: { name: "备注", icon: "📝" },
};
const ORDERABLE_KEYS = ["category", "account", "date", "person", "note"];
const TOGGLEABLE_KEYS = new Set(["account", "person", "note"]);
const DEFAULT_ORDER = ["category", "account", "date", "person", "note"];

/** 从 fieldOrder 里取出可配置字段（去掉 type/amount，并补齐缺失项）。 */
function orderableFrom(fieldOrder: string[] | undefined): string[] {
  const known = (fieldOrder ?? []).filter((key) => ORDERABLE_KEYS.includes(key));
  const missing = DEFAULT_ORDER.filter((key) => !known.includes(key));
  return known.length > 0 ? [...known, ...missing] : DEFAULT_ORDER;
}

export function RecordSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();
  const settingQuery = useRecordSetting(ledgerId);
  const [sortMode, setSortMode] = useState(false);

  const setting = settingQuery.data;

  const update = useMutation({
    mutationFn: (patch: Partial<RecordSetting>) => {
      const body = {
        fieldOrder: patch.fieldOrder,
        visibleFields: patch.visibleFields,
        acctRequired: patch.acctRequired,
        personRequired: patch.personRequired,
      };
      return apiRequest<RecordSetting>(ledgerApiPath(ledgerId!, "/record-setting"), {
        method: "PATCH",
        body,
      });
    },
    onMutate: async (patch) => {
      if (!ledgerId) return {};
      await queryClient.cancelQueries({ queryKey: queryKeys.recordSetting(ledgerId) });
      const previous = queryClient.getQueryData<RecordSetting>(queryKeys.recordSetting(ledgerId));
      if (previous) {
        queryClient.setQueryData<RecordSetting>(queryKeys.recordSetting(ledgerId), {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (ledgerId && context?.previous) {
        queryClient.setQueryData(queryKeys.recordSetting(ledgerId), context.previous);
      }
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
    onSettled: () => {
      if (ledgerId) queryClient.invalidateQueries({ queryKey: queryKeys.recordSetting(ledgerId) });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const orderable = orderableFrom(setting?.fieldOrder);
  const visibleFields = setting?.visibleFields ?? {};

  const persistOrder = (nextOrderable: string[]) => {
    update.mutate({ fieldOrder: ["type", "amount", ...nextOrderable] });
  };

  const toggleVisible = (key: string) => {
    if (!setting) return;
    update.mutate({
      visibleFields: { ...setting.visibleFields, [key]: visibleFields[key] === false },
    });
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderable.length) return;
    const next = [...orderable];
    [next[index], next[target]] = [next[target]!, next[index]!];
    persistOrder(next);
  };

  const resetFields = () => {
    setSortMode(false);
    update.mutate({
      fieldOrder: ["type", "amount", ...DEFAULT_ORDER],
      visibleFields: { ...setting?.visibleFields, account: true, person: true, note: true },
    });
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="调整记账页面展示哪些字段、以什么顺序展示，以及必填校验。"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="记账设置"
      >
        <div className="flex flex-col gap-3 pb-6">
          {settingQuery.isPending || !setting ? (
            <LoadingState rows={5} title="加载记账设置" />
          ) : (
            <>
              <div className="flex items-end justify-between px-1">
                <span className="text-[13px] font-semibold text-[var(--color-text-muted)]">字段</span>
                <button
                  className="text-[15px] font-medium text-[var(--color-tint)]"
                  onClick={() => setSortMode((value) => !value)}
                  type="button"
                >
                  {sortMode ? "完成" : "排序"}
                </button>
              </div>
              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                {sortMode
                  ? "用右侧箭头调整记账页面的字段顺序。"
                  : "开关控制字段是否在记账页面展示，点「排序」可调整顺序。"}
              </p>

              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <ul className="divide-y divide-black/[0.06]">
                  {orderable.map((key, index) => {
                    const meta = FIELD_META[key];
                    if (!meta) return null;
                    const toggleable = TOGGLEABLE_KEYS.has(key);
                    const visible = visibleFields[key] !== false;
                    return (
                      <li className="flex items-center gap-3 px-4 py-[15px]" key={key}>
                        <span className="w-6 text-center text-lg">{meta.icon}</span>
                        <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">
                          {meta.name}
                        </span>
                        {sortMode ? (
                          <div className="flex items-center gap-1">
                            <button
                              aria-label={`上移${meta.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)] disabled:opacity-35"
                              disabled={index === 0 || update.isPending}
                              onClick={() => moveField(index, -1)}
                              type="button"
                            >
                              <ChevronUp size={17} />
                            </button>
                            <button
                              aria-label={`下移${meta.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)] disabled:opacity-35"
                              disabled={index === orderable.length - 1 || update.isPending}
                              onClick={() => moveField(index, 1)}
                              type="button"
                            >
                              <ChevronDown size={17} />
                            </button>
                          </div>
                        ) : toggleable ? (
                          <Switch
                            checked={visible}
                            label={`${visible ? "隐藏" : "显示"}${meta.name}`}
                            onCheckedChange={() => toggleVisible(key)}
                          />
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">常驻</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <button
                className="self-start px-1 text-sm font-medium text-[var(--color-tint)]"
                onClick={resetFields}
                type="button"
              >
                重置
              </button>

              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                必填校验
              </span>
              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                设为必填后，记账页面默认展开该字段。
              </p>
              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3 px-4 py-[15px] shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">账户必填</span>
                  <Switch
                    checked={setting.acctRequired}
                    label="账户必填"
                    onCheckedChange={(checked) => update.mutate({ acctRequired: checked })}
                  />
                </div>
                <div className="flex items-center gap-3 px-4 py-[15px]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">人员必填</span>
                  <Switch
                    checked={setting.personRequired}
                    label="人员必填"
                    onCheckedChange={(checked) => update.mutate({ personRequired: checked })}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
