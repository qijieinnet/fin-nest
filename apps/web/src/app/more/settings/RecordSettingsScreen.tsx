"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type EntryReminderInput,
  type RecordSetting,
} from "@/lib/api";
import { useRecordSetting } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useToast } from "@/providers";
import { EntryReminderCard } from "./_components/EntryReminderCard";
import { FieldSortList } from "./_components/FieldSortList";

/** PATCH 的入参：普通设置项按原样合并，记账提醒是部分字段的嵌套 patch。 */
type SettingPatch = Partial<Omit<RecordSetting, "entryReminder">> & {
  entryReminder?: EntryReminderInput;
};

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
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();
  const settingQuery = useRecordSetting(ledgerId);
  const [sortMode, setSortMode] = useState(false);

  const setting = settingQuery.data;

  const update = useMutation({
    mutationFn: (patch: SettingPatch) => {
      const body = {
        fieldOrder: patch.fieldOrder,
        visibleFields: patch.visibleFields,
        acctRequired: patch.acctRequired,
        personRequired: patch.personRequired,
        continuousEntry: patch.continuousEntry,
        keypadAutoOpen: patch.keypadAutoOpen,
        entryReminder: patch.entryReminder,
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
        // 记账提醒的乐观更新交给 EntryReminderCard 自己的草稿：它的 patch 是「部分字段」，
        // 且 notifyUserIds ≠ notifyTargets，塞进缓存反而会写出一份形状不对的值。
        const { entryReminder: _entryReminder, ...rest } = patch;
        queryClient.setQueryData<RecordSetting>(queryKeys.recordSetting(ledgerId), {
          ...previous,
          ...rest,
        });
      }
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (ledgerId && context?.previous) {
        queryClient.setQueryData(queryKeys.recordSetting(ledgerId), context.previous);
      }
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败") });
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
                <span className="text-[13px] font-semibold text-[var(--color-text-muted)]">
                  字段
                </span>
                <button
                  className="text-[15px] font-medium text-[var(--color-tint)]"
                  onClick={() => setSortMode((value) => !value)}
                  type="button"
                >
                  {sortMode ? "完成" : "排序"}
                </button>
              </div>
              {/* <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                {sortMode
                  ? "按住右侧图标拖动调整记账页面的字段顺序。"
                  : "开关控制字段是否在记账页面展示，点「排序」可调整顺序。"}
              </p> */}

              {sortMode ? (
                <FieldSortList
                  fields={orderable.flatMap((key) => {
                    const meta = FIELD_META[key];
                    return meta ? [{ key, name: meta.name, icon: meta.icon }] : [];
                  })}
                  onReorder={persistOrder}
                />
              ) : (
                <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                  <ul className="divide-y divide-black/[0.06]">
                    {orderable.map((key) => {
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
                          {toggleable ? (
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
              )}

              {/* <button
                className="self-start px-1 text-sm font-medium text-[var(--color-tint)]"
                onClick={resetFields}
                type="button"
              >
                重置
              </button> */}

              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                必填校验
              </span>
              {/* <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                设为必填后，记账页面默认展开该字段。
              </p> */}
              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3 px-4 py-[15px] shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">
                    账户必填
                  </span>
                  <Switch
                    checked={setting.acctRequired}
                    label="账户必填"
                    onCheckedChange={(checked) => update.mutate({ acctRequired: checked })}
                  />
                </div>
                <div className="flex items-center gap-3 px-4 py-[15px]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">
                    人员必填
                  </span>
                  <Switch
                    checked={setting.personRequired}
                    label="人员必填"
                    onCheckedChange={(checked) => update.mutate({ personRequired: checked })}
                  />
                </div>
              </section>

              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                记账体验
              </span>

              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3 px-4 py-[15px]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">
                    连续记账
                    {/* <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      开启后，在新建记账页面提交后不自动关闭，并清空金额、备注等输入，保留日期、分类、人员，方便连续记账。
                    </p> */}
                  </span>
                  <Switch
                    checked={setting.continuousEntry}
                    label="连续记账"
                    onCheckedChange={(checked) => update.mutate({ continuousEntry: checked })}
                  />
                </div>
                <span className="mx-4 block h-px bg-[var(--color-border-subtle)]" />
                <div className="flex items-center gap-3 px-4 py-[15px]">
                  <span className="flex-1 text-[15.5px] text-[var(--color-text-primary)]">
                    自动展开金额键盘
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      进入记账页即弹出金额键盘。关闭时点金额区域再展开。
                    </p>
                  </span>
                  <Switch
                    checked={setting.keypadAutoOpen}
                    label="自动展开金额键盘"
                    onCheckedChange={(checked) => update.mutate({ keypadAutoOpen: checked })}
                  />
                </div>
              </section>

              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                记账提醒
              </span>
              <EntryReminderCard
                ledgerId={ledgerId!}
                onChange={(patch) => update.mutate({ entryReminder: patch })}
                value={setting.entryReminder}
              />
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
