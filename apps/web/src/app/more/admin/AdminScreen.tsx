"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type RegistrationSetting,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAuth, useToast } from "@/providers";

export function AdminScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { showToast } = useToast();

  // 非管理员直接返回更多页（后端也会 403 拦截）。
  useEffect(() => {
    if (user && !user.isAdmin) router.replace(routes.more);
  }, [user, router]);

  const registrationQuery = useQuery({
    queryKey: queryKeys.registrationSetting,
    queryFn: () => apiRequest<RegistrationSetting>(API_ENDPOINTS.adminRegistration),
    enabled: Boolean(user?.isAdmin),
    staleTime: 30_000,
  });

  const registrationMutation = useMutation({
    mutationFn: (registrationEnabled: boolean) =>
      apiRequest<RegistrationSetting>(API_ENDPOINTS.adminRegistration, {
        method: "PATCH",
        body: { registrationEnabled },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.registrationSetting, data);
      showToast({ tone: "success", message: data.registrationEnabled ? "已开放注册" : "已关闭注册" });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const registration = registrationQuery.data;

  return (
    <MobileAppShell>
      <MobilePage
        description="开放注册与用户管理"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="管理员功能"
      >
        <div className="flex flex-col gap-3.5 pb-6">
          {/* 开放注册开关 */}
          <section className="flex items-center gap-3 rounded-[18px] bg-[var(--color-bg-surface)] px-[18px] py-4 shadow-[var(--shadow-soft)]">
            <div className="min-w-0 flex-1">
              <p className="text-base text-[var(--color-text-primary)]">允许新用户注册</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                关闭后，注册页将拒绝新用户注册
              </p>
            </div>
            <Switch
              checked={registration?.registrationEnabled ?? false}
              disabled={!registration || registrationMutation.isPending}
              label="允许新用户注册"
              onCheckedChange={(next) => registrationMutation.mutate(next)}
            />
          </section>

          {/* 用户管理入口 */}
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <button
              className="flex w-full items-center gap-3 px-[18px] py-4 text-left"
              onClick={() => router.push(routes.users)}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base text-[var(--color-text-primary)]">用户管理</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                  查看成员、设置权限与禁用
                </span>
              </span>
              <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
            </button>
          </section>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
