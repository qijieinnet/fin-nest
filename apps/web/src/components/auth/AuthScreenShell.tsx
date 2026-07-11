"use client";

import type { ReactNode } from "react";
import { APP_NAME } from "@fin-nest/shared";
import { AppLogo, MobileAppShell } from "@/components/ui";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";

type AuthScreenShellProps = {
  children: ReactNode;
  footer?: ReactNode;
  subtitle: string;
  title: string;
};

export function AuthScreenShell({ children, footer, subtitle, title }: AuthScreenShellProps) {
  const isDesktop = useIsDesktop();

  const content = (
    <>
      <div className="auth-hero">
        <span className="auth-logo">
          <AppLogo />
        </span>
        <div className="auth-hero__heading">
          <p className="auth-hero__app">{APP_NAME}</p>
          <h1 className="auth-hero__title">{title}</h1>
        </div>
        <p className="auth-hero__subtitle">{subtitle}</p>
      </div>
      <div className="auth-card">{children}</div>
      {footer ? <p className="auth-footer">{footer}</p> : null}
    </>
  );

  // 桌面：登录/注册不套 app 侧边栏，全屏渐变背景 + 居中卡片（C1）。
  if (isDesktop) {
    return <main className="auth-main auth-main--desktop">{content}</main>;
  }

  return (
    <MobileAppShell>
      <main className="auth-main">{content}</main>
    </MobileAppShell>
  );
}
