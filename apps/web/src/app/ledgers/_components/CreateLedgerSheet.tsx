"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, getApiErrorMessage, type Ledger } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useSheetStack, useToast } from "@/providers";

export function CreateLedgerSheet() {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const { setLedgerId } = useLedger();
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<Ledger>(API_ENDPOINTS.ledgers, {
        method: "POST",
        body: { name: name.trim() },
      }),
    onSuccess: async (ledger) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      setLedgerId(ledger.id);
      showToast({ tone: "success", message: `已创建「${ledger.name}」` });
      pop();
    },
  });

  const canSubmit = name.trim().length > 0 && !mutation.isPending;

  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
    >
      <Input
        autoFocus
        label="账本名称"
        name="name"
        onChange={(event) => setName(event.target.value)}
        placeholder="例如：家庭账本"
        value={name}
      />
      {mutation.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(mutation.error, "创建失败，请稍后重试")}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-[var(--color-text-muted)]">
        新账本会自动初始化默认记账设置、人员「我」和基础收支分类。
      </p>
      <Button disabled={!canSubmit} type="submit">
        {mutation.isPending ? "创建中…" : "创建账本"}
      </Button>
    </form>
  );
}
