"use client";

import { ChevronLeft, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { type Person } from "@/lib/api";
import { usePeople } from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack } from "@/providers";
import { PersonEditorSheet } from "./_components/PersonEditorSheet";

export function PeopleScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const peopleQuery = usePeople(ledgerId);
  const { push } = useSheetStack();

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

  const people = peopleQuery.data ?? [];

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="添加人员"
            onClick={() => openEditor()}
          />
        }
        description="记账时可指定消费/收入归属的人员"
        leading={
          <IconButton
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
            <EmptyState
              action={
                <Button onClick={() => openEditor()} variant="primary">
                  添加人员
                </Button>
              }
              message="添加人员后，新建账单时可以指定归属人。"
              title="还没有人员"
            />
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
                      {person.isDefault ? (
                        <span className="shrink-0 text-xs text-[var(--color-text-muted)]">默认</span>
                      ) : null}
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
