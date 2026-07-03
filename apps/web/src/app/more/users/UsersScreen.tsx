"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { IconButton, Input, MobileAppShell, MobilePage } from "@/components/ui";
import {
  type AdminUser,
  type AdminUserPage,
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAuth, useSheetStack } from "@/providers";
import { UserActionsSheet } from "./_components/UserActionsSheet";

const PAGE_SIZE = 20;

export function UsersScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { push } = useSheetStack();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 搜索防抖：输入停止 300ms 后才发起请求。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // 非管理员直接返回更多页（后端也会 403 拦截）。
  useEffect(() => {
    if (user && !user.isAdmin) router.replace(routes.more);
  }, [user, router]);

  const usersQuery = useInfiniteQuery({
    queryKey: queryKeys.adminUsers(debouncedSearch),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiRequest<AdminUserPage>(`${API_ENDPOINTS.adminUsers}?${params.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(user?.isAdmin),
    staleTime: 30_000,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = usersQuery;
  const users = usersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // 触底加载：观察哨兵元素进入视口即拉取下一页。
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.admin);
    }
  };

  const openActions = (item: AdminUser) => {
    push({
      title: "用户操作",
      content: <UserActionsSheet currentUserId={user?.id} initialUser={item} />,
    });
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="查看成员、设置权限与禁用"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="用户管理"
      >
        <div className="flex flex-col gap-3.5 pb-6">
          <Input
            aria-label="搜索用户"
            className="bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            label=""
            name="search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="账号 / 邮箱 / 昵称"
            type="search"
            value={search}
          />

          {usersQuery.isPending ? (
            <LoadingState rows={5} title="加载用户" />
          ) : users.length === 0 ? (
            <EmptyState
              message={debouncedSearch ? "换个关键词试试。" : "还没有其他用户。"}
              title={debouncedSearch ? "没有匹配的用户" : "还没有用户"}
            />
          ) : (
            <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              <ul className="divide-y divide-black/[0.06]">
                {users.map((item) => {
                  const isSelf = item.id === user?.id;
                  const disabled = Boolean(item.disabledAt);
                  return (
                    <li key={item.id}>
                      <button
                        className="flex w-full items-center gap-3 px-[18px] py-3 text-left"
                        onClick={() => openActions(item)}
                        type="button"
                      >
                        <span
                          aria-hidden
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-base font-semibold text-[var(--color-tint-contrast)]"
                        >
                          {(item.alias || item.account || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-base font-semibold text-[var(--color-text-primary)]">
                            <span className="truncate">{item.alias || item.account}</span>
                            {isSelf ? (
                              <span className="shrink-0 rounded-full bg-[var(--color-tint-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-tint)]">
                                我
                              </span>
                            ) : null}
                            {item.isAdmin ? (
                              <span className="shrink-0 rounded-full bg-[var(--color-tint-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-tint)]">
                                管理员
                              </span>
                            ) : null}
                            {disabled ? (
                              <span className="shrink-0 rounded-full bg-[rgba(233,95,77,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent-expense)]">
                                已禁用
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                            {item.account}
                            {item.email ? ` · ${item.email}` : ""}
                          </span>
                        </span>
                        <ChevronRight
                          className="shrink-0 text-[var(--color-text-muted)]"
                          size={18}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 触底加载哨兵 */}
          <div ref={sentinelRef} />
          {isFetchingNextPage ? (
            <p className="text-center text-xs text-[var(--color-text-muted)]">加载中…</p>
          ) : null}

          {usersQuery.isError ? (
            <p className="text-sm text-[var(--color-accent-expense)]">
              {getApiErrorMessage(usersQuery.error, "加载失败，请稍后重试")}
            </p>
          ) : null}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
