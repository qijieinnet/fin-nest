"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, type Ledger, ledgerPath } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

export function EditLedgerSheet({ ledger }: { ledger: Ledger }) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [name, setName] = useState(ledger.name);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<Ledger>(ledgerPath(ledger.id), {
        method: "PATCH",
        body: { name: name.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      showToast({ tone: "success", message: "账本已更新" });
      pop();
    },
  });

  const canSubmit =
    name.trim().length > 0 && name.trim() !== ledger.name && !mutation.isPending;

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
        value={name}
      />
      {mutation.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(mutation.error, "保存失败，请稍后重试")}
        </p>
      ) : null}
      <Button disabled={!canSubmit} type="submit">
        {mutation.isPending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
