import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDotenv } from "@fin-nest/config";
import type { NextConfig } from "next";

// 让 web 也读根目录 .env（Next 默认只读 apps/web 下的 .env）。
// NEXT_PUBLIC_* 变量在编译时从 process.env 内联，因此需在配置阶段先加载。
loadDotenv();

// 浏览器请求 /api 时 Next 转发的目标。默认本机 API（开发 / 单机同容器）；
// 容器编排下各服务独立，通过 API_INTERNAL_URL 指向 api 服务（如 http://api:4000）。
function apiInternalUrl(): string {
  const explicit = process.env.API_INTERNAL_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `http://localhost:${process.env.API_PORT ?? "4000"}`;
}

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
  // 独立产物：Docker 运行时只需 .next/standalone + 静态资源，无需完整 node_modules。
  output: "standalone",
  // monorepo 下需把追踪根设为仓库根，standalone 才能收集 workspace 依赖文件。
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../../"),
  allowedDevOrigins: parseAllowedDevOrigins(),
  // 浏览器统一请求同源 /api 前缀：开发 / 容器编排由 Next 转发到 API 服务；
  // 若前置 nginx 已匹配 /api 转发，则不会走到这条 rewrite。
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl()}/:path*` }];
  },
  reactStrictMode: true,
  // 关闭开发模式左下角的 Next.js Dev Tools 指示器（避免遮挡底部导航）。
  devIndicators: false,
  // 复用 workspace 内的共享包源码/产物
  transpilePackages: ["@fin-nest/shared"],
};

export default nextConfig;
