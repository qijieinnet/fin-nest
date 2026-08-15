"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuickTemplate } from "@/lib/api";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useSheetStack } from "@/providers";
import { QuickTemplateSheet } from "./QuickTemplateSheet";
import { TransactionForm, type TransactionSeed } from "./TransactionForm";
import { writeQuickEntrySeed } from "./_model/quick-entry-handoff";
import { templateToSeed } from "./_model/template-seed";

/** 键盘收起动画时长（--motion-duration-normal 220ms）+ 一点余量，跑完再重置表单。 */
const RESET_DELAY_MS = 320;

/**
 * 账单列表的快捷记账：点「记一笔」直接弹金额键盘，字段都在键盘页签里改，不跳页。
 * 需要完整表单（关联、附件、资产、转账双账户）时按键盘上的「转到记账页」转全屏。
 */
export function QuickEntryKeypad({ onClose, open }: { onClose: () => void; open: boolean }) {
  const router = useAppRouter();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  // 表单挂上就先留着：跟着 open 卸载会把键盘的收起动画剪掉。
  const [everOpened, setEverOpened] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  // 收起动画跑完再换 key 重挂：下次打开是干净的一笔（金额、备注、幂等键都重来）。
  const [instance, setInstance] = useState(0);
  // 选中的快捷模板：靠换 key 重挂表单来注入，与记账页的做法一致。
  const [seed, setSeed] = useState<TransactionSeed | null>(null);
  const [seedRevision, setSeedRevision] = useState(0);
  // 记住表单当前日期，套用模板重挂时保留用户已选日期。
  const occurredOnRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setKeypadOpen(false);
      return;
    }
    setEverOpened(true);
    // 先以收起态挂载，下一帧再展开，否则键盘是「直接出现」而不是滑上来。
    const frame = requestAnimationFrame(() => setKeypadOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open || !everOpened) return;
    const timer = setTimeout(() => {
      setInstance((current) => current + 1);
      setSeed(null);
    }, RESET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [everOpened, open]);

  // 传给表单模型的回调要稳定引用：模型里是 effect 依赖，每次渲染换新函数会白跑。
  const handleOccurredOnChange = useCallback((next: string) => {
    occurredOnRef.current = next;
  }, []);

  const applyTemplate = useCallback((template: QuickTemplate) => {
    setSeed({ ...templateToSeed(template), occurredOn: occurredOnRef.current });
    setSeedRevision((current) => current + 1);
  }, []);

  const openQuickTemplates = useCallback(() => {
    push({
      title: "快捷记账",
      content: <QuickTemplateSheet directRunEnabled={false} onSelectTemplate={applyTemplate} />,
    });
  }, [applyTemplate, push]);

  if (!everOpened || !ledgerId) return null;

  return (
    <TransactionForm
      key={`${instance}:${seedRevision}`}
      keypadOnly
      keypadOpen={keypadOpen}
      ledgerId={ledgerId}
      onExpand={(currentSeed) => {
        writeQuickEntrySeed(currentSeed);
        onClose();
        router.push(`${routes.billNew}?quick=1`);
      }}
      onKeypadOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOccurredOnChange={handleOccurredOnChange}
      onQuickTemplates={openQuickTemplates}
      // 给了 onSaved，保存后就不会再 router.back()（列表页没有可返回的上一层）。
      onSaved={() => onClose()}
      seed={seed ?? undefined}
    />
  );
}
