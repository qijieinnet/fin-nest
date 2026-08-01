import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaPackage from "../packages/db/generated/client/index.js";

const require = createRequire(import.meta.url);
const { Client: MinioClient } = require("../packages/backend/node_modules/minio");
const { PrismaClient } = prismaPackage;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // CI 可完全通过环境变量注入。
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const suffix = `${process.pid}_${Date.now()}`;
const database = `fin_nest_backup_e2e_${suffix}`;
const bucket = `fin-nest-backup-e2e-${suffix.replaceAll("_", "-")}`;
const backupDir = await mkdtemp(path.join(tmpdir(), "fin-nest-backup-e2e-"));
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.pathname = `/${database}`;
databaseUrl.searchParams.set("schema", "public");
const apiPort = String(26000 + (process.pid % 1000));

const admin = new PrismaClient();
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? "127.0.0.1",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
});

const childEnv = {
  ...process.env,
  API_PORT: apiPort,
  BACKUP_DIR: backupDir,
  DATABASE_URL: databaseUrl.toString(),
  E2E_SYSTEM_BACKUP: "1",
  MINIO_BUCKET: bucket,
};

try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  await minio.makeBucket(bucket);
  await run("pnpm", ["--filter", "@fin-nest/db", "run", "migrate:deploy"], childEnv);
  await run("pnpm", ["--filter", "@fin-nest/api", "run", "e2e"], childEnv);
} finally {
  await removeBucket(minio, bucket);
  await admin
    .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    .catch(() => undefined);
  await admin.$disconnect();
  await rm(backupDir, { recursive: true, force: true });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function removeBucket(client, name) {
  try {
    if (!(await client.bucketExists(name))) return;
    const objectNames = [];
    for await (const object of client.listObjectsV2(name, "", true)) {
      if (object.name) objectNames.push(object.name);
    }
    if (objectNames.length) await client.removeObjects(name, objectNames);
    await client.removeBucket(name);
  } catch (error) {
    console.error(
      `isolated MinIO cleanup warning: ${error instanceof Error ? error.message : error}`,
    );
  }
}
