import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * 全项目共享的 ESLint flat config 基线。
 * 各 workspace 通过 `eslint.config.mjs` 导入并默认导出。
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/*.config.js",
      "**/*.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // 纯 JS 脚本（e2e/单测 runner 等）不经 TS 检查，`no-undef` 对它们仍然生效，
    // 需要显式声明 Node 运行时全局（fetch/Response/process…）。
    // TS 文件不需要：typescript-eslint 的 eslint-recommended 已为其关闭 `no-undef`。
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
