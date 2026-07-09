"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Person } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";

type PersonEditorSheetProps = {
  ledgerId: string;
  person?: Person;
};

export function PersonEditorSheet({ ledgerId, person }: PersonEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(person?.name ?? "");
  const isEditing = Boolean(person);

  const invalidatePeople = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.people(ledgerId) });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() };
      if (person) {
        return apiRequest<Person>(ledgerApiPath(ledgerId, `/people/${person.id}`), {
          method: "PATCH",
          body,
        });
      }
      return apiRequest<Person>(ledgerApiPath(ledgerId, "/people"), {
        method: "POST",
        body,
      });
    },
    onSuccess: async () => {
      await invalidatePeople();
      showToast({ tone: "success", message: isEditing ? "人员已更新" : "人员已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") });
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!person) throw new Error("缺少人员");
      return apiRequest<void>(ledgerApiPath(ledgerId, `/people/${person.id}`), { method: "DELETE" });
    },
    onSuccess: async () => {
      await invalidatePeople();
      showToast({ tone: "success", message: "人员已删除" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && (!person || trimmedName !== person.name) && !save.isPending;
  const title = isEditing ? "编辑人员" : "新建人员";

  const submit = () => {
    if (canSubmit) save.mutate();
  };

  const handleDelete = async () => {
    if (!person || remove.isPending) return;
    const confirmed = await confirm({
      title: `删除人员「${person.name}」？`,
      message: "有关联账单时会保留历史记录并归档。",
      confirmText: "删除",
      tone: "danger",
    });
    if (confirmed) remove.mutate();
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存人员"
          loading={save.isPending}
          onClick={submit}
          variant="primary"
        />
      </div>

      <label className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-white px-4">
        <span className="shrink-0 text-[15px] font-medium text-[var(--color-text-primary)]">
          人员名称
        </span>
        <input
          autoFocus
          className="input-flat min-w-0 flex-1 border-0 bg-transparent py-3 text-right text-[16px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="如：我、伴侣、室友"
          value={name}
        />
      </label>

      {save.isError || remove.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(save.error ?? remove.error, "操作失败，请稍后重试")}
        </p>
      ) : null}

      {person ? (
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          disabled={remove.isPending || save.isPending}
          icon={<Trash2 size={17} />}
          onClick={handleDelete}
          variant="danger"
        >
          {remove.isPending ? "删除中…" : "删除该人员"}
        </Button>
      ) : null}
    </div>
  );
}
