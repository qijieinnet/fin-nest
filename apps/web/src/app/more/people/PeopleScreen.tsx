"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Edit3, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { ActionButton, MobileAppShell, MobilePage } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Person } from "@/lib/api";
import { usePeople } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { DeletePersonConfirmDialog } from "./_components/DeletePersonConfirmDialog";
import { PersonEditorSheet } from "./_components/PersonEditorSheet";

export function PeopleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const peopleQuery = usePeople(ledgerId);
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [personPendingDelete, setPersonPendingDelete] = useState<Person | null>(null);

  const invalidatePeople = async () => {
    if (!ledgerId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.people(ledgerId) });
  };

  const deletePerson = useMutation({
    mutationFn: (personId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/people/${personId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidatePeople();
      setPersonPendingDelete(null);
      showToast({ tone: "success", message: "人员已删除" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const openEditor = (person?: Person) => {
    if (!ledgerId) return;
    push({
      hideDefaultHeader: true,
      content: <PersonEditorSheet ledgerId={ledgerId} person={person} />,
    });
  };

  const confirmDeletePerson = (person: Person) => {
    if (person.isDefault || deletePerson.isPending) return;
    setPersonPendingDelete(person);
  };

  const people = peopleQuery.data ?? [];

  return (
    <MobileAppShell>
      <DeletePersonConfirmDialog
        deleting={deletePerson.isPending}
        onCancel={() => {
          if (!deletePerson.isPending) setPersonPendingDelete(null);
        }}
        onConfirm={() => {
          if (personPendingDelete && !deletePerson.isPending) {
            deletePerson.mutate(personPendingDelete.id);
          }
        }}
        person={personPendingDelete}
      />
      <MobilePage
        description="记账时可指定消费/收入归属的人员"
        leading={
          <ActionButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="人员管理"
      >
        <div className="flex flex-col gap-3 pb-6">
          {peopleQuery.isPending ? (
            <LoadingState rows={4} title="加载人员" />
          ) : people.length === 0 ? (
            <EmptyState message="添加人员后，新建账单时可以指定归属人。" title="还没有人员" />
          ) : (
            <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              <ul className="divide-y divide-black/[0.06]">
                {people.map((person) => {
                  const actions: SwipeAction[] = [
                    {
                      icon: <Edit3 size={18} />,
                      label: `编辑${person.name}`,
                      onClick: () => openEditor(person),
                      tone: "neutral" as const,
                    },
                  ];
                  if (!person.isDefault) {
                    actions.push({
                      icon: <Trash2 size={18} />,
                      label: `删除${person.name}`,
                      onClick: () => confirmDeletePerson(person),
                      tone: "danger" as const,
                    });
                  }

                  return (
                    <li key={person.id}>
                      <SwipeActionRow actions={actions}>
                        <div className="flex min-h-[58px] items-center gap-3 px-[18px] py-[15px]">
                          <span className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text-primary)]">
                            {person.name}
                          </span>
                          {person.isDefault ? (
                            <span className="shrink-0 text-xs text-[var(--color-text-muted)]">默认</span>
                          ) : null}
                        </div>
                      </SwipeActionRow>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <button
            className="mt-1 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={() => openEditor()}
            type="button"
          >
            <Plus size={17} />
            添加人员
          </button>

          {deletePerson.isError ? (
            <p className="text-sm text-[var(--color-accent-expense)]">
              {getApiErrorMessage(deletePerson.error, "操作失败，请稍后重试")}
            </p>
          ) : null}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
