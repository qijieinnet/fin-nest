"use client";

import { ChevronLeft, Plus } from "lucide-react";
import { useState } from "react";
import { getApiErrorMessage, type AgentToken, type CreatedAgentToken } from "@/lib/api";
import { useAgentTokens, useRevokeAgentToken } from "@/lib/data/agent-tokens";
import { routes } from "@/lib/route/routes";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { currentIntlLocale, t } from "@/lib/i18n";
import { useConfirm, useLedger, useToast } from "@/providers";
import { AgentChangeRequestsSection } from "./_components/AgentChangeRequestsSection";
import { AgentTokenCreatedSheet } from "./_components/AgentTokenCreatedSheet";
import { AgentTokenFormSheet, WRITE_SCOPE_OPTIONS } from "./_components/AgentTokenFormSheet";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(currentIntlLocale());
}

/** 最近使用时间用相对描述，超过一周退回日期。服务端按分钟节流写入，「刚刚」足够准确。 */
function formatLastUsed(value: string | null): string {
  if (!value) return t("从未使用");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("从未使用");
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 2) return t("刚刚使用");
  if (diffMinutes < 60) return t("{value} 分钟前使用", { value: diffMinutes });
  if (diffMinutes < 60 * 24)
    return t("{value} 小时前使用", { value: Math.floor(diffMinutes / 60) });
  if (diffMinutes < 60 * 24 * 7) {
    return t("{value} 天前使用", { value: Math.floor(diffMinutes / (60 * 24)) });
  }
  return t("{value} 使用", { value: formatDate(value) });
}

function tokenStatus(token: AgentToken): "active" | "revoked" | "expired" {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

export function AgentTokensScreen() {
  const router = useAppRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { ledgers } = useLedger();
  const tokensQuery = useAgentTokens();
  const revokeToken = useRevokeAgentToken();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentToken | null>(null);
  // 明文只存在于组件状态：不进 query 缓存、不落 storage，关掉弹层即消失。
  const [created, setCreated] = useState<CreatedAgentToken | null>(null);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const ledgerNameById = new Map(ledgers.map((ledger) => [ledger.id, ledger.name]));
  const permissionText = (token: AgentToken) => {
    const labels = WRITE_SCOPE_OPTIONS.filter((option) => token.scopes.includes(option.scope)).map(
      (option) => option.label,
    );
    return labels.length > 0 ? labels.join(t("、")) : t("只读");
  };
  const scopeText = (token: AgentToken) =>
    token.ledgerIds.length === 0
      ? t("全部账本")
      : token.ledgerIds
          .map((ledgerId) => ledgerNameById.get(ledgerId) ?? t("已无权访问的账本"))
          .join(t("、"));

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (token: AgentToken) => {
    setEditing(token);
    setFormOpen(true);
  };

  const handleRevoke = async (token: AgentToken) => {
    const ok = await confirm({
      title: t("吊销 token"),
      message: t("吊销后使用「{name}」的智能体会立即失去访问权限，且无法恢复。", {
        name: token.name,
      }),
      confirmText: t("吊销"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeToken.mutateAsync(token.id);
      showToast({ tone: "success", message: t("已吊销") });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  const tokens = tokensQuery.data ?? [];
  const activeTokens = tokens.filter((token) => tokenStatus(token) === "active");
  const inactiveTokens = tokens.filter((token) => tokenStatus(token) !== "active");

  return (
    <MobileAppShell>
      <MobilePage
        description={t("让 Claude Code 等智能体经 MCP 使用账本")}
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={t("返回")}
            onClick={goBack}
          />
        }
        title={t("智能体接入")}
        action={
          <IconButton
            icon={<Plus size={22} strokeWidth={2.3} />}
            label={t("新建 token")}
            onClick={openCreate}
          />
        }
      >
        <div className="flex flex-col gap-3 pb-6">
          <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[13px] leading-5 text-[var(--color-text-muted)]">
              {t(
                "为每个智能体客户端创建一个个人 token，它会以你的身份访问所选账本：默认只能查询；可按需授权起草记账、管理账户/档案/计划、申请修改账目。起草的记账进「待确认」，修改/删除已入账交易与调整余额进下方的「待批准」，都要你点过才生效。",
              )}
            </p>
          </section>

          <AgentChangeRequestsSection />

          <span className="mt-1 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("我的 token")}
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            {activeTokens.length === 0 ? (
              <div className="flex flex-col gap-3 px-4 py-[15px]">
                <p className="text-[14px] text-[var(--color-text-muted)]">
                  {tokensQuery.isLoading ? t("加载中…") : t("还没有 token")}
                </p>
                {tokensQuery.isLoading ? null : (
                  <Button block onClick={openCreate}>
                    {t("新建 token")}
                  </Button>
                )}
              </div>
            ) : (
              activeTokens.map((token, index) => (
                <div
                  className={`flex items-center gap-3 px-4 py-[15px] ${
                    index < activeTokens.length - 1
                      ? "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                      : ""
                  }`}
                  key={token.id}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openEdit(token)}
                    type="button"
                  >
                    <span className="block truncate text-[15.5px] text-[var(--color-text-primary)]">
                      {token.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      {t("···{suffix} · {scope}", {
                        suffix: token.tokenSuffix,
                        scope: scopeText(token),
                      })}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      {permissionText(token)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      {formatLastUsed(token.lastUsedAt)}
                      {token.expiresAt
                        ? t(" · {value} 到期", { value: formatDate(token.expiresAt) })
                        : ""}
                    </span>
                  </button>
                  <Button
                    disabled={revokeToken.isPending}
                    onClick={() => void handleRevoke(token)}
                    variant="ghost"
                  >
                    {t("吊销")}
                  </Button>
                </div>
              ))
            )}
          </section>

          {inactiveTokens.length > 0 ? (
            <>
              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                {t("已失效")}
              </span>
              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                {inactiveTokens.map((token, index) => (
                  <div
                    className={`px-4 py-[13px] ${
                      index < inactiveTokens.length - 1
                        ? "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                        : ""
                    }`}
                    key={token.id}
                  >
                    <span className="block truncate text-[15px] text-[var(--color-text-muted)]">
                      {token.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                      {tokenStatus(token) === "revoked"
                        ? t("···{suffix} · 已吊销", { suffix: token.tokenSuffix })
                        : t("···{suffix} · 已过期", { suffix: token.tokenSuffix })}
                    </span>
                  </div>
                ))}
              </section>
            </>
          ) : null}
        </div>
      </MobilePage>

      <AgentTokenFormSheet
        editing={editing}
        onClose={() => setFormOpen(false)}
        onCreated={(token) => {
          setFormOpen(false);
          setCreated(token);
        }}
        open={formOpen}
      />
      <AgentTokenCreatedSheet onClose={() => setCreated(null)} token={created} />
    </MobileAppShell>
  );
}
