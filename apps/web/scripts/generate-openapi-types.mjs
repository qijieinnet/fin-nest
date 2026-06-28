import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const output = resolve(appRoot, "src/lib/generated/api-types.ts");
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const schemaUrl = process.env.OPENAPI_SCHEMA_URL ?? `${apiBaseUrl.replace(/\/$/, "")}/docs-json`;

mkdirSync(dirname(output), { recursive: true });

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["dlx", "openapi-typescript@7.10.1", schemaUrl, "--output", output], {
  cwd: appRoot,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
