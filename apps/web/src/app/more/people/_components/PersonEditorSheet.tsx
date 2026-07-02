"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Person } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

type PersonEditorSheetProps = {
  ledgerId: string;
  person?: Person;
};

export function PersonEditorSheet({ ledgerId, person }: PersonEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [name, setName] = useState(person?.name ?? "");
  const isEditing = Boolean(person);

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.people(ledgerId) });
      showToast({ tone: "success", message: isEditing ? "人员已更新" : "人员已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") });
    },
  });

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && (!person || trimmedName !== person.name) && !save.isPending;
  const title = isEditing ? "编辑人员" : "新建人员";

  const submit = () => {
    if (canSubmit) save.mutate();
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
          onClick={submit}
          variant="primary"
        />
      </div>

      <Input
        autoFocus
        label="人员名称"
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

      {save.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(save.error, "操作失败，请稍后重试")}
        </p>
      ) : null}
    </div>
  );
}
