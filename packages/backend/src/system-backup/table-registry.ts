import { Prisma } from "@fin-nest/db";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValueKind } from "./system-backup.types";

/**
 * 备份要处理哪些表、每一列怎么编码，全部由 Prisma 的 DMMF 现算，**不维护手写清单**。
 *
 * 手写清单的失效方式很隐蔽：新加一张表忘了登记，备份照样成功，直到恢复完才发现数据没了。
 * 反过来，「不该备份的表」是少数且有明确理由，因此只维护排除名单。
 */

/**
 * 恢复时清空、但**不写进归档**的表。
 *
 * - `sessions`：登录态是设备现状，不是账本数据。归档里带着它，等于把恢复那一刻之前
 *   被吊销/过期的登录态一起复活。清空是必然的（它有指向 users 的外键，users 一truncate
 *   就会级联），发起恢复的那个管理员的会话由服务在恢复结束后单独补回，见 `SystemBackupService`。
 * - `idempotency_keys`：幂等占位缓存的是「上一次请求的响应」，恢复后那些响应指向的行已经不在了。
 */
const WIPE_ONLY_TABLES = new Set(["sessions", "idempotency_keys"]);

/**
 * 既不备份、也不清空的运维台账。
 *
 * 恢复过程本身要靠它们活着：`restore_records` 记进度（清了前端就查不到自己发起的那次），
 * `backup_records` 保住比归档更新的备份列表（清了等于恢复一次就丢掉后来的所有备份台账）。
 *
 * `backup_settings` 与 `background_jobs` 都是系统状态的一部分，必须正常备份和恢复。尤其自动记账
 * 完全依赖 `background_jobs` 唤醒：保留恢复前的队列会让旧任务作用于新数据，丢掉备份时的队列又会
 * 让恢复出来的规则永久停摆。
 */
const OPERATIONAL_TABLES = new Set(["backup_records", "restore_records"]);

export type BackupTable = {
  /** 数据库表名。 */
  name: string;
  /** Prisma 模型名。 */
  model: string;
  /** Prisma Client 上的 delegate 属性名（模型名首字母小写）。 */
  delegate: string;
  /** 标量列 → 编码方式。关系字段不落盘（外键列本身是标量，已包含在内）。 */
  valueKinds: Record<string, ValueKind>;
  /** 单列主键的字段名；复合主键或无主键时为 null（改用 skip/take 翻页）。 */
  cursorField: string | null;
};

type DmmfField = {
  name: string;
  kind: string;
  type: string;
  isId: boolean;
  isList: boolean;
};

function valueKindOf(field: DmmfField): ValueKind | null {
  switch (field.type) {
    case "String":
      return "string";
    case "Boolean":
      return "boolean";
    case "Int":
    case "Float":
      return "number";
    case "BigInt":
      return "bigint";
    case "DateTime":
      return "datetime";
    case "Json":
      return "json";
    case "Bytes":
      return "bytes";
    case "Decimal":
      // 金额一律 micros BIGINT，但非金额的小数仍会用到（如物品预计年限）。
      // 走字符串：Decimal 是 decimal.js 对象，转成 number 会丢精度。
      return "decimal";
    default:
      // enum 等在 PostgreSQL 侧是文本，按字符串走。
      return field.kind === "enum" ? "string" : null;
  }
}

let cached: BackupTable[] | null = null;

/** 归档要覆盖的表（不含只清空的和运维台账）。结果按模型定义顺序，实际写入/恢复顺序另按外键拓扑排。 */
export function backupTables(): BackupTable[] {
  if (cached) return cached;
  const tables: BackupTable[] = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const name = model.dbName ?? model.name;
    if (OPERATIONAL_TABLES.has(name) || WIPE_ONLY_TABLES.has(name)) continue;
    const valueKinds: Record<string, ValueKind> = {};
    let cursorField: string | null = null;
    let idCount = 0;
    for (const field of model.fields as unknown as DmmfField[]) {
      if (field.kind === "object") continue;
      const kind = valueKindOf(field);
      if (!kind) {
        throw new Error(`备份不支持的字段类型：${model.name}.${field.name} (${field.type})`);
      }
      valueKinds[field.name] = kind;
      if (field.isId) {
        idCount += 1;
        cursorField = field.name;
      }
    }
    tables.push({
      name,
      model: model.name,
      delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      valueKinds,
      // 复合主键（@@id）没有单列游标，行数也都很小，直接一次读完。
      cursorField: idCount === 1 && !model.primaryKey ? cursorField : null,
    });
  }
  cached = tables;
  return tables;
}

