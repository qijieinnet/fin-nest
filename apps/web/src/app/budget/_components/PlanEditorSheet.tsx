"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { DateWheelPicker } from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Plan,
  type PlanKind,
  type PlanMatchRule,
  type PlanMetric,
  type PlanRepeatRule,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { useAccounts, useCategories, usePeople } from "@/lib/data/records";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { microsToInput, REPEAT_OPTIONS, todayKey } from "./plan-utils";

type PlanEditorSheetProps = {
  defaultKind?: PlanKind;
  ledgerId: string;
  plan?: Plan;
};

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
          : "bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Section({ children, hint, title }: { children: React.ReactNode; hint?: string; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{title}</h3>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">{children}</div>
      {hint ? <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">{hint}</p> : null}
    </section>
  );
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function PlanEditorSheet({ defaultKind = "expense", ledgerId, plan }: PlanEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(plan);

  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);

  const [kind, setKind] = useState<PlanKind>(plan?.kind ?? defaultKind);
  const [metric, setMetric] = useState<PlanMetric>(plan?.metric ?? "amount");
  const [name, setName] = useState(plan?.name ?? "");
  const [limitAmount, setLimitAmount] = useState(() => microsToInput(plan?.limitAmountMicros));
  const [limitCount, setLimitCount] = useState(plan?.limitCount ? String(plan.limitCount) : "");
  const [startDate, setStartDate] = useState(plan?.startDate.slice(0, 10) ?? todayKey());
  const [repeatRule, setRepeatRule] = useState<PlanRepeatRule>(plan?.repeatRule ?? "monthly");
  const [categoryIds, setCategoryIds] = useState<string[]>(plan?.matchRule?.categoryIds ?? []);
  const [accountIds, setAccountIds] = useState<string[]>(plan?.matchRule?.accountIds ?? []);
  const [personIds, setPersonIds] = useState<string[]>(plan?.matchRule?.personIds ?? []);
  const [noteContains, setNoteContains] = useState(plan?.matchRule?.noteContains ?? "");

  const categories = (categoriesQuery.data ?? []).filter((category) => category.type === kind);
  const accounts = (accountsQuery.data ?? []).filter((account) =>
    ["savings", "credit", "invest"].includes(account.type),
  );
  const people = peopleQuery.data ?? [];

  const save = useMutation({
    mutationFn: async () => {
      let limitAmountMicros: string | undefined;
      let limitCountValue: number | undefined;
      if (metric === "amount") {
        const parsed = parseMoneyToMicros(limitAmount);
        if (!parsed.ok || BigInt(parsed.amountMicros) <= 0n) throw new Error("请填写大于 0 的金额");
        limitAmountMicros = parsed.amountMicros;
      } else {
        limitCountValue = Number.parseInt(limitCount, 10);
        if (!Number.isInteger(limitCountValue) || limitCountValue < 1) throw new Error("请填写大于 0 的次数");
      }

      const matchRule: PlanMatchRule = {};
      // 分类换了收支方向后可能残留另一方向的选择，按当前方向过滤后写入。
      const validCategoryIds = categoryIds.filter((id) => categories.some((category) => category.id === id));
      if (validCategoryIds.length) matchRule.categoryIds = validCategoryIds;
      if (accountIds.length) matchRule.accountIds = accountIds;
      if (personIds.length) matchRule.personIds = personIds;
      if (noteContains.trim()) matchRule.noteContains = noteContains.trim();

      const body = {
        kind,
        metric,
        name: name.trim() || (kind === "income" ? "收入目标" : "支出限额"),
        limitAmountMicros,
        limitCount: limitCountValue,
        startDate,
        repeatRule,
        matchRule,
      };
      return plan
        ? apiRequest<Plan>(ledgerApiPath(ledgerId, `/plans/${plan.id}`), { method: "PATCH", body })
        : apiRequest<Plan>(ledgerApiPath(ledgerId, "/plans"), { method: "POST", body });
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, saved.id) }),
      ]);
      showToast({ tone: "success", message: isEditing ? "计划已更新" : "计划已创建" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑计划" : "新计划"}
        </h2>
        <IconButton
          disabled={save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存计划"
          variant="primary"
          type="submit"
        />
      </div>

      <div>
        <Input
          aria-label="行动代号"
          label="行动代号"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="选填，如 拿铁基金"
          value={name}
        />
        <p className="mt-1.5 px-1 text-xs leading-5 text-[var(--color-text-muted)]">
          行动代号是可选的，添加行动代号能有助提高计划执行力。
        </p>
      </div>

      <Section title="目的">
        <div className="flex flex-wrap gap-2">
          <Chip active={kind === "expense"} label="支出限额" onClick={() => setKind("expense")} />
          <Chip active={kind === "income"} label="收入目标" onClick={() => setKind("income")} />
        </div>
      </Section>

      <Section title={`${kind === "income" ? "收入" : "支出"}目标`}>
        <div className="flex flex-col gap-3">
          <div className="flex h-9 rounded-full bg-[var(--color-control-fill-muted)] p-[3px]">
            {(
              [
                { value: "amount", label: "金额" },
                { value: "count", label: "次数" },
              ] as const
            ).map((option) => (
              <button
                className={cn(
                  "flex-1 rounded-full text-sm font-semibold transition-all",
                  metric === option.value
                    ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
                    : "text-[var(--color-text-secondary)]",
                )}
                key={option.value}
                onClick={() => setMetric(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {metric === "amount" ? (
            <Input
              inputMode="decimal"
              label="金额"
              onChange={(event) => setLimitAmount(event.target.value)}
              placeholder="0"
              prefix="¥"
              value={limitAmount}
            />
          ) : (
            <Input
              inputMode="numeric"
              label="次数"
              onChange={(event) => setLimitCount(event.target.value)}
              placeholder="0"
              value={limitCount}
            />
          )}
        </div>
      </Section>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <DateWheelPicker label="开始日期" onValueChange={setStartDate} value={startDate} />
        <div className="flex flex-col gap-1.5">
          <span className="ui-field__label px-0.5">重复</span>
          <div className="flex flex-wrap gap-2">
            {REPEAT_OPTIONS.map((option) => (
              <Chip
                active={repeatRule === option.value}
                key={option.value}
                label={option.label}
                onClick={() => setRepeatRule(option.value)}
              />
            ))}
          </div>
        </div>
      </div>

      <Section
        hint="不设置过滤条件时，统计该方向的全部记账；设置后仅统计命中的记账。"
        title="过滤条件 · 选填"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="ui-field__label px-0.5">分类</span>
            {categories.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">暂无分类</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Chip
                    active={categoryIds.includes(category.id)}
                    key={category.id}
                    label={`${category.icon ?? ""}${category.name}`}
                    onClick={() => setCategoryIds((current) => toggleId(current, category.id))}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="ui-field__label px-0.5">账户</span>
            {accounts.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">暂无账户</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((account) => (
                  <Chip
                    active={accountIds.includes(account.id)}
                    key={account.id}
                    label={account.name}
                    onClick={() => setAccountIds((current) => toggleId(current, account.id))}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="ui-field__label px-0.5">人员</span>
            {people.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">暂无人员</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {people.map((person) => (
                  <Chip
                    active={personIds.includes(person.id)}
                    key={person.id}
                    label={person.name}
                    onClick={() => setPersonIds((current) => toggleId(current, person.id))}
                  />
                ))}
              </div>
            )}
          </div>
          <Input
            label="备注包含"
            maxLength={80}
            onChange={(event) => setNoteContains(event.target.value)}
            placeholder="选填，如 咖啡"
            value={noteContains}
          />
        </div>
      </Section>
    </form>
  );
}
