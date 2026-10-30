"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { BottomSheet, Button, IconButton } from "@/components/ui";
import type { CreatedAgentToken } from "@/lib/api";
import { mcpEndpointUrl } from "@/lib/data/agent-tokens";
import { t } from "@/lib/i18n";
import { useToast } from "@/providers";

type AgentTokenCreatedSheetProps = {
  onClose: () => void;
  token: CreatedAgentToken | null;
};

/** 明文 token 只展示这一次：关掉弹层即从组件状态里丢弃，之后只能吊销重建。 */
export function AgentTokenCreatedSheet({ onClose, token }: AgentTokenCreatedSheetProps) {
  const endpoint = mcpEndpointUrl();
  const plain = token?.token ?? "";
  const claudeCommand = `claude mcp add --transport http fin-nest ${endpoint} --header "Authorization: Bearer ${plain}"`;
  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        "fin-nest": { url: endpoint, headers: { Authorization: `Bearer ${plain}` } },
      },
    },
    null,
    2,
  );

  return (
    <BottomSheet onClose={onClose} open={token !== null} title={t("token 已创建")}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <p className="text-[13px] leading-5 text-[var(--color-text-primary)]">
          {t("请立即复制保存，关闭后无法再次查看；遗失只能吊销后重新创建。")}
        </p>
        <CopyBlock label={t("Token")} value={plain} />
        <CopyBlock label={t("MCP 地址")} value={endpoint} />
        <CopyBlock label={t("Claude Code 一键添加")} value={claudeCommand} />
        <CopyBlock label={t("其它客户端（Cursor 等）配置")} value={jsonConfig} />
        <p className="text-xs leading-5 text-[var(--color-text-muted)]">
          {t("持有 token 即可以你的身份访问所选账本，请勿发到群聊或提交到代码仓库。")}
        </p>
        <Button block onClick={onClose}>
          {t("我已保存")}
        </Button>
      </div>
    </BottomSheet>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      showToast({ tone: "success", message: t("已复制") });
    } catch {
      // 非 HTTPS 或浏览器拒绝时降级：内容就显示在屏幕上，可以手动选中复制。
      showToast({ tone: "info", message: t("复制失败，请手动选中复制") });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{label}</span>
      <div className="flex items-start gap-2 rounded-[14px] bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-soft)]">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] leading-5 text-[var(--color-text-primary)] select-all">
          {value}
        </pre>
        <IconButton
          icon={copied ? <Check size={18} /> : <Copy size={18} />}
          label={t("复制")}
          onClick={() => void handleCopy()}
        />
      </div>
    </div>
  );
}
