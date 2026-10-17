"use client";

import { useState } from "react";
import { LoadingState } from "@/components/business";
import { BottomSheet, Button } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api";
import { useAiPreferences, useUpdateAiPreferences } from "@/lib/data/ai";
import { t } from "@/lib/i18n";
import { useToast } from "@/providers";

/** 与后端 AI_IMAGE_INSTRUCTIONS_MAX_LENGTH 保持一致。 */
const MAX_LENGTH = 1000;

type AiImageInstructionsSheetProps = {
  ledgerId: string | null;
  onClose: () => void;
  open: boolean;
};

/** 识图补充要求：按「账本 + 本人」保存，之后每次上传账单图片都会带给 AI。 */
export function AiImageInstructionsSheet({ ledgerId, onClose, open }: AiImageInstructionsSheetProps) {
  const query = useAiPreferences(ledgerId, open);

  return (
    <BottomSheet onClose={onClose} open={open} title={t("识图补充要求")}>
      <div className="flex flex-col gap-3 pb-4">
        <p className="text-sm leading-6 text-[var(--color-text-muted)]">
          {t(
            "上传账单图片时，AI 会在默认识别规则之外额外遵守这里的要求。仅对你本人在当前账本生效；单次上传时在输入框里写的说明优先。",
          )}
        </p>
        {query.isPending ? (
          <LoadingState rows={2} title={t("加载中")} />
        ) : query.isError ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
            {getApiErrorMessage(query.error)}
          </p>
        ) : open ? (
          // 以服务端值为 key 挂载：每次打开/保存后都从最新值开始，丢弃上次未保存的修改。
          <InstructionsForm
            initial={query.data.imageInstructions ?? ""}
            key={query.data.imageInstructions ?? ""}
            ledgerId={ledgerId}
            onSaved={onClose}
          />
        ) : null}
      </div>
    </BottomSheet>
  );
}

function InstructionsForm({
  initial,
  ledgerId,
  onSaved,
}: {
  initial: string;
  ledgerId: string | null;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const save = useUpdateAiPreferences(ledgerId);
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== initial;

  const submit = () => {
    save.mutate(
      { imageInstructions: value.trim() || null },
      {
        onSuccess: () => {
          showToast({ tone: "success", message: t("识图要求已保存") });
          onSaved();
        },
        onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
      },
    );
  };

  return (
    <>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <textarea
          aria-label={t("识图补充要求")}
          className="min-h-[180px] w-full resize-none bg-transparent text-[15px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          maxLength={MAX_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t(
            "每行一条，例如：\n美团、饿了么的订单都记到「餐饮-外卖」\n超市小票按商品拆成多笔\n备注里加上「出差」二字\n退款记录不要识别",
          )}
          value={value}
        />
        <p className="text-right text-xs text-[var(--color-text-muted)]">
          {value.length}/{MAX_LENGTH}
        </p>
      </div>
      <Button block disabled={!dirty} loading={save.isPending} onClick={submit} variant="primary">
        {t("保存")}
      </Button>
    </>
  );
}
