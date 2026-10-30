"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { BottomSheet, Button, Input, PopoverMenu, Switch } from "@/components/ui";
import {
  getApiErrorMessage,
  type AgentToken,
  type AgentTokenScope,
  type CreatedAgentToken,
} from "@/lib/api";
import { useCreateAgentToken, useUpdateAgentToken } from "@/lib/data/agent-tokens";
import { localized, msg, t } from "@/lib/i18n";
import { useLedger, useToast } from "@/providers";

const EXPIRY_OPTIONS: ReadonlyArray<{ days: number | null; label: string }> = localized([
  { days: null, label: msg("永不过期") },
  { days: 30, label: msg("30 天") },
  { days: 90, label: msg("90 天") },
  { days: 365, label: msg("1 年") },
]);

/**
 * 写入类权限。read 恒选（写工具要先靠只读工具拿到 id），不出现在这里；
 * 默认全不勾——给智能体写权限应该是用户有意识的选择。
 */
export const WRITE_SCOPE_OPTIONS: ReadonlyArray<{
  scope: Exclude<AgentTokenScope, "read">;
  label: string;
  description: string;
}> = localized([
  {
    scope: "drafts:write",
    label: msg("起草记账"),
    description: msg("生成待确认草稿，你确认后才入账"),
  },
  {
    scope: "accounts:write",
    label: msg("管理账户"),
    description: msg("新建账户、修改账户信息，不能改余额"),
  },
  {
    scope: "assets:write",
    label: msg("管理物品/订阅/保险"),
    description: msg("新建、修改、报废/退订/终止，不能删除"),
  },
  {
    scope: "plans:write",
    label: msg("管理计划与预算"),
    description: msg("新建、修改、停止计划，设置预算"),
  },
  {
    scope: "changes:write",
    label: msg("申请修改账目"),
    description: msg("申请改/删已入账交易、调整余额，你批准后才生效"),
  },
]);

type AgentTokenFormSheetProps = {
  /** 传入即编辑（名称、账本范围与权限），否则新建。 */
  editing: AgentToken | null;
  onClose: () => void;
  onCreated: (token: CreatedAgentToken) => void;
  open: boolean;
};

export function AgentTokenFormSheet({
  editing,
  onClose,
  onCreated,
  open,
}: AgentTokenFormSheetProps) {
  const { ledgers } = useLedger();
  const { showToast } = useToast();
  const createToken = useCreateAgentToken();
  const updateToken = useUpdateAgentToken();

  const [name, setName] = useState("");
  const [allLedgers, setAllLedgers] = useState(true);
  const [ledgerIds, setLedgerIds] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [allowedIps, setAllowedIps] = useState("");
  const [writeScopes, setWriteScopes] = useState<AgentTokenScope[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setAllLedgers(!editing || editing.ledgerIds.length === 0);
    setLedgerIds(editing?.ledgerIds ?? []);
    setExpiryDays(null);
    setAllowedIps("");
    setWriteScopes(editing?.scopes.filter((scope) => scope !== "read") ?? []);
  }, [editing, open]);

  const toggleScope = (scope: AgentTokenScope, checked: boolean) => {
    setWriteScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope),
    );
  };

  const toggleLedger = (ledgerId: string, checked: boolean) => {
    setLedgerIds((current) =>
      checked ? [...current, ledgerId] : current.filter((id) => id !== ledgerId),
    );
  };

  const pending = createToken.isPending || updateToken.isPending;
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && (allLedgers || ledgerIds.length > 0) && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const scopedLedgerIds = allLedgers ? [] : ledgerIds;
    const scopes: AgentTokenScope[] = ["read", ...writeScopes];
    try {
      if (editing) {
        await updateToken.mutateAsync({
          tokenId: editing.id,
          input: { name: trimmedName, ledgerIds: scopedLedgerIds, scopes },
        });
        showToast({ tone: "success", message: t("已保存") });
        onClose();
        return;
      }
      const ips = allowedIps
        .split(/[\s,，]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const created = await createToken.mutateAsync({
        name: trimmedName,
        scopes,
        ledgerIds: scopedLedgerIds,
        ...(ips.length ? { allowedIps: ips } : {}),
        ...(expiryDays
          ? { expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString() }
          : {}),
      });
      onCreated(created);
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  return (
    <BottomSheet onClose={onClose} open={open} title={editing ? t("编辑 token") : t("新建 token")}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <Input
          label={t("名称")}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("如：Claude Code - 笔记本")}
          value={name}
        />

        <div className="flex flex-col gap-2">
          <span className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("可访问的账本")}
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-[var(--color-text-primary)]">
                  {t("全部账本")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t("包括以后加入的账本")}
                </span>
              </span>
              <Switch checked={allLedgers} label={t("全部账本")} onCheckedChange={setAllLedgers} />
            </div>
            {allLedgers
              ? null
              : ledgers.map((ledger) => (
                  <div
                    className="flex items-center gap-3 px-4 py-[13px] shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]"
                    key={ledger.id}
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-text-primary)]">
                      {ledger.name}
                    </span>
                    <Switch
                      checked={ledgerIds.includes(ledger.id)}
                      label={ledger.name}
                      onCheckedChange={(checked) => toggleLedger(ledger.id, checked)}
                    />
                  </div>
                ))}
          </section>
        </div>

        <div className="flex flex-col gap-2">
          <span className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("权限")}
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-[var(--color-text-primary)]">
                  {t("查询数据")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t("账单、统计、账户、计划、预算与档案，始终开启")}
                </span>
              </span>
              <Switch checked disabled label={t("查询数据")} />
            </div>
            {WRITE_SCOPE_OPTIONS.map((option) => (
              <div
                className="flex items-center gap-3 px-4 py-[13px] shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]"
                key={option.scope}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-[var(--color-text-primary)]">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {option.description}
                  </span>
                </span>
                <Switch
                  checked={writeScopes.includes(option.scope)}
                  label={option.label}
                  onCheckedChange={(checked) => toggleScope(option.scope, checked)}
                />
              </div>
            ))}
          </section>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {t(
              "智能体永远不能自己让记账、修改或余额调整生效：记账要你在「待确认」里确认，修改与调整要你在本页批准。",
            )}
          </p>
        </div>

        {editing ? null : (
          <>
            <div className="relative">
              <button
                className="transaction-form__select-row"
                onClick={() => setExpiryOpen((value) => !value)}
                type="button"
              >
                <span>{t("有效期")}</span>
                <strong>
                  {EXPIRY_OPTIONS.find((option) => option.days === expiryDays)?.label ??
                    t("永不过期")}
                </strong>
                <ChevronRight size={18} />
              </button>
              <PopoverMenu
                groups={[
                  EXPIRY_OPTIONS.map((option) => ({
                    label: option.label,
                    onSelect: () => setExpiryDays(option.days),
                    selected: option.days === expiryDays,
                  })),
                ]}
                onOpenChange={setExpiryOpen}
                open={expiryOpen}
              />
            </div>
            <Input
              label={t("来源 IP 白名单（可选）")}
              onChange={(event) => setAllowedIps(event.target.value)}
              placeholder={t("如 192.168.1.0/24，多个用逗号分隔")}
              value={allowedIps}
            />
          </>
        )}

        <Button block disabled={!canSubmit} loading={pending} onClick={() => void handleSubmit()}>
          {editing ? t("保存") : t("创建")}
        </Button>
      </div>
    </BottomSheet>
  );
}
