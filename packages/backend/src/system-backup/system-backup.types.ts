/**
 * 系统级备份归档的格式定义。
 *
 * 归档是一个 zip，内部结构固定为：
 * ```
 * manifest.json            清单（必须是第一个条目，恢复时先读它做校验）
 * README.txt               给「以后不再部署本系统」的人看的说明
 * database/<表名>.jsonl    每行一条记录，字段名用 Prisma 字段名，取值按 valueKinds 编码
 * files/<对象键>            附件原文（对象键即 MinIO 里的 object key，含目录层级）
 * excel/<账本>.xlsx        每个账本一份全量 Excel，脱离系统也能直接看数据
 * ```
 */

/**
 * 归档格式版本。
 *
 * v2 起 `manifest.files.missing` 列出「数据库有记录、但对象存储里取不到」的附件：备份不再因此
 * 整份失败，恢复据此知道缺条目是已知降级而不是归档损坏。v1 归档按 `missing: []` 读，语义不变。
 */
export const SYSTEM_BACKUP_FORMAT_VERSION = 2;

export const SYSTEM_BACKUP_APP = "fin-nest";
export const SYSTEM_BACKUP_KIND = "system-backup";

export const ARCHIVE_PATHS = {
  manifest: "manifest.json",
  readme: "README.txt",
  database: "database/",
  files: "files/",
  excel: "excel/",
} as const;

/** 归档文件名形如 `fin-nest-backup-20260801-030000-123.zip`；列目录时用它认自家备份。 */
export const BACKUP_FILE_PREFIX = "fin-nest-backup-";
export const BACKUP_FILE_SUFFIX = ".zip";
/** 写入中的临时后缀：只有写完并 rename 才会变成正式归档，避免半截文件被当成可恢复的备份。 */
export const BACKUP_TEMP_SUFFIX = ".part";

/**
 * 恢复时附件先写到本次任务的唯一前缀。
 *
 * key 只由两个固定长度 UUID 组成，不能拼旧 object key：后者会让「备份 → 恢复」每循环一次
 * 就多套一层前缀，最终撞上 S3/MinIO 的 object-key 长度上限。
 */
export function stagedRestoreObjectKey(restoreId: string, fileId: string): string {
  return `system-restores/${restoreId}/${fileId}`;
}

/** 一列在 JSONL 里的编码方式，恢复时据此还原成 Prisma 需要的运行时类型。 */
export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "datetime"
  | "json"
  | "bytes"
  | "decimal";

export type ManifestTable = {
  /** 数据库表名（`database/<name>.jsonl`）。 */
  name: string;
  /** Prisma 模型名，恢复时据此找到 delegate。 */
  model: string;
  /** 备份时刻的行数（统计用，恢复以实际读到的行数为准）。 */
  rows: number;
};

export type BackupManifest = {
  app: typeof SYSTEM_BACKUP_APP;
  kind: typeof SYSTEM_BACKUP_KIND;
  formatVersion: number;
  createdAt: string;
  /** 生成归档时的应用时区，供人工判读归档里的本地时间。 */
  timeZone: string;
  tables: ManifestTable[];
  files: {
    /** `files` 表的行数（含缺失对象的行——归档如实反映数据库）。 */
    count: number;
    /** 成功写进 `files/` 的附件字节数合计，**不含** `missing` 里的那些。 */
    bytes: string;
    /**
     * 数据库有记录、但对象存储里取不到的附件 object key。
     *
     * 这些附件在归档里没有 `files/` 条目。恢复时对应的 `files` 行与引用它的 `attachments`
     * 行会被丢弃——一次恢复即把这些悬空记录清理干净，不再拖着走。
     */
    missing: string[];
  };
  ledgers: Array<{ id: string; name: string }>;
};

export type BackupCounts = {
  tables: number;
  rows: number;
  /** 成功写进归档的附件数。 */
  files: number;
  fileBytes: string;
  ledgers: number;
  /** 数据库里有记录、但对象存储里已经取不到的附件数（不影响备份成功，前端会告警）。 */
  missingFiles: number;
};

export type RestoreCounts = {
  tables: number;
  rows: number;
  files: number;
  /** 归档里存在、但当前 schema 已经没有的表（跨版本恢复时跳过）。 */
  skippedTables: string[];
  /** 当前 schema 有、但归档里没有的表（跨版本恢复时留空表）。 */
  emptyTables: string[];
  /** 因附件对象缺失而被丢弃的 `files` 行数（连带丢弃引用它们的 attachments）。 */
  droppedFiles: number;
};

export type BackupArchiveInfo = {
  fileName: string;
  sizeBytes: string;
  modifiedAt: string;
  /** 目录里有文件但没有台账行（例如人工拷进来的归档）时为 null。 */
  record: {
    id: string;
    status: string;
    trigger: string;
    counts: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
};
