"use client";

import type { ReactNode } from "react";
import { APP_NAME } from "@fin-nest/shared";
import { MobileAppShell } from "@/components/ui";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";

type AuthScreenShellProps = {
  children: ReactNode;
  footer?: ReactNode;
  subtitle: string;
  title: string;
};

function AppLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="authLogoBg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#EFF4FD" />
          <stop offset="1" stopColor="#DBE8F8" />
        </linearGradient>
      </defs>
      <rect fill="url(#authLogoBg)" height="128" rx="28" width="128" />
      <circle cx="64" cy="48" fill="#F1C877" r="12" />
      <path
        d="M26 58 Q64 90 102 58"
        fill="none"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path
        d="M34 64 Q64 87 94 64"
        fill="none"
        opacity="0.6"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="3.4"
      />
      <path
        d="M43 69 Q64 82 85 69"
        fill="none"
        opacity="0.45"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="2.6"
      />
    </svg>
  );
}

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
