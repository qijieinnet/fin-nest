"use client";

import { Ban, ChevronRight, Edit3, RotateCcw, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/business";
import { Button } from "@/components/ui";
import type { Person } from "@/lib/api";
import { useInsurance } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { InsuranceTransactionList } from "./InsuranceTransactionList";
import {
  formatDateLabel,
  formatMoney,
  insuranceStatus,
  insuranceTypeMeta,
  premiumFreqLabel,
  renewalLabel,
} from "./insurance-utils";

type InsuranceDetailSheetProps = {
  insuranceId: string;
  ledgerId: string;
  onDelete: () => void;
  onEdit: () => void;
  onResume: () => void;
  onTerminate: () => void;
  people: Person[];
  resuming?: boolean;
  terminating?: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  expired: "bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]",
  terminated: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex-1 text-[15px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="min-w-0 max-w-[62%] truncate text-right text-[15px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

export function InsuranceDetailSheet({
  insuranceId,
  ledgerId,
  onDelete,
  onEdit,
  onResume,
  onTerminate,
  people,
  resuming = false,
  terminating = false,
}: InsuranceDetailSheetProps) {
  const { push } = useSheetStack();
  const detailQuery = useInsurance(ledgerId, insuranceId);
  const insurance = detailQuery.data;

  if (!insurance) {
    return <LoadingState rows={5} title="加载保单" />;
  }

  const openLinkedTransactions = () => {
    push({
      title: "关联记账",
      content: (
        <InsuranceTransactionList
          emptyText="还没有关联的记账，记账时打开「关联保险」即可归入此保单"
          ledgerId={ledgerId}
          transactions={insurance.linkedTransactions}
        />
      ),
    });
  };

  const meta = insuranceTypeMeta(insurance.type);
  const status = insuranceStatus(insurance);
  const insuredNames = insurance.insuredPeople
    .map((entry) => people.find((person) => person.id === entry.personId)?.name)
    .filter(Boolean)
    .join("、");
  const premiumLabel = insurance.premiumFreq === "single" ? "保费" : premiumFreqLabel(insurance.premiumFreq);
  const linked = insurance.linkedTransactions;

  return (
    <div className="flex w-full flex-col gap-4 pb-2">
      <div className="flex items-center gap-3 rounded-[22px] bg-[var(--color-bg-surface)] p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--color-control-fill-muted)] text-[26px]">
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[19px] text-[var(--color-text-primary)]">{insurance.name}</strong>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--color-text-muted)]">
            {meta.label}
            {insurance.insurer ? ` · ${insurance.insurer}` : ""}
          </span>
        </span>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status.tone]}`}>
          {status.label}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-muted)]">保额</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">
            {formatMoney(insurance.coverageMicros)}
          </div>
        </div>
        <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-muted)]">{premiumLabel}</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">
            {formatMoney(insurance.premiumMicros)}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">保单信息</h3>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
          <DetailRow label="险种" value={meta.label} />
          {insurance.insurer ? <DetailRow label="保险公司" value={insurance.insurer} /> : null}
          {insuredNames ? <DetailRow label="被保人" value={insuredNames} /> : null}
          {insurance.method ? <DetailRow label="投保方式" value={insurance.method} /> : null}
          {insurance.policyNo ? <DetailRow label="保单号" value={insurance.policyNo} /> : null}
          <DetailRow label="缴费周期" value={premiumFreqLabel(insurance.premiumFreq)} />
          {insurance.periods ? <DetailRow label="缴费期数" value={`${insurance.periods} 期`} /> : null}
          {insurance.premiumFreq !== "single" && insurance.renewal ? (
            <DetailRow label="续费" value={renewalLabel(insurance.renewal)} />
          ) : null}
          <DetailRow label="生效日" value={formatDateLabel(insurance.startDate)} />
          <DetailRow label="到期日" value={formatDateLabel(insurance.endDate)} />
        </div>
      </section>

      {insurance.coverageDesc ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">保障内容</h3>
          <div className="whitespace-pre-wrap rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {insurance.coverageDesc}
          </div>
        </section>
      ) : null}

      {insurance.note ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">备注</h3>
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {insurance.note}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">关联记账</h3>
        <button
          className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
          onClick={openLinkedTransactions}
          type="button"
        >
          <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
            关联记账
            {linked.length > 0 ? (
              <span className="ml-2 text-[13px] text-[var(--color-text-muted)]">
                合计 {formatMoney(insurance.totalExpenseMicros)}
              </span>
            ) : null}
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text-secondary)]">
            {linked.length} 条
          </span>
          <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
        </button>
      </section>

      <div className="mt-2 flex flex-col gap-2">
        <Button
          className="!bg-[var(--color-bg-surface)]"
          icon={<Edit3 size={17} />}
          onClick={onEdit}
          variant="secondary"
        >
          编辑保单
        </Button>
        {status.key === "active" ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={terminating}
            icon={<Ban size={17} />}
            onClick={onTerminate}
            variant="secondary"
          >
            {terminating ? "处理中…" : "终止续保"}
          </Button>
        ) : null}
        {insurance.terminatedAt ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={resuming}
            icon={<RotateCcw size={17} />}
            onClick={onResume}
            variant="secondary"
          >
            {resuming ? "处理中…" : "恢复保单"}
          </Button>
        ) : null}
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          icon={<Trash2 size={17} />}
          onClick={onDelete}
          variant="danger"
        >
          删除保单
        </Button>
      </div>
    </div>
  );
}
