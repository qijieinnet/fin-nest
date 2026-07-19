"use client";

import { Check, ChevronLeft, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api";
import {
  useCreateFeishuBindCode,
  useFeishuBindings,
  useFeishuStatus,
  useRevokeFeishuBinding,
} from "@/lib/data/feishu";
import { routes } from "@/lib/route/routes";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useConfirm, useLedger, useToast } from "@/providers";

/** 绑定码有效期 10 分钟，本地按秒回读剩余时间；到点自动清空，逼用户重新生成。 */
function useCountdown(expiresAt: string | null): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(left);
      return left;
    };
    if (tick() === 0) return;
    const timer = setInterval(() => {
      if (tick() === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

function formatRemaining(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function FeishuBindingScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { currentLedger } = useLedger();

  const statusQuery = useFeishuStatus();
  const enabled = statusQuery.data?.enabled ?? false;
  const bindingsQuery = useFeishuBindings(enabled);
  const createCode = useCreateFeishuBindCode();
  const revokeBinding = useRevokeFeishuBinding();

  // 明文绑定码只存在于组件状态：不进 query 缓存、不落 storage，刷新即消失。
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const remaining = useCountdown(code?.expiresAt ?? null);

  useEffect(() => {
    if (remaining === 0) setCode(null);
  }, [remaining]);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const handleGenerate = async () => {
    if (!currentLedger) return;
    try {
      const created = await createCode.mutateAsync(currentLedger.id);
      setCode(created);
      setCopied(false);
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      showToast({ tone: "success", message: "已复制绑定码" });
    } catch {
      // 非 HTTPS 或浏览器拒绝时降级：码本身就显示在屏幕上，手动输入即可。
      showToast({ tone: "info", message: "复制失败，请手动输入" });
    }
  };

  const handleRevoke = async (bindingId: string, label: string) => {
    const ok = await confirm({
      title: "解除绑定",
      message: `解绑后「${label}」将无法再通过飞书记账或查询，可随时重新绑定。`,
      confirmText: "解除绑定",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeBinding.mutateAsync(bindingId);
      showToast({ tone: "success", message: "已解除绑定" });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  const bindings = bindingsQuery.data ?? [];

  return (
    <MobileAppShell>
      <MobilePage
        description="在飞书里记账与查询"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="飞书机器人"
      >
        <div className="flex flex-col gap-3 pb-6">
          {!statusQuery.isLoading && !enabled ? (
            <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
              <p className="text-[15px] text-[var(--color-text-primary)]">未启用</p>
              <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
                需在服务端配置 FEISHU_APP_ID 与 FEISHU_APP_SECRET 后重启 API。
              </p>
            </section>
          ) : null}

          {enabled ? (
            <>
              <span className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                已绑定的飞书账号
              </span>
              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                {bindings.length === 0 ? (
                  <p className="px-4 py-[15px] text-[14px] text-[var(--color-text-muted)]">
                    还没有绑定的飞书账号
                  </p>
                ) : (
                  bindings.map((binding, index) => {
                    const label = binding.displayName ?? `飞书账号 ···${binding.openIdSuffix}`;
                    return (
                      <div
                        className={`flex items-center gap-3 px-4 py-[15px] ${
                          index < bindings.length - 1
                            ? "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                            : ""
                        }`}
                        key={binding.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15.5px] text-[var(--color-text-primary)]">
                            {label}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                            当前账本 · {binding.currentLedgerName ?? "已删除的账本"}
                          </span>
                        </span>
                        <Button
                          disabled={revokeBinding.isPending}
                          onClick={() => void handleRevoke(binding.id, label)}
                          variant="ghost"
                        >
                          解绑
                        </Button>
                      </div>
                    );
                  })
                )}
              </section>

              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                添加绑定
              </span>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                {code ? (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="flex-1 font-mono text-[26px] tracking-[0.12em] text-[var(--color-text-primary)]">
                        {code.code}
                      </span>
                      <IconButton
                        icon={copied ? <Check size={20} /> : <Copy size={20} />}
                        label="复制绑定码"
                        onClick={() => void handleCopy()}
                      />
                    </div>
                    <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
                      {formatRemaining(remaining)} 后失效，仅可使用一次
                    </p>
                    <p className="mt-3 text-[13px] leading-5 text-[var(--color-text-primary)]">
                      在飞书里<b>私聊</b>机器人发送：
                    </p>
                    <p className="mt-1 font-mono text-[14px] text-[var(--color-text-primary)]">
                      绑定 {code.code}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                      不要在群聊里发送绑定码——群成员都能看到，等同于把记账权限交出去。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] leading-5 text-[var(--color-text-muted)]">
                      生成后在飞书私聊机器人发送绑定码即可完成绑定。绑定后默认账本为 「
                      {currentLedger?.name ?? "未选择"}」，之后可在飞书里切换。
                    </p>
                    <Button
                      block
                      className="mt-3"
                      disabled={!currentLedger || createCode.isPending}
                      loading={createCode.isPending}
                      onClick={() => void handleGenerate()}
                    >
                      {createCode.isPending ? "生成中…" : "生成绑定码"}
                    </Button>
                  </>
                )}
              </section>
            </>
          ) : null}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
