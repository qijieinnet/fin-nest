"use client";

import { cn } from "@/lib/format/class-names";
import type { AccountPerson } from "@/lib/api";

/**
 * 账户上的归属人员小标签；未指定归属时不渲染。已归档人员标注出来，提示去改归属。
 * 只显示名字：`people.icon` 存的是 lucide 图标名（默认人员「我」是 "user"），全应用没有一处渲染它。
 */
export function AccountPersonBadge({
  className,
  person,
}: {
  className?: string;
  person: AccountPerson | null;
}) {
  if (!person) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-[5px] bg-[var(--color-control-fill-muted)] px-1 py-px text-[10px] font-normal text-[var(--color-text-muted)]",
        className,
      )}
    >
      {person.name}
      {person.archived ? "（已归档）" : ""}
    </span>
  );
}
