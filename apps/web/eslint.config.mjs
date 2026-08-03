import config from "@fin-nest/eslint-config";

export default [
  ...config,
  {
    // 切页必须走 useAppRouter，否则该次导航没有顶部进度条反馈（详见 lib/route/useAppRouter.ts）。
    // 只放行封装自身；usePathname / useSearchParams / useParams 等不受影响。
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/route/useAppRouter.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              importNames: ["useRouter"],
              message: "切页请用 @/lib/route/useAppRouter 的 useAppRouter，它会驱动顶部进度条。",
              name: "next/navigation",
            },
          ],
        },
      ],
    },
  },
];
