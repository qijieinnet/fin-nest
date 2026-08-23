"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { PopoverMenu } from "@/components/ui";
import type { NotifyChannel, NotifyTarget } from "@/lib/api";

/**
 * 「推送给谁」的多选行。订阅/保单档位、自动记账规则、记账提醒四处共用。
 *
 * 选的是**人**，不是渠道：走飞书还是浏览器通知由接收人自己在「更多 › 通知」里决定。
 * 因此这里不出现任何渠道开关，只在选项与提示里说明「这个人现在收得到吗」——
 * 选了一个既没绑飞书、也没开浏览器通知的人，是这套配置里唯一会静默失效的情形，
 * 必须当场看得见。
 */
export function NotifyTargetsRow({
  candidates,
  label = "推送给",
  loading,
  onToggle,
  values,
}: {
  candidates: ReadonlyArray<NotifyTarget>;
  label?: string;
  loading?: boolean;
  onToggle: (userId: string) => void;
  values: string[];
}) {
  const [open, setOpen] = useState(false);
  const selected = candidates.filter((candidate) => values.includes(candidate.userId));
  const isEmpty = candidates.length === 0;
  const display = isEmpty
    ? loading
      ? "加载中…"
      : "无可选成员"
    : selected.length > 0
      ? selected.map((candidate) => candidate.alias).join("、")
      : "不推送";

  // 选中了但一条渠道都不通的人。后端会静默跳过他们，这里必须点名。
  const unreachable = selected.filter((candidate) => candidate.channels.length === 0);

  return (
    <>
      <div className="relative">
        <button
          className="transaction-form__select-row"
          disabled={isEmpty}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{label}</span>
          <strong>{display}</strong>
          <ChevronRight size={18} />
        </button>
        <PopoverMenu
          groups={[
            candidates.map((candidate) => ({
              label: optionLabel(candidate),
              onSelect: () => onToggle(candidate.userId),
              selected: values.includes(candidate.userId),
            })),
          ]}
          onOpenChange={setOpen}
          open={open}
        />
      </div>
      {unreachable.length > 0 ? (
        <p className="px-1 text-xs text-[var(--color-accent-warning)]">
          {unreachable.map((candidate) => candidate.alias).join("、")}
          {" 当前收不到推送（未绑定飞书、也未开启浏览器通知）。"}
        </p>
      ) : null}
    </>
  );
}

const CHANNEL_LABELS: Record<NotifyChannel, string> = {
  feishu: "飞书",
  webpush: "通知",
};

/** 「张三 · 飞书/通知」；一条都不通时标出来，避免选了才发现收不到。 */
function optionLabel(candidate: NotifyTarget): string {
  if (candidate.channels.length === 0) return `${candidate.alias}（收不到）`;
  return `${candidate.alias} · ${candidate.channels.map((channel) => CHANNEL_LABELS[channel]).join("/")}`;
}

export function toggleUserId(values: string[], userId: string): string[] {
  return values.includes(userId) ? values.filter((item) => item !== userId) : [...values, userId];
}
