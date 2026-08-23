// 校验四份 compose 之间的一致性。
//
// 背景：仓库有多份 compose（.env 版 / 变量内联版 / 内联全外部版 / 源码构建版），
// 服务定义与环境变量必须手工保持同步，没有编译期保护。历史上已经因此漏过东西：
// prod compose 一直没把 AI_* / FEISHU_* 传给 api / worker，导致源码构建部署的人
// 根本无法启用 AI 助手和飞书机器人，而且从文档层面看不出来。
//
// 内联版还有一类独有的坑：没有变量插值，同一个密码在多处重复出现，
// 改了一处漏另一处就会出现「minio 起来了但 minio-init 用旧密码建桶失败」
// 这种报错信息完全不指向密码的故障。
//
// 运行：pnpm check:compose

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// js-yaml 5.x 只有具名导出，没有 default。
import { load as loadYaml } from "js-yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 以 docker-compose.yml 为基准，其余几份与它比对。
const REFERENCE = "docker-compose.yml";
const FILES = [
  REFERENCE,
  "docker-compose.inline.yml",
  "docker-compose.inline-external.yml",
  "infra/compose/docker-compose.prod.yml",
];

// 内联版（NAS / 面板界面用）必须满足的额外约束：这类界面不读 .env，
// 也不会设置 COMPOSE_PROFILES —— 带 profiles 会让 postgres / minio 根本不启动。
const INLINE_FILES = new Set(["docker-compose.inline.yml", "docker-compose.inline-external.yml"]);

// 可选功能变量：内联版里以注释形式提供（让用户按需取消注释），
// 故不要求是生效的 YAML 键，但必须在文件里出现，避免新增功能时被整份漏掉。
const OPTIONAL_KEYS = /^(AI_|FEISHU_|APP_LOCK_|VAPID_)/;

// 这些服务承载应用配置，环境变量键集合必须跨文件一致。
const APP_SERVICES = ["api", "worker"];

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function loadCompose(file) {
  const raw = readFileSync(join(repoRoot, file), "utf8");
  return { raw, doc: loadYaml(raw) };
}

// 合并 x-app-env 锚点（.env 版用 <<: *app-env 复用）后的实际环境变量键。
function envOf(doc, service) {
  const svc = doc.services?.[service];
  if (!svc) return null;
  const merged = { ...(doc["x-app-env"] ?? {}), ...(svc.environment ?? {}) };
  delete merged["<<"];
  return merged;
}

const loaded = new Map();
for (const file of FILES) {
  try {
    loaded.set(file, loadCompose(file));
  } catch (e) {
    fail(file, `解析失败 -> ${e.message}`);
  }
}
if (errors.length) {
  console.error(errors.map((e) => `  ✗ ${e}`).join("\n"));
  process.exit(1);
}

// --- 1. 环境变量键集合跨文件一致 ---------------------------------------------
const refDoc = loaded.get(REFERENCE).doc;
for (const service of APP_SERVICES) {
  const refEnv = envOf(refDoc, service);
  if (!refEnv) {
    fail(REFERENCE, `缺少基准服务 ${service}`);
    continue;
  }
  const refKeys = Object.keys(refEnv).sort();

  for (const file of FILES) {
    if (file === REFERENCE) continue;
    const { raw, doc } = loaded.get(file);
    const env = envOf(doc, service);
    if (!env) {
      fail(file, `缺少服务 ${service}`);
      continue;
    }
    const keys = Object.keys(env);

    for (const key of refKeys) {
      if (keys.includes(key)) continue;
      // 可选变量允许以注释形式存在，但必须出现在文件里。
      if (OPTIONAL_KEYS.test(key) && raw.includes(key)) continue;
      fail(file, `服务 ${service} 缺少环境变量 ${key}（基准 ${REFERENCE} 有）`);
    }
    for (const key of keys) {
      if (!refKeys.includes(key)) {
        fail(file, `服务 ${service} 多出环境变量 ${key}（基准 ${REFERENCE} 没有）`);
      }
    }
  }
}

// --- 2. 同一文件内重复出现的值必须一致 ---------------------------------------
// 内联版没有插值，同一个密码写在多处；.env 版虽然靠 ${} 复用，同样适用这条检查。
const CONSISTENT_KEYS = ["DATABASE_URL", "MINIO_SECRET_KEY", "MINIO_ACCESS_KEY", "WEB_ORIGIN"];
for (const file of FILES) {
  const { doc } = loaded.get(file);
  for (const key of CONSISTENT_KEYS) {
    const seen = new Map();
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      const value = { ...(doc["x-app-env"] ?? {}), ...(svc.environment ?? {}) }[key];
      if (value === undefined) continue;
      const bucket = seen.get(String(value)) ?? [];
      bucket.push(name);
      seen.set(String(value), bucket);
    }
    if (seen.size > 1) {
      const detail = [...seen.entries()].map(([v, s]) => `${s.join("/")}=${v}`).join("  |  ");
      fail(file, `${key} 在不同服务间取值不一致 -> ${detail}`);
    }
  }
}

