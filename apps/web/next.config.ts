import { loadDotenv } from "@fin-nest/config";
import type { NextConfig } from "next";

// 让 web 也读根目录 .env（Next 默认只读 apps/web 下的 .env）。
// NEXT_PUBLIC_* 变量在编译时从 process.env 内联，因此需在配置阶段先加载。
loadDotenv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 复用 workspace 内的共享包源码/产物
  transpilePackages: ["@fin-nest/shared"],
};

export default nextConfig;