/** 恢复时要清空的全部表名（含只清空不备份的）。 */
export function wipeTableNames(): string[] {
  const names = Prisma.dmmf.datamodel.models
    .map((model) => model.dbName ?? model.name)
    .filter((name) => !OPERATIONAL_TABLES.has(name));
  return names;
}

/** JSONL 一行：把 Prisma 返回的运行时值编码成可 JSON 化的形式。 */
export function encodeRow(row: Record<string, unknown>, kinds: Record<string, ValueKind>): string {
  const encoded: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(kinds)) {
    const value = row[key];
    if (value === null || value === undefined) continue; // 缺字段 = null，省体积
    encoded[key] = encodeValue(value, kind);
  }
  return JSON.stringify(encoded);
}

function encodeValue(value: unknown, kind: ValueKind): unknown {
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, kind));
  switch (kind) {
    case "bigint":
      return typeof value === "bigint" ? value.toString() : value;
    case "datetime":
      return value instanceof Date ? value.toISOString() : value;
    case "bytes":
      return Buffer.isBuffer(value)
        ? value.toString("base64")
        : Buffer.from(value as Uint8Array).toString("base64");
    case "decimal":
      return String(value);
    default:
      return value;
  }
}

/**
 * JSONL 一行 → Prisma `createMany` 的入参。
 *
 * 按**当前** schema 的字段表解码：归档里多出来的列（旧版本删过的字段）直接丢弃，
 * 少掉的列交给数据库默认值。跨版本恢复因此不会整表失败，只会缺该列的历史值。
 */
export function decodeRow(line: string, kinds: Record<string, ValueKind>): Record<string, unknown> {
  const raw = JSON.parse(line) as Record<string, unknown>;
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const kind = kinds[key];
    if (!kind) continue;
    decoded[key] = value === null ? null : decodeValue(value, kind);
  }
  return decoded;
}

function decodeValue(value: unknown, kind: ValueKind): unknown {
  if (Array.isArray(value) && kind !== "json") {
    return value.map((item) => decodeValue(item, kind));
  }
  switch (kind) {
    case "bigint":
      return typeof value === "string" ? BigInt(value) : value;
    case "datetime":
      return typeof value === "string" ? new Date(value) : value;
    case "bytes":
      return typeof value === "string" ? Buffer.from(value, "base64") : value;
    default:
      return value;
  }
}

/**
 * 按外键依赖给表排序（被引用的表在前）。
 *
 * 外键写在原始 migration SQL 里、Prisma schema 基本没有关系字段，所以只能问数据库自己。
 * 有环（本项目没有）时把成环的表按原顺序追在末尾——宁可插入报错，也不要静默丢表。
 */
export async function topologicalTableOrder(
  prisma: PrismaService,
  tableNames: string[],
): Promise<string[]> {
  const rows = await prisma.client.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT DISTINCT
      child_cls.relname::text AS child,
      parent_cls.relname::text AS parent
    FROM pg_constraint c
    JOIN pg_class child_cls ON child_cls.oid = c.conrelid
    JOIN pg_class parent_cls ON parent_cls.oid = c.confrelid
    JOIN pg_namespace ns ON ns.oid = child_cls.relnamespace
    WHERE c.contype = 'f' AND ns.nspname = current_schema()
  `;
  const wanted = new Set(tableNames);
  const parents = new Map<string, Set<string>>(tableNames.map((name) => [name, new Set()]));
  for (const row of rows) {
    // 自引用（如分类的父子）在同一张表内靠插入顺序解决，不参与表间排序。
    if (row.child === row.parent) continue;
    if (!wanted.has(row.child) || !wanted.has(row.parent)) continue;
    parents.get(row.child)!.add(row.parent);
  }

  const ordered: string[] = [];
  const done = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const name of tableNames) {
      if (done.has(name)) continue;
      const pending = parents.get(name)!;
      if (Array.from(pending).every((parent) => done.has(parent))) {
        ordered.push(name);
        done.add(name);
        progressed = true;
      }
    }
  }
  for (const name of tableNames) if (!done.has(name)) ordered.push(name);
  return ordered;
}