// --- 3. minio-init 命令行里的密钥必须与 MINIO_SECRET_KEY 一致 -----------------
// 这处藏在一行 shell 命令里、不在 environment 块中，是最容易漏改的地方：
// 漏了会表现为「建桶失败 → 附件功能整体不可用」，报错信息完全不指向密码。
for (const file of FILES) {
  const { doc } = loaded.get(file);
  const init = doc.services?.["minio-init"];
  if (!init) continue;
  const entrypoint = Array.isArray(init.entrypoint)
    ? init.entrypoint.join(" ")
    : (init.entrypoint ?? "");
  const secret = envOf(doc, "api")?.MINIO_SECRET_KEY;
  if (secret === undefined) continue;
  // .env 版是 ${MINIO_SECRET_KEY...} 插值，取变量名比对；内联版是字面量，直接比对。
  const literal = String(secret);
  const expected = literal.startsWith("${") ? "MINIO_SECRET_KEY" : literal;
  if (!entrypoint.includes(expected)) {
    fail(
      file,
      `minio-init 的 entrypoint 未使用与 api 相同的 MINIO_SECRET_KEY（期望包含 ${expected}）`,
    );
  }
}

// --- 4. 内联版不得使用 ${} 插值或 profiles -----------------------------------
for (const file of INLINE_FILES) {
  const entry = loaded.get(file);
  if (!entry) continue;
  const { raw, doc } = entry;

  raw.split("\n").forEach((line, i) => {
    if (line.trim().startsWith("#")) return;
    if (/\$\{/.test(line)) {
      fail(file, `第 ${i + 1} 行使用了 \${} 插值，内联版必须写字面量`);
    }
  });

  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    if (svc.profiles) {
      fail(
        file,
        `服务 ${name} 带 profiles，NAS / 面板界面不会设 COMPOSE_PROFILES，会导致该服务不启动`,
      );
    }
  }
}

// --- 5. 对外只暴露 web 一个端口 ----------------------------------------------
// 其余服务要么不发布端口，要么只绑回环。
for (const file of FILES) {
  const { doc } = loaded.get(file);
  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    for (const mapping of svc.ports ?? []) {
      const spec = String(mapping);
      if (name === "web") continue;
      const boundToLoopback =
        spec.startsWith("127.0.0.1:") || spec.includes("${API_EXPOSE_BIND:-127.0.0.1}");
      if (!boundToLoopback) {
        fail(
          file,
          `服务 ${name} 把端口 ${spec} 发布到了所有网卡；对外应只暴露 web，其余需绑 127.0.0.1`,
        );
      }
    }
  }
}

// --- 6. api 与 worker 必须把同一个宿主机目录挂到 BACKUP_DIR --------------------
// 周期备份由 worker 写、备份列表与恢复由 api 读，只挂一边的表现是
// 「日志说备份成功，但管理页里一个文件都没有」，从任何一侧的日志都看不出原因。
for (const file of FILES) {
  const { doc } = loaded.get(file);
  const mounts = {};
  for (const service of APP_SERVICES) {
    const env = envOf(doc, service);
    const target = env?.BACKUP_DIR;
    if (target === undefined) {
      fail(file, `服务 ${service} 缺少 BACKUP_DIR（系统备份的落盘目录）`);
      continue;
    }
    const containerPath = String(target).replace(/^\$\{BACKUP_DIR:-(.*)\}$/, "$1");
    const volumes = (doc.services?.[service]?.volumes ?? []).map(String);
    const mount = volumes.find((entry) => entry.endsWith(`:${containerPath}`));
    if (!mount) {
      fail(file, `服务 ${service} 没有把宿主机目录挂到 ${containerPath}，备份文件会随容器一起丢`);
      continue;
    }
    mounts[service] = mount.slice(0, mount.length - containerPath.length - 1);
  }
  const hostPaths = [...new Set(Object.values(mounts))];
  if (hostPaths.length > 1) {
    fail(
      file,
      `api 与 worker 的备份目录挂载不一致 -> ${Object.entries(mounts)
        .map(([s, p]) => `${s}=${p}`)
        .join("  |  ")}`,
    );
  }
}

if (errors.length) {
  console.error(`compose 一致性校验失败（${errors.length} 项）：`);
  console.error(errors.map((e) => `  ✗ ${e}`).join("\n"));
  process.exit(1);
}

console.log(`compose 一致性校验通过（${FILES.length} 份文件）`);
