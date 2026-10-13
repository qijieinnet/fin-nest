"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/business";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type FxQuote } from "@/lib/api";
import { currencyLabel } from "@/lib/data/currency-names";
import { useFxOverview } from "@/lib/data/fx";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";
import { FxRateEditorSheet } from "./_components/FxRateEditorSheet";
import { t } from "@/lib/i18n";

function sourceLabel(source: FxQuote["source"]): string {
  if (source === "manual") return t("手填");
  if (source === "frankfurter") return t("欧洲央行");
  return "";
}

/**
 * 汇率（多币种方案 §6）：看本账本在用外币的最新汇率，手填 / 覆盖 / 删除手填记录。
 * 自动获取的汇率是全局的、只读；手填只影响本账本，且同一天优先于自动获取。
 */
export function FxRatesScreen() {
  const router = useAppRouter();
  const { ledgerId } = useLedger();
  const overviewQuery = useFxOverview(ledgerId);
  const queryClient = useQueryClient();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const overview = overviewQuery.data;

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const openEditor = (preset: { currency?: string; rate?: string; date?: string } = {}) => {
    if (!ledgerId) return;
    push({
      hideDefaultHeader: true,
      content: <FxRateEditorSheet ledgerId={ledgerId} {...preset} />,
    });
  };

  const remove = useMutation({
    mutationFn: (rateId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/fx/rates/${rateId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId] });
      showToast({ tone: "success", message: t("已删除") });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, t("删除失败，请稍后重试")) }),
  });

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={22} strokeWidth={2.3} />}
            label={t("手填汇率")}
            onClick={() => openEditor()}
          />
        }
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={t("返回")}
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title={t("汇率")}
      >
        <div className="flex flex-col gap-5 pb-6">
          {overviewQuery.isPending ? (
            <LoadingState rows={3} title={t("加载汇率")} />
          ) : !overview ? null : (
            <>
              <p className="px-1 text-[13px] leading-5 text-[var(--color-text-muted)]">
                {overview.provider
                  ? t("本币 {base} · 外币汇率每天自动从欧洲央行获取，也可以手填覆盖", {
                      base: overview.baseCurrency,
                    })
                  : t("本币 {base} · 未启用自动获取（FX_PROVIDER），外币汇率需要手填", {
                      base: overview.baseCurrency,
                    })}
              </p>
              <section className="flex flex-col gap-2">
                <h3 className="px-1 text-[13px] font-medium text-[var(--color-text-muted)]">
                  {t("在用的外币")}
                </h3>
                {overview.currencies.length === 0 ? (
                  <EmptyState
                    message={t("新建外币账户、记一笔外币账，或给订阅设外币后会出现在这里。")}
                    title={t("还没有用到外币")}
                  />
                ) : (
                  <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
                    {overview.currencies.map((row) => (
                      <button
                        className="flex w-full items-center gap-3 px-4 py-3 text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                        key={row.currency}
                        onClick={() => openEditor({ currency: row.currency })}
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] text-[var(--color-text-primary)]">
                            {currencyLabel(row.currency)}
                          </span>
                          <span className="block text-[12px] text-[var(--color-text-muted)]">
                            {row.latest
                              ? `${row.latest.date} · ${sourceLabel(row.latest.source)}`
                              : row.providerSupported && overview.provider
                                ? t("暂时取不到，稍后会自动重试，也可以先手填")
                                : t("数据源不提供这个币种，需要手填")}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${
                            row.latest
                              ? "text-[var(--color-text-primary)]"
                              : "text-[var(--color-accent-expense)]"
                          }`}
                        >
                          {row.latest
                            ? `1 ${row.currency} = ${row.latest.rate} ${overview.baseCurrency}`
                            : t("缺汇率")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {overview.manualRates.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="px-1 text-[13px] font-medium text-[var(--color-text-muted)]">
                    {t("手填记录")}
                  </h3>
                  <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
                    {overview.manualRates.map((row) => {
                      const currency =
                        row.toCurrency === overview.baseCurrency
                          ? row.fromCurrency
                          : row.toCurrency;
                      return (
                        <div
                          className="flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                          key={row.id}
                        >
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={() => openEditor({ currency, rate: row.rate, date: row.date })}
                            type="button"
                          >
                            <span className="block text-[15px] text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                              1 {row.fromCurrency} = {row.rate} {row.toCurrency}
                            </span>
                            <span className="block text-[12px] text-[var(--color-text-muted)]">
                              {row.date}
                            </span>
                          </button>
                          <button
                            className="shrink-0 text-[14px] text-[var(--color-accent-expense)]"
                            disabled={remove.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: t("删除这条手填汇率？"),
                                message: t("删除后这一天按自动获取的或更早的汇率折算。"),
                                confirmText: t("删除"),
                                tone: "danger",
                              });
                              if (ok) remove.mutate(row.id);
                            }}
                            type="button"
                          >
                            {t("删除")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
