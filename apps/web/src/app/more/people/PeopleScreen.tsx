"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, ChevronLeft, MoreHorizontal, Plus } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/business";
import {
  Button,
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  MobilePage,
  PopoverMenu,
} from "@/components/ui";
import { useState } from "react";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Person } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { usePeople } from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { PersonEditorSheet } from "./_components/PersonEditorSheet";
import { PeopleSortList } from "./_components/PeopleSortList";

export function PeopleScreen() {
  const router = useAppRouter();
  const { ledgerId } = useLedger();
  const peopleQuery = usePeople(ledgerId);
  const queryClient = useQueryClient();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
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

  const peopleKey = queryKeys.people(ledgerId ?? "none");

  const reorderPeople = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/people/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: peopleKey });
    },
  });

  const handleReorder = (orderedIds: string[]) => {
    queryClient.setQueryData<Person[]>(peopleKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((person) =>
          position.has(person.id) ? { ...person, sortOrder: position.get(person.id)! } : person,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder);
    });
    reorderPeople.mutate(orderedIds);
  };

  const people = peopleQuery.data ?? [];

  return (
    <MobileAppShell>
      <MobilePage
        action={
          sortMode ? (
            <Button onClick={() => setSortMode(false)} variant="primary">
              完成
            </Button>
          ) : (
            <div className="relative flex justify-end">
              <IconButtonGroup
                items={[
                  {
                    icon: <Plus size={22} strokeWidth={2.3} />,
                    label: "添加人员",
                    onClick: () => openEditor(),
                  },
                  ...(people.length > 1
                    ? [
                        {
                          icon: <MoreHorizontal size={22} />,
                          label: "更多选项",
                          onClick: () => setMoreMenuOpen((open) => !open),
                        },
                      ]
                    : []),
                ]}
              />
              <PopoverMenu
                groups={[
                  [
                    {
                      icon: <ArrowUpDown size={18} />,
                      label: "排序",
                      onSelect: () => setSortMode(true),
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          )
        }
        description="记账时可指定消费/收入归属的人员"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={sortMode ? "退出排序" : "返回"}
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title={sortMode ? "拖动排序" : "人员管理"}
      >
        <div className="flex flex-col gap-3 pb-6">
          {peopleQuery.isPending ? (
            <LoadingState rows={4} title="加载人员" />
          ) : people.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => openEditor()} variant="primary">
                  添加人员
                </Button>
              }
              message="添加人员后，新建账单时可以指定归属人。"
              title="还没有人员"
            />
          ) : sortMode ? (
            <>
              <p className="px-1 text-xs text-[var(--color-text-muted)]">
                按住右侧图标拖动人员排序。
              </p>
              <PeopleSortList onReorder={handleReorder} people={people} />
            </>
          ) : (
            <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              <ul className="divide-y divide-black/[0.06]">
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      className="flex min-h-[58px] w-full items-center gap-3 px-[18px] py-[15px] text-left"
                      onClick={() => openEditor(person)}
                      type="button"
                    >
                      <span className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text-primary)]">
                        {person.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
