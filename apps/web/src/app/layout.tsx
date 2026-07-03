import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fin Nest",
  description: "Fin Nest 记账本",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Fin Nest",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 锁定缩放：避免 iOS Safari 聚焦输入框时自动放大页面。
  maximumScale: 1,
  userScalable: false,
  themeColor: "#fefefe",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
