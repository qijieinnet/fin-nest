"use client";

import { Button } from "@/components/ui";
import {
  getApiErrorMessage,
  type AgentChangeRequest,
  type AgentChangeRequestKind,
  type AgentChangeSummaryRow,
} from "@/lib/api";
import {
  useDecideAgentChangeRequest,
  usePendingAgentChangeRequests,
} from "@/lib/data/agent-tokens";
import { localized, msg, t } from "@/lib/i18n";
import { formatDetailMoney } from "@/lib/money";
import { useConfirm, useLedger, useToast } from "@/providers";

const KIND_LABELS: Record<AgentChangeRequestKind, string> = localized({
  "transaction.update": msg("修改交易"),
  "transaction.delete": msg("删除交易"),
  "account.adjust": msg("调整余额"),
});

const FIELD_LABELS: Record<string, string> = localized({
  amount: msg("金额"),
  occurredOn: msg("日期"),
  category: msg("分类"),
  account: msg("账户"),
  fromAccount: msg("转出账户"),
  toAccount: msg("转入账户"),
  person: msg("人员"),
  note: msg("备注"),
  balance: msg("余额"),
  adjustKind: msg("调整类型"),
});

const TYPE_LABELS: Record<string, string> = localized({
  expense: msg("支出"),
  income: msg("收入"),
  transfer: msg("转账"),
});

const ADJUST_KIND_LABELS: Record<string, string> = localized({
  revaluation: msg("市值涨跌"),
  principal: msg("本金存取"),
});

const MONEY_FIELDS = new Set(["amount", "balance"]);

function rowValue(row: AgentChangeSummaryRow, value: string | null): string {
  if (value === null || value === "") return t("空");
  if (MONEY_FIELDS.has(row.field)) return formatDetailMoney(value, row.currency);
  if (row.field === "adjustKind") return ADJUST_KIND_LABELS[value] ?? value;
  return value;
}

function targetLine(request: AgentChangeRequest): string {
  const target = request.summary.target;
  if (request.kind === "account.adjust") {
    return [target.account, target.subAccount].filter(Boolean).join(" / ");
  }
  return [
    target.occurredOn,
    target.type ? (TYPE_LABELS[target.type] ?? target.type) : null,
    target.amountMicros ? formatDetailMoney(target.amountMicros, target.currency) : null,
    target.note || target.category,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 待批准的智能体变更申请（改/删已入账交易、调整余额）。批准即执行，所以每条都摆出前后对比
 * 与智能体给的理由，再弹一次确认；目标在申请后被改过时后端会拒绝，这里只展示错误。
 */
export function AgentChangeRequestsSection() {
  const { currentLedger } = useLedger();
  const ledgerId = currentLedger?.id ?? null;
  const requestsQuery = usePendingAgentChangeRequests(ledgerId);
  const decide = useDecideAgentChangeRequest(ledgerId);
  const confirm = useConfirm();
  const { showToast } = useToast();

  const requests = requestsQuery.data ?? [];
  if (requests.length === 0) return null;

  const handleApprove = async (request: AgentChangeRequest) => {
    const ok = await confirm({
      title: t("批准{kind}", { kind: KIND_LABELS[request.kind] }),
      message:
        request.kind === "transaction.delete"
          ? t("批准后这笔交易会被删除，账户流水随之冲正。")
          : request.kind === "account.adjust"
            ? t("批准后账户余额会改为申请中的金额，并生成一条余额调整记录。")
            : t("批准后这笔交易会按对比中的内容修改，账户流水随之重算。"),
      confirmText: t("批准"),
      tone: request.kind === "transaction.delete" ? "danger" : undefined,
    });
    if (!ok) return;
    try {
      await decide.mutateAsync({ requestId: request.id, action: "approve" });
      showToast({ tone: "success", message: t("已批准并执行") });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  const handleReject = async (request: AgentChangeRequest) => {
    try {
      await decide.mutateAsync({ requestId: request.id, action: "reject" });
      showToast({ tone: "success", message: t("已驳回") });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  return (
    <>
      <span className="mt-1 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
        {t("待批准的变更申请 · {count}", { count: requests.length })}
      </span>
      {requests.map((request) => (
        <section
          className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]"
          key={request.id}
        >
          <div className="flex items-baseline justify-between gap-3">
            <strong className="text-[15.5px] text-[var(--color-text-primary)]">
              {KIND_LABELS[request.kind] ?? request.kind}
            </strong>
            <span className="min-w-0 truncate text-xs text-[var(--color-text-muted)]">
              {request.sourceLabel
                ? t("智能体「{name}」", { name: request.sourceLabel })
                : t("智能体")}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">{targetLine(request)}</p>

          {request.summary.rows.length > 0 ? (
            <dl className="mt-3 flex flex-col gap-1.5">
              {request.summary.rows.map((row) => (
                <div className="flex items-start gap-3 text-[13.5px]" key={row.field}>
                  <dt className="w-16 shrink-0 text-[var(--color-text-muted)]">
                    {FIELD_LABELS[row.field] ?? row.field}
                  </dt>
                  <dd className="min-w-0 flex-1 break-words text-[var(--color-text-primary)]">
                    {row.before !== null || request.kind !== "account.adjust" ? (
                      <>
                        <span className="text-[var(--color-text-muted)] line-through">
                          {rowValue(row, row.before)}
                        </span>
                        {" → "}
                      </>
                    ) : null}
                    <span>{rowValue(row, row.after)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[13.5px] text-[var(--color-text-primary)]">
              {t("申请删除这笔交易")}
            </p>
          )}

          {request.reason ? (
            <p className="mt-3 text-[13px] leading-5 text-[var(--color-text-muted)]">
              {t("理由：{reason}", { reason: request.reason })}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => void handleReject(request)}
              variant="secondary"
            >
              {t("驳回")}
            </Button>
            <Button
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => void handleApprove(request)}
              variant={request.kind === "transaction.delete" ? "danger" : "primary"}
            >
              {t("批准")}
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}
