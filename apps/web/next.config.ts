import { loadDotenv } from "@fin-nest/config";
import type { NextConfig } from "next";

// 让 web 也读根目录 .env（Next 默认只读 apps/web 下的 .env）。
// NEXT_PUBLIC_* 变量在编译时从 process.env 内联，因此需在配置阶段先加载。
loadDotenv();

function parseAllowedDevOrigins(): string[] {
  const origins = process.env.WEB_ORIGIN?.split(",") ?? [];
  const hostnames = new Set<string>();

  for (const origin of origins) {
    const trimmed = origin.trim();
    if (!trimmed) continue;

    try {
      hostnames.add(new URL(trimmed).hostname);
    } catch {
      hostnames.add(trimmed);
    }
  }

  return [...hostnames];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: parseAllowedDevOrigins(),
  // 浏览器统一请求同源 /api 前缀：开发环境由 Next 转发到本机 API；
  // 线上由前置 nginx 先行匹配 /api 转发到 API 服务，不会走到这条 rewrite。
  async rewrites() {
    const apiPort = process.env.API_PORT ?? "4000";
    return [{ source: "/api/:path*", destination: `http://localhost:${apiPort}/:path*` }];
  },
  reactStrictMode: true,
  // 关闭开发模式左下角的 Next.js Dev Tools 指示器（避免遮挡底部导航）。
  devIndicators: false,
  // 复用 workspace 内的共享包源码/产物
  transpilePackages: ["@fin-nest/shared"],
};

export default nextConfig;
