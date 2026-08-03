import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { loadConfig } from "@fin-nest/config";
import { Prisma } from "@fin-nest/db";
import { Client } from "minio";
import { AuditLogService } from "../audit/audit-log.service";
import { currentTimeKey, todayKey } from "../dates/date-only";
import { AppError } from "../errors/app-error";
import { ExcelWorkbookService } from "../excel/excel-workbook.service";
import { PrismaService } from "../prisma/prisma.service";
import type { PrismaTransactionClient } from "../transactions/database-transaction.service";
import { decideScheduledBackup } from "./backup-schedule";
import {
  backupTables,
  BackupTable,
  decodeRow,
  encodeRow,
  topologicalTableOrder,
  wipeTableNames,
} from "./table-registry";
import {
  ARCHIVE_PATHS,
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_SUFFIX,
  BACKUP_TEMP_SUFFIX,
  BackupArchiveInfo,
  BackupCounts,
  BackupManifest,
  RestoreCounts,
  SYSTEM_BACKUP_APP,
  SYSTEM_BACKUP_FORMAT_VERSION,
  SYSTEM_BACKUP_KIND,
  stagedRestoreObjectKey,
} from "./system-backup.types";
import { createZipWriter, openZipReader, readEntryText, ZipReader, ZipWriter } from "./zip-archive";

/** 单次数据库读写的批量大小。行都不大，1000 行一批在内存与往返次数之间比较平衡。 */
const ROW_CHUNK = 1000;

/** 备份/恢复抢占台账用的 advisory lock，与 auth.service 里的注册锁保持同一命名段。 */
const BACKUP_CLAIM_LOCK_KEY = 931733010;
/**
 * Worker/恢复切换门闩：Worker 整轮持共享锁，恢复开始时只有拿到排他锁才允许落 running 台账。
 * 必须与台账抢占锁分开，否则「Worker 持共享锁后发起周期备份」会和恢复形成锁顺序死锁。
 */
const RESTORE_GATE_LOCK_KEY = 931733011;

/** 进程崩溃会把台账行永久留在 running，超过这个时长即判定为中断，否则功能会被自己锁死。 */
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;
/** 周期备份失败后不要每 30 秒刷一条失败台账；短暂退避后当天仍会自动重试。 */
const SCHEDULE_RETRY_DELAY_MS = 5 * 60 * 1000;
/** 失败的自动备份台账保留条数：够排查即可，持续性故障不该把表撑爆。 */
const KEEP_FAILED_SCHEDULED_RECORDS = 20;

const README_TEXT = `Fin Nest 系统备份
==================

本压缩包是一次完整的系统级备份，包含：

  manifest.json   备份清单（生成时间、表与行数、账本列表）
  database/       全部业务数据，每张表一个 .jsonl 文件（每行一条 JSON 记录）
  files/          全部附件原文，路径即对象存储里的对象键
  excel/          每个账本一份 Excel 全量导出

如果你不打算继续部署 Fin Nest，直接看 excel/ 目录即可：
里面是可以用 Excel / Numbers / WPS 直接打开的账本数据（流水、账户、账户流水、
分类、成员、保险、物品、订阅、计划、预算），不依赖本系统的任何组件。

要恢复到一套 Fin Nest 中，把整个 .zip 放进部署时映射的备份目录，
然后在「更多 › 管理员功能 › 自动备份」里选中它执行恢复（需要管理员密码二次确认）。
恢复会先清空当前系统的全部数据。
`;

type BackupRunStats = { rows: number; files: number; fileBytes: bigint; missingFiles: number };
type BackupDbClient = Prisma.TransactionClient;
type StagedObject = { originalKey: string; stagedKey: string };
/** 对象存储里取不到（或大小对不上）的附件：object key 集合与它们在数据库里记的字节数。 */
type MissingObjects = { keys: Set<string>; bytes: bigint };

/**
 * 系统级备份与恢复。
 *
 * 定位与账本级的 `BackupService`（导出一个账本的 JSON）**不同**：这里是整套系统的快照，
 * 数据库所有业务表 + 对象存储所有附件 + 每个账本的 Excel，一起打进一个 zip 落到 BACKUP_DIR。
 *
 * HTTP 发起的长任务采用「先落台账行、再 fire-and-forget 执行」，前端轮询台账拿状态；worker
 * 的周期备份则等待结束再进入任务循环，避免停止信号砍断归档。互斥靠 advisory lock + running
 * 行判定，同一时刻只允许一个备份或恢复在跑。
 */
@Injectable()
export class SystemBackupService {
  private readonly config = loadConfig();
  private readonly minio = new Client({
    endPoint: this.config.MINIO_ENDPOINT,
    port: this.config.MINIO_PORT,
    useSSL: this.config.MINIO_USE_SSL,
    accessKey: this.config.MINIO_ACCESS_KEY,
    secretKey: this.config.MINIO_SECRET_KEY,
  });
  private readonly bucket = this.config.MINIO_BUCKET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelWorkbookService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // 备份目录
  // ---------------------------------------------------------------------------

  /** 归档落盘目录的绝对路径（相对路径按进程工作目录解析）。 */
  get directory(): string {
    return resolveBackupDir();
  }

  /** 目录是否已就绪。docker 里没映射卷时这里会报错，前端据此提示「先配置目录映射」。 */
  async ensureDirectory(): Promise<{ path: string; writable: boolean; error: string | null }> {
    try {
      await mkdir(this.directory, { recursive: true });
      await access(this.directory, fsConstants.R_OK | fsConstants.W_OK);
      return { path: this.directory, writable: true, error: null };
    } catch (error) {
      return { path: this.directory, writable: false, error: messageOf(error) };
    }
  }

  /**
   * 备份列表。**以目录里真实存在的文件为准**，台账只做补充。
   *
   * 这样人工拷进目录的归档（换机器、从别处拿来的备份）也能被看到并恢复，
   * 而台账里指向已被删除文件的行不会变成点不动的幽灵条目。
   */
  async listArchives(): Promise<BackupArchiveInfo[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const archives = names.filter(
      (name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX),
    );
    if (!archives.length) return [];

    const records = await this.prisma.client.backupRecord.findMany({
      where: { fileName: { in: archives } },
    });
    const recordByName = new Map(records.map((row) => [row.fileName, row]));

    const items: BackupArchiveInfo[] = [];
    for (const name of archives) {
      const info = await stat(join(this.directory, name)).catch(() => null);
      if (!info) continue;
      const record = recordByName.get(name);
      items.push({
        fileName: name,
        sizeBytes: info.size.toString(),
        modifiedAt: info.mtime.toISOString(),
        record: record
          ? {
              id: record.id,
              status: record.status,
              trigger: record.trigger,
              counts: record.counts,
              error: record.error,
              startedAt: record.startedAt.toISOString(),
              finishedAt: record.finishedAt?.toISOString() ?? null,
            }
          : null,
      });
    }
    // 新的在前：备份页第一眼要看的就是「最近一次备份是什么时候」。
    items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return items;
  }

  /** 最近一次备份台账独立返回：running/failed 时通常还没有正式 zip，不能只靠目录列表展示。 */
  async latestBackup() {
    // 必须在这里回收，不能只靠 claim()：前端看到 running 就会禁用「立即备份」，
    // 而那正是唯一能走到 claim() 的入口——API 在备份中途重启就会把功能锁死到过期为止。
    await this.reconcileStaleBackupRuns();
    return this.prisma.client.backupRecord.findFirst({ orderBy: { startedAt: "desc" } });
  }

  /** API 全局维护守卫与 worker 用它在恢复期间停止普通读写和后台任务。 */
  async isRestoreRunning(): Promise<boolean> {
    await this.reconcileStaleRestoreRuns();
    const running = await this.prisma.client.restoreRecord.count({ where: { status: "running" } });
    return running > 0;
  }

  /**
   * 在一次完整 Worker 批次外持共享门闩。
   *
   * 恢复先尝试取得同一把锁的排他模式再创建 running 台账，因此：
   * - 已经开始的 Worker 尚未跑完时，恢复请求会以 busy 返回、不会与它交叠；
   * - running 台账提交后，新 Worker 即使拿到共享锁也会立即退出。
   */
  async runWorkerBatch<T>(
    work: () => Promise<T>,
  ): Promise<{ ran: false } | { ran: true; value: T }> {
    await this.reconcileStaleRestoreRuns();
    return this.prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${RESTORE_GATE_LOCK_KEY})`;
        const running = await tx.restoreRecord.count({ where: { status: "running" } });
        if (running > 0) return { ran: false } as const;
        return { ran: true, value: await work() } as const;
      },
      { maxWait: 10_000, timeout: STALE_RUNNING_MS },
    );
  }

  /**
   * 归档文件的绝对路径。
   *
   * 文件名来自 HTTP 路径参数，必须挡死路径穿越——只接受本功能自己产出的命名形态，
   * 且不含任何分隔符，因此拼出来的路径一定落在备份目录内。
   */
  archivePath(fileName: string): string {
    const valid =
      fileName.startsWith(BACKUP_FILE_PREFIX) &&
      fileName.endsWith(BACKUP_FILE_SUFFIX) &&
      !fileName.includes("/") &&
      !fileName.includes("\\") &&
      !fileName.includes("\0") &&
      !fileName.includes("..");
    if (!valid) throw new AppError("BACKUP_FILE_INVALID", "备份文件名不合法", 400);
    return join(this.directory, fileName);
  }

  /**
   * 把上传上来的归档收编进备份目录。
   *
   * `tempPath` 是 multer 直接写在备份目录里的 `.part`（同盘，转正只是一次 rename；
   * 而且 `.part` 不进备份列表，中途放弃的残留会被 `pruneStaleTempArchives` 收走）。
   *
   * 这里只校验到 manifest 为止——「这是不是一份本系统能认的备份」当场就要有答案，
   * 而逐表逐附件的深度核对要整份读一遍归档，那是恢复前 `preflightRestore` 的活，
   * 在上传时再做一遍纯属重复，还会让一次上传卡住好几分钟。
   */
  async importArchive(
    input: { tempPath: string; originalName: string },
    actorUserId: string,
  ): Promise<BackupArchiveInfo> {
    let fileName: string;
    try {
      const reader = await openZipReader(input.tempPath).catch(() => {
        throw new AppError("BACKUP_FILE_INVALID", "文件不是有效的 zip 归档", 400);
      });
      let manifest: BackupManifest;
      try {
        const text = await readEntryText(reader, ARCHIVE_PATHS.manifest).catch(() => {
          throw new AppError(
            "BACKUP_MANIFEST_INVALID",
            "归档里没有 manifest.json，这不是 Fin Nest 的系统备份文件",
            400,
          );
        });
        // 版本过新、应用标识不符等都会在这里给出确切原因，不必等到恢复时才发现。
        manifest = parseManifest(text);
      } finally {
        reader.close();
      }

      fileName = importedArchiveName(input.originalName, manifest.createdAt);
      const target = this.archivePath(fileName);
      // 不覆盖同名归档：那可能是本机自己产出的备份，覆盖掉就没了。
      if (await stat(target).catch(() => null)) {
        throw new AppError(
          "BACKUP_FILE_EXISTS",
          `备份目录里已经有同名文件「${fileName}」，请先删除它再导入`,
          409,
        );
      }
      await rename(input.tempPath, target);
    } catch (error) {
      await rm(input.tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    await this.audit.write({
      source: "user",
      actorUserId,
      action: "system_backup.import",
      entityType: "system_backup",
      metadata: { fileName, originalName: input.originalName },
    });

    const info = await stat(this.archivePath(fileName));
    return {
      fileName,
      sizeBytes: info.size.toString(),
      modifiedAt: info.mtime.toISOString(),
      record: null,
    };
  }

  async deleteArchive(fileName: string, actorUserId: string): Promise<void> {
    const path = this.archivePath(fileName);
    const exists = await stat(path).catch(() => null);
    if (!exists) throw new AppError("BACKUP_FILE_NOT_FOUND", "备份文件不存在", 404);
    await rm(path);
    await this.prisma.client.backupRecord.deleteMany({ where: { fileName } });
    await this.audit.write({
      source: "user",
      actorUserId,
      action: "system_backup.delete",
      entityType: "system_backup",
      metadata: { fileName },
    });
  }

  // ---------------------------------------------------------------------------
  // 周期设置
  // ---------------------------------------------------------------------------

  async getSetting() {
    const existing = await this.prisma.client.backupSetting.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    // 首次访问才建行：迁移里塞一行默认值会让「从没配过」和「配成默认值」分不开。
    return this.prisma.client.backupSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  async updateSetting(
    patch: {
      enabled?: boolean;
      frequency?: string;
      weekdays?: number[];
      monthDays?: number[];
      runTime?: string;
      keepCount?: number;
    },
    actorUserId: string,
  ) {
    const current = await this.getSetting();
    const next = {
      enabled: patch.enabled ?? current.enabled,
      frequency: patch.frequency ?? current.frequency,
      weekdays: patch.weekdays ?? current.weekdays,
      monthDays: patch.monthDays ?? current.monthDays,
      runTime: patch.runTime ?? current.runTime,
      keepCount: patch.keepCount ?? current.keepCount,
    };
    if (next.enabled) {
      // 「每周一天不选 / 每月一号不选」的配置永远不会触发，是最难排查的一类静默失效。
      if (next.frequency === "weekly" && next.weekdays.length === 0) {
        throw new AppError("BACKUP_SCHEDULE_INVALID", "每周备份至少要选一天", 400);
      }
      if (next.frequency === "monthly" && next.monthDays.length === 0) {
        throw new AppError("BACKUP_SCHEDULE_INVALID", "每月备份至少要选一个日期", 400);
      }
    }
    const updated = await this.prisma.client.backupSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...next, updatedBy: actorUserId },
      update: { ...next, updatedBy: actorUserId },
    });
    // 立即执行新的保留份数。否则「把 7 份改成 2 份」要等到下一次周期备份成功才生效，
    // 而用户改小它的动机通常正是盘快满了。
    if (next.keepCount < current.keepCount) {
      await this.pruneScheduled(next.keepCount).catch(() => undefined);
    }
    await this.audit.write({
      source: "user",
      actorUserId,
      action: "system_backup.setting_update",
      entityType: "backup_setting",
      metadata: next as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 备份
  // ---------------------------------------------------------------------------

  /** 建台账行并后台执行。返回的行状态恒为 running，前端轮询列表拿最终结果。 */
  async startBackup(input: { trigger: "manual" | "scheduled"; userId: string | null }) {
    const record = await this.claimBackup(input);
    void this.runBackup(record.id, record.fileName);
    return record;
  }

  private async claimBackup(input: { trigger: "manual" | "scheduled"; userId: string | null }) {
    // worker 独自跑周期备份、没人打开备份页时，这里是清理崩溃残留的唯一入口。
    await this.reconcileStaleBackupRuns();
    const ready = await this.ensureDirectory();
    if (!ready.writable) {
      throw new AppError(
        "BACKUP_DIR_UNAVAILABLE",
        `备份目录不可写（${ready.path}）：${ready.error ?? "未知原因"}`,
        500,
      );
    }
    const fileName = `${BACKUP_FILE_PREFIX}${archiveStamp()}${BACKUP_FILE_SUFFIX}`;
    return this.claim((tx) =>
      tx.backupRecord.create({
        data: {
          fileName,
          status: "running",
          trigger: input.trigger,
          createdBy: input.userId,
          formatVersion: SYSTEM_BACKUP_FORMAT_VERSION,
        },
      }),
    );
  }

  private async runBackup(recordId: string, fileName: string): Promise<boolean> {
    const tmpPath = join(this.directory, `${fileName}${BACKUP_TEMP_SUFFIX}`);
    const finalPath = join(this.directory, fileName);
    const stats: BackupRunStats = { rows: 0, files: 0, fileBytes: 0n, missingFiles: 0 };
    const writer = createZipWriter(tmpPath);
    try {
      const tables = await this.orderedTables();
      const manifest = await this.prisma.client.$transaction(
        async (tx) => {
          const missing = await this.collectMissingObjects(tx);
          stats.missingFiles = missing.keys.size;
          const snapshotManifest = await this.buildManifest(tables, tx, missing);
          // 数据库与 Excel 全部从同一个 repeatable-read 快照读取，避免备份期间记账导致父子表错位。
          await writer.append(
            Buffer.from(JSON.stringify(snapshotManifest, null, 2), "utf-8"),
            ARCHIVE_PATHS.manifest,
          );
          await writer.append(Buffer.from(README_TEXT, "utf-8"), ARCHIVE_PATHS.readme);
          for (const table of tables) {
            await writer.append(
              lazyStream(this.streamTableRows(table, stats, tx)),
              `${ARCHIVE_PATHS.database}${table.name}.jsonl`,
            );
          }
          await this.appendFileObjects(writer, stats, tx, missing.keys);
          for (const ledger of snapshotManifest.ledgers) {
            await writer.append(
              lazyStream(this.streamLedgerWorkbook(ledger.id, tx)),
              `${ARCHIVE_PATHS.excel}${excelEntryName(ledger)}`,
            );
          }
          return snapshotManifest;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 10_000,
          timeout: STALE_RUNNING_MS,
        },
      );
      const expectedFiles = manifest.files.count - manifest.files.missing.length;
      if (stats.files !== expectedFiles) {
        throw new AppError(
          "BACKUP_FILES_INCOMPLETE",
          `附件备份不完整：应有 ${expectedFiles} 个，实际写入 ${stats.files} 个`,
          500,
        );
      }
      if (stats.fileBytes !== BigInt(manifest.files.bytes)) {
        throw new AppError("BACKUP_FILES_INCOMPLETE", "附件大小与数据库记录不一致", 500);
      }
      if (stats.rows !== manifest.tables.reduce((sum, table) => sum + table.rows, 0)) {
        throw new AppError("BACKUP_ROWS_INCOMPLETE", "数据库备份行数与清单不一致", 500);
      }
      await writer.finalize();
      await rename(tmpPath, finalPath);

      const size = await stat(finalPath);
      const counts: BackupCounts = {
        tables: tables.length,
        rows: stats.rows,
        files: stats.files,
        fileBytes: stats.fileBytes.toString(),
        ledgers: manifest.ledgers.length,
        missingFiles: stats.missingFiles,
      };
      const claimed = await this.prisma.client.backupRecord.updateMany({
        where: { id: recordId, status: "running" },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          sizeBytes: BigInt(size.size),
          counts: counts as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count === 0) {
        // 跑满 STALE_RUNNING_MS 后台账已被判失败、名额也已让给别人。归档虽然完好，
        // 留在目录里就成了一份「台账说失败、文件却能恢复」的矛盾条目，直接撤掉。
        await rm(finalPath, { force: true }).catch(() => undefined);
        return false;
      }
      return true;
    } catch (error) {
      writer.abort();
      // 半截归档不能留在目录里：它会出现在备份列表里，看着像一份能恢复的备份。
      await rm(tmpPath, { force: true }).catch(() => undefined);
      await this.prisma.client.backupRecord
        .updateMany({
          where: { id: recordId, status: "running" },
          data: {
            status: "failed",
            finishedAt: new Date(),
            error: messageOf(error).slice(0, 2000),
          },
        })
        .catch(() => undefined);
      return false;
    }
  }

  private async buildManifest(
    tables: BackupTable[],
    client: BackupDbClient,
    missing: MissingObjects,
  ): Promise<BackupManifest> {
    // 逐张数，不 Promise.all：表有五十来张，一次性并发会瞬间占满连接池，
    // 后面真正干活的查询只能排队等 10s 超时。count 很快，串行也就百来毫秒。
    const rows: number[] = [];
    for (const table of tables) {
      rows.push(await (this.delegate(table.delegate, client).count() as Promise<number>));
    }
    const [ledgers, fileAgg] = await Promise.all([
      client.ledger.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      client.file.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    ]);
    return {
      app: SYSTEM_BACKUP_APP,
      kind: SYSTEM_BACKUP_KIND,
      formatVersion: SYSTEM_BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
      tables: tables.map((table, index) => ({
        name: table.name,
        model: table.model,
        rows: rows[index] ?? 0,
      })),
      files: {
        count: fileAgg._count._all,
        // bytes 只统计真正写进归档的部分，缺失的那些从合计里扣掉。
        bytes: ((fileAgg._sum.sizeBytes ?? 0n) - missing.bytes).toString(),
        missing: Array.from(missing.keys).sort(),
      },
      ledgers,
    };
  }

  /** 按外键拓扑排好序的表清单：写入与恢复都用这个顺序，恢复时父表一定先于子表插入。 */
  private async orderedTables(): Promise<BackupTable[]> {
    const tables = backupTables();
    const byName = new Map(tables.map((table) => [table.name, table]));
    const order = await topologicalTableOrder(this.prisma, Array.from(byName.keys()));
    return order.map((name) => byName.get(name)!).filter(Boolean);
  }

  private async *streamTableRows(
    table: BackupTable,
    stats: BackupRunStats,
    client: BackupDbClient,
  ): AsyncGenerator<string> {
    const delegate = this.delegate(table.delegate, client);
    let cursor: unknown;
    let skipped = 0;
    for (;;) {
      const args: Record<string, unknown> = { take: ROW_CHUNK };
      if (table.cursorField) {
        args.orderBy = { [table.cursorField]: "asc" };
        if (cursor !== undefined) {
          args.cursor = { [table.cursorField]: cursor };
          args.skip = 1;
        }
      } else {
        args.skip = skipped;
      }
      const rows = (await delegate.findMany(args)) as Array<Record<string, unknown>>;
      if (!rows.length) return;
      let chunk = "";
      for (const row of rows) {
        chunk += `${encodeRow(row, table.valueKinds)}\n`;
        stats.rows += 1;
      }
      yield chunk;
      if (rows.length < ROW_CHUNK) return;
      if (table.cursorField) cursor = rows[rows.length - 1]![table.cursorField];
      else skipped += rows.length;
    }
  }

  /**
   * 附件原文。
   *
   * 先 `statObject` 再挂流：zip 条目一旦追加就无法撤回，直接挂流会写出一个 0 字节的假附件。
   *
   * 取不到的对象**不让整份备份失败**。`files` 行与对象存储不同步是会真实发生的
   * （`purgeObject` 先删对象后删行，中间崩溃就留下悬空行；删除任务也可能耗尽重试），
   * 而这种行没有任何 API 能清掉。中止备份等于让一条垃圾记录把整个备份功能永久锁死——
   * 一份缺了个别附件的备份远比没有备份好。缺失清单写进 manifest，前端据此告警，
   * 恢复时把这些行连同引用它们的 attachments 一起丢掉，一次恢复即自愈。
   *
   * 大小对不上按同样的口径处理：以实际写进归档的字节为准，原行记入缺失。
   *
   * 缺失判定单独一趟（`collectMissingObjects`）跑在写 manifest 之前——manifest 要带上缺失清单，
   * 而它必须是归档的第一个条目。两趟之间的极窄窗口里对象若被删掉，本次备份会失败，
   * 但下一次的第一趟就会把它判成缺失，不会重演「永久失败」。
   */
  private async appendFileObjects(
    writer: ZipWriter,
    stats: BackupRunStats,
    client: BackupDbClient,
    missing: ReadonlySet<string>,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const files = await client.file.findMany({
        take: ROW_CHUNK,
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, bucket: true, objectKey: true, sizeBytes: true },
      });
      if (!files.length) return;
      for (const file of files) {
        if (missing.has(file.objectKey)) continue;
        await writer.append(
          lazyStream(this.streamObject(file.bucket, file.objectKey)),
          `${ARCHIVE_PATHS.files}${file.objectKey}`,
        );
        stats.files += 1;
        // 第一趟已核对过 statObject 与本行一致，这里直接记账，省掉一轮 HEAD。
        stats.fileBytes += file.sizeBytes;
      }
      if (files.length < ROW_CHUNK) return;
      cursor = files[files.length - 1]!.id;
    }
  }

  /**
   * 第一趟：找出对象存储里取不到、或大小与 `files` 行对不上的附件。
   *
   * 只留下异常的那些 key（正常情况是空集），不缓存全量元数据。
   */
  private async collectMissingObjects(client: BackupDbClient): Promise<MissingObjects> {
    const result: MissingObjects = { keys: new Set<string>(), bytes: 0n };
    let cursor: string | undefined;
    for (;;) {
      const files = await client.file.findMany({
        take: ROW_CHUNK,
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, bucket: true, objectKey: true, sizeBytes: true },
      });
      if (!files.length) return result;
      for (const file of files) {
        const info = await this.minio.statObject(file.bucket, file.objectKey).catch(() => null);
        const size = info ? BigInt(Math.max(0, Math.trunc(info.size))) : null;
        if (size === null || size !== file.sizeBytes) {
          result.keys.add(file.objectKey);
          result.bytes += file.sizeBytes;
        }
      }
      if (files.length < ROW_CHUNK) return result;
      cursor = files[files.length - 1]!.id;
    }
  }

  /** 生成器体在被消费时才执行，因此对象与 Excel 都是「轮到写它了才去取」，不会同时打开成百上千个流。 */
  private async *streamObject(bucket: string, objectKey: string): AsyncGenerator<Buffer> {
    const stream = await this.minio.getObject(bucket, objectKey);
    for await (const chunk of stream) yield chunk as Buffer;
  }

  private async *streamLedgerWorkbook(
    ledgerId: string,
    client: BackupDbClient,
  ): AsyncGenerator<Buffer> {
    yield await this.excel.buildWorkbook(ledgerId, { template: false }, client);
  }

  // ---------------------------------------------------------------------------
  // 恢复
  // ---------------------------------------------------------------------------

  /**
   * 建恢复台账并后台执行。
   *
   * `actorSessionId` 是发起恢复的那个管理员的会话：恢复会清空 sessions（它有指向 users 的外键，
   * users 一 truncate 就级联），不补回来的话页面会在恢复中途掉线，连结果都看不到。
   * 只有当恢复后的数据里仍然存在这个用户时才补——恢复的是别处的备份就应该乖乖重新登录。
   */
  async startRestore(input: { fileName: string; userId: string; sessionId: string | null }) {
    const path = this.archivePath(input.fileName);
    const exists = await stat(path).catch(() => null);
    if (!exists) throw new AppError("BACKUP_FILE_NOT_FOUND", "备份文件不存在", 404);

    const record = await this.claim(
      (tx) =>
        tx.restoreRecord.create({
          data: { fileName: input.fileName, status: "running", createdBy: input.userId },
        }),
      { restore: true },
    );
    void this.runRestore(record.id, input.fileName, input.userId, input.sessionId);
    return record;
  }

  async latestRestore() {
    // 备份总览 GET 被维护守卫放行；在这里也做回收，确保管理员只停留在轮询页时仍能自愈。
    await this.reconcileStaleRestoreRuns();
    return this.prisma.client.restoreRecord.findFirst({ orderBy: { startedAt: "desc" } });
  }

  private async runRestore(
    restoreId: string,
    fileName: string,
    actorUserId: string,
    actorSessionId: string | null,
  ): Promise<void> {
    const reader = await openZipReader(this.archivePath(fileName)).catch(() => null);
    if (!reader) {
      await this.failRestore(restoreId, "备份文件无法打开，可能已损坏");
      return;
    }
    try {
      const client = this.prisma.client;
      const manifest = parseManifest(await readEntryText(reader, ARCHIVE_PATHS.manifest));
      const tables = await this.orderedTables();
      const entryNames = new Set(reader.entries.map((entry) => entry.name));

      // 真正碰现有数据前，完整读一遍数据库条目并核对附件/Excel。损坏归档必须在 TRUNCATE 前失败。
      const preflight = await this.preflightRestore(reader, manifest, tables, entryNames);
      const actorSession = actorSessionId
        ? await client.session.findUnique({ where: { id: actorSessionId } })
        : null;
      const staleObjects = await this.collectObjectKeys();
      const staged = await this.stageRestoreObjects(reader, preflight.files, restoreId);
      const stagedByOriginal = new Map(staged.map((item) => [item.originalKey, item.stagedKey]));
      let committed = false;
      let counts: RestoreCounts;
      try {
        counts = await client.$transaction(
          async (tx) => {
            const restored: RestoreCounts = {
              tables: 0,
              rows: 0,
              files: staged.length,
              skippedTables: [...preflight.skippedTables],
              emptyTables: [],
              droppedFiles: preflight.droppedFileIds.size,
            };
            // PostgreSQL 的 TRUNCATE 可在事务中回滚；后续任一 createMany 失败时旧系统会完整保留。
            await this.wipeAllTables(tx);
            for (const table of tables) {
              const entryName = `${ARCHIVE_PATHS.database}${table.name}.jsonl`;
              if (!entryNames.has(entryName)) {
                restored.emptyTables.push(table.name);
                continue;
              }
              restored.rows += await this.restoreTable(
                reader,
                entryName,
                table,
                tx,
                stagedByOriginal,
                preflight.droppedFileIds,
              );
              restored.tables += 1;
            }

            if (actorSession) {
              const stillExists = await tx.user.findUnique({
                where: { id: actorSession.userId },
                select: { id: true },
              });
              if (stillExists) await tx.session.create({ data: actorSession });
            }
            return restored;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: STALE_RUNNING_MS,
          },
        );
        committed = true;
      } finally {
        if (!committed)
          await this.removeObjects(
            this.bucket,
            staged.map((item) => item.stagedKey),
          );
      }

      // 数据库已经原子指向预存对象；旧系统的附件此时才可安全清理，失败只会留下无引用对象。
      for (const group of groupObjectKeysByBucket(staleObjects)) {
        await this.removeObjects(group.bucket, group.objectKeys);
      }

      await client.restoreRecord.updateMany({
        where: { id: restoreId, status: "running" },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          counts: counts as unknown as Prisma.InputJsonValue,
        },
      });
      // 审计写在恢复之后：audit_logs 本身也被清空并按归档重建，写在前面会被一起冲掉。
      await this.audit
        .write({
          source: "user",
          actorUserId,
          action: "system_backup.restore",
          entityType: "system_backup",
          metadata: {
            fileName,
            createdAt: manifest.createdAt,
            rows: counts.rows,
            files: counts.files,
          },
        })
        .catch(() => undefined);
    } catch (error) {
      await this.failRestore(restoreId, messageOf(error));
    } finally {
      reader.close();
    }
  }

  private async failRestore(restoreId: string, message: string): Promise<void> {
    await this.prisma.client.restoreRecord
      .updateMany({
        where: { id: restoreId, status: "running" },
        data: { status: "failed", finishedAt: new Date(), error: message.slice(0, 2000) },
      })
      .catch(() => undefined);
  }

  /** 一条 TRUNCATE 搞定全部表：逐表 DELETE 会被外键挡住，分多条 TRUNCATE 同样如此。 */
  private async wipeAllTables(client: BackupDbClient): Promise<void> {
    const names = wipeTableNames()
      .map((name) => `"${name}"`)
      .join(", ");
    await client.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }

  private async restoreTable(
    reader: ZipReader,
    entryName: string,
    table: BackupTable,
    client: BackupDbClient,
    stagedByOriginal: Map<string, string>,
    droppedFileIds: ReadonlySet<string>,
  ): Promise<number> {
    const stream = await reader.openStream(entryName);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const delegate = this.delegate(table.delegate, client);
    let buffer: Array<Record<string, unknown>> = [];
    let total = 0;
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = decodeRow(line, table.valueKinds);
      if (table.name === "files") {
        // 备份时对象就已经不存在的行：连同它的附件引用一起丢掉，恢复一次即清干净。
        if (typeof row.id === "string" && droppedFileIds.has(row.id)) continue;
        const originalKey = row.objectKey;
        const stagedKey =
          typeof originalKey === "string" ? stagedByOriginal.get(originalKey) : null;
        if (!stagedKey) throw new Error(`附件缺少预存对象：${String(originalKey)}`);
        row.bucket = this.bucket;
        row.objectKey = stagedKey;
      }
      // attachments.file_id 有指向 files 的外键，被丢弃的 file 行必须连引用一起去掉。
      if (
        table.name === "attachments" &&
        typeof row.fileId === "string" &&
        droppedFileIds.has(row.fileId)
      ) {
        continue;
      }
      buffer.push(row);
      if (buffer.length >= ROW_CHUNK) {
        await delegate.createMany({ data: buffer });
        total += buffer.length;
        buffer = [];
      }
    }
    if (buffer.length) {
      await delegate.createMany({ data: buffer });
      total += buffer.length;
    }
    return total;
  }

  /** 清库前完整读取并核对归档；返回需要预存的附件清单。 */
  private async preflightRestore(
    reader: ZipReader,
    manifest: BackupManifest,
    tables: BackupTable[],
    entryNames: Set<string>,
  ): Promise<{
    files: Array<{ id: string; objectKey: string; sizeBytes: number }>;
    skippedTables: string[];
    /** 归档已声明缺失对象的 `files` 行 id，恢复时连同引用它们的 attachments 一起丢弃。 */
    droppedFileIds: Set<string>;
  }> {
    const currentByName = new Map(tables.map((table) => [table.name, table]));
    const entryByName = new Map(reader.entries.map((entry) => [entry.name, entry]));
    const knownMissing = new Set(manifest.files.missing);
    const skippedTables: string[] = [];
    const droppedFileIds = new Set<string>();
    const files: Array<{ id: string; objectKey: string; sizeBytes: number }> = [];
    for (const manifestTable of manifest.tables) {
      const entryName = `${ARCHIVE_PATHS.database}${manifestTable.name}.jsonl`;
      if (!entryNames.has(entryName)) {
        throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", `备份缺少数据库条目：${entryName}`, 400);
      }
      const table = currentByName.get(manifestTable.name);
      if (!table) skippedTables.push(manifestTable.name);
      const stream = await reader.openStream(entryName);
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let rows = 0;
      for await (const line of lines) {
        if (!line.trim()) continue;
        rows += 1;
        const decoded = table ? decodeRow(line, table.valueKinds) : JSON.parse(line);
        if (manifestTable.name === "files") {
          const row = decoded as Record<string, unknown>;
          if (
            typeof row.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              row.id,
            ) ||
            typeof row.objectKey !== "string" ||
            typeof row.sizeBytes !== "bigint"
          ) {
            throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", "附件数据库条目格式无效", 400);
          }
          // 备份时就取不到对象的附件：归档里本来就没有条目，丢弃该行而不是判归档损坏。
          if (knownMissing.has(row.objectKey)) {
            droppedFileIds.add(row.id);
            continue;
          }
          const fileEntry = `${ARCHIVE_PATHS.files}${row.objectKey}`;
          const archiveEntry = entryByName.get(fileEntry);
          if (!archiveEntry) {
            throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", `备份缺少附件：${row.objectKey}`, 400);
          }
          if (BigInt(archiveEntry.sizeBytes) !== row.sizeBytes) {
            throw new AppError(
              "BACKUP_ARCHIVE_INCOMPLETE",
              `附件大小不一致：${row.objectKey}`,
              400,
            );
          }
          files.push({ id: row.id, objectKey: row.objectKey, sizeBytes: archiveEntry.sizeBytes });
        }
      }
      if (rows !== manifestTable.rows) {
        throw new AppError(
          "BACKUP_ARCHIVE_INCOMPLETE",
          `数据库条目行数不一致：${manifestTable.name}（清单 ${manifestTable.rows}，实际 ${rows}）`,
          400,
        );
      }
    }

    if (files.length !== manifest.files.count - manifest.files.missing.length) {
      throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", "附件数量与备份清单不一致", 400);
    }
    let manifestFileBytes: bigint;
    try {
      manifestFileBytes = BigInt(manifest.files.bytes);
    } catch {
      throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单的附件大小无效", 400);
    }
    const actualFileBytes = files.reduce((sum, file) => sum + BigInt(file.sizeBytes), 0n);
    if (actualFileBytes !== manifestFileBytes) {
      throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", "附件总大小与备份清单不一致", 400);
    }
    const expectedFileEntries = new Set(
      files.map((file) => `${ARCHIVE_PATHS.files}${file.objectKey}`),
    );
    const actualFileEntries = reader.entries.filter((entry) =>
      entry.name.startsWith(ARCHIVE_PATHS.files),
    );
    if (actualFileEntries.some((entry) => !expectedFileEntries.has(entry.name))) {
      throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", "备份中存在没有数据库记录的附件", 400);
    }
    for (const ledger of manifest.ledgers) {
      const excelEntry = `${ARCHIVE_PATHS.excel}${excelEntryName(ledger)}`;
      if (!entryNames.has(excelEntry)) {
        throw new AppError("BACKUP_ARCHIVE_INCOMPLETE", `备份缺少账本 Excel：${ledger.name}`, 400);
      }
    }
    return { files, skippedTables, droppedFileIds };
  }

  /** 附件先写入唯一前缀，全部成功后数据库事务才会切换过去。 */
  private async stageRestoreObjects(
    reader: ZipReader,
    files: Array<{ id: string; objectKey: string; sizeBytes: number }>,
    restoreId: string,
  ): Promise<StagedObject[]> {
    if (files.length > 0 && !(await this.minio.bucketExists(this.bucket))) {
      await this.minio.makeBucket(this.bucket);
    }
    const staged: StagedObject[] = [];
    try {
      for (const file of files) {
        const stagedKey = stagedRestoreObjectKey(restoreId, file.id);
        const stream = await reader.openStream(`${ARCHIVE_PATHS.files}${file.objectKey}`);
        await this.minio.putObject(this.bucket, stagedKey, stream, file.sizeBytes);
        const written = await this.minio.statObject(this.bucket, stagedKey);
        if (Math.trunc(written.size) !== file.sizeBytes) {
          throw new Error(`附件预存大小不一致：${file.objectKey}`);
        }
        staged.push({ originalKey: file.objectKey, stagedKey });
      }
      return staged;
    } catch (error) {
      await this.removeObjects(
        this.bucket,
        staged.map((item) => item.stagedKey),
      );
      throw error;
    }
  }

  private async collectObjectKeys(): Promise<Array<{ bucket: string; objectKey: string }>> {
    return this.prisma.client.file.findMany({ select: { bucket: true, objectKey: true } });
  }

  private async removeObjects(bucket: string, objectKeys: string[]): Promise<void> {
    for (let index = 0; index < objectKeys.length; index += ROW_CHUNK) {
      await this.minio
        .removeObjects(bucket, objectKeys.slice(index, index + ROW_CHUNK))
        .catch(() => undefined);
    }
  }

  /**
   * 回收崩溃遗留的恢复任务，并清掉没有被当前数据库引用的预存附件。
   *
   * 进程可能在数据库提交后、台账改 succeeded 前崩溃，所以不能粗暴删除整个任务前缀；
   * `files` 仍引用的 key 是已经生效的业务附件，必须保留。
   */
  private async reconcileStaleRestoreRuns(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
    const stale = await this.prisma.client.restoreRecord.findMany({
      where: { status: "running", startedAt: { lt: staleBefore } },
      select: { id: true },
    });
    if (stale.length === 0) return;
    const ids = stale.map((row) => row.id);
    await this.prisma.client.restoreRecord.updateMany({
      where: { id: { in: ids }, status: "running", startedAt: { lt: staleBefore } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: "任务中断（进程重启或超时）",
      },
    });
    for (const id of ids) await this.cleanupUnreferencedRestoreObjects(id);
  }

  /**
   * 回收崩溃遗留的备份任务，并清掉它写了一半的临时归档。
   *
   * 与恢复那边对称。`.part` 不在备份列表里（按 `.zip` 过滤），没人清理就会在备份卷上
   * 静默堆积到写满盘——而写满盘的直接后果又是备份失败。
   */
  private async reconcileStaleBackupRuns(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
    await this.prisma.client.backupRecord.updateMany({
      where: { status: "running", startedAt: { lt: staleBefore } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: "任务中断（进程重启或超时）",
      },
    });
    // 无条件清理，不能只在「本次刚判失败」时做：崩溃瞬间 .part 的 mtime 往往比台账
    // startedAt 更晚，台账过期那一刻文件还不算旧，只跑一次就永远漏掉它。
    await this.pruneStaleTempArchives();
  }

  /** 删除超过判定时长仍未转正的 `.part`：正在写的那份不会这么老。 */
  private async pruneStaleTempArchives(): Promise<void> {
    try {
      const names = await readdir(this.directory);
      const staleBefore = Date.now() - STALE_RUNNING_MS;
      for (const name of names) {
        if (!name.startsWith(BACKUP_FILE_PREFIX) || !name.endsWith(BACKUP_TEMP_SUFFIX)) continue;
        const path = join(this.directory, name);
        const info = await stat(path).catch(() => null);
        if (!info || info.mtimeMs >= staleBefore) continue;
        await rm(path, { force: true }).catch(() => undefined);
      }
    } catch {
      // 清理是尽力而为：目录不可读时备份本身也会以明确的错误失败，不必在这里报。
    }
  }

  private async cleanupUnreferencedRestoreObjects(restoreId: string): Promise<void> {
    const prefix = `system-restores/${restoreId}/`;
    try {
      if (!(await this.minio.bucketExists(this.bucket))) return;
      const referenced = await this.prisma.client.file.findMany({
        where: { bucket: this.bucket, objectKey: { startsWith: prefix } },
        select: { objectKey: true },
      });
      const referencedKeys = new Set(referenced.map((row) => row.objectKey));
      const orphaned: string[] = [];
      for await (const object of this.minio.listObjectsV2(this.bucket, prefix, true)) {
        if (object.name && !referencedKeys.has(object.name)) orphaned.push(object.name);
      }
      await this.removeObjects(this.bucket, orphaned);
    } catch {
      // 自愈的首要目标是退出维护态；对象清理失败只会留下无引用文件，下次人工维护仍可处理。
    }
  }

  // ---------------------------------------------------------------------------
  // 周期调度（worker 每轮调用）
  // ---------------------------------------------------------------------------

  /**
   * 到点则发起一次自动备份，并按保留份数清理旧档。
   *
   * 与订阅提醒同样是「扫表判定」而不是排队：周期配置随时可改，排好的 job 每次改动都要回收。
   */
  async runScheduled(): Promise<{ started: boolean; pruned: number }> {
    const setting = await this.prisma.client.backupSetting.findUnique({ where: { id: 1 } });
    if (!setting) return { started: false, pruned: 0 };
    const decision = decideScheduledBackup(setting, currentTimeKey(), todayKey());
    if (!decision.due) return { started: false, pruned: 0 };
    const recentFailure = await this.prisma.client.backupRecord.findFirst({
      where: {
        trigger: "scheduled",
        status: "failed",
        startedAt: { gte: new Date(Date.now() - SCHEDULE_RETRY_DELAY_MS) },
      },
      select: { id: true },
    });
    if (recentFailure) return { started: false, pruned: 0 };
    // 放在这里而不是 pruneScheduled 里：持续性故障永远走不到成功路径，
    // 而正是那种情况会每 5 分钟堆一条失败台账。
    await this.pruneFailedScheduledRecords();

    // running 台账本身就是跨 worker 的占位；只有真正成功后才写 lastRunKey。失败时保留未执行状态，
    // 下一轮会重试，而不是把一次目录/MinIO 瞬时故障误记成「今天已经备份」。
    const record = await this.claimBackup({ trigger: "scheduled", userId: null });
    const succeeded = await this.runBackup(record.id, record.fileName);
    if (!succeeded) return { started: true, pruned: 0 };
    await this.prisma.client.backupSetting.updateMany({
      where: { id: 1 },
      data: {
        // 备份可能跨过午夜：写「开始那天」会让刚备完的今天再排一次。取两者较大的一个。
        lastRunKey: maxKey(decision.runKey, todayKey()),
      },
    });
    const pruned = await this.pruneScheduled(setting.keepCount);
    return { started: true, pruned };
  }

  /** 只清理自动备份：手动备份是人主动留的，不该被保留策略悄悄删掉。 */
  async pruneScheduled(keepCount: number): Promise<number> {
    if (keepCount <= 0) return 0;
    const records = await this.prisma.client.backupRecord.findMany({
      where: { trigger: "scheduled", status: "succeeded" },
      orderBy: { startedAt: "desc" },
      skip: keepCount,
    });
    let pruned = 0;
    for (const record of records) {
      await rm(join(this.directory, record.fileName), { force: true }).catch(() => undefined);
      await this.prisma.client.backupRecord
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      pruned += 1;
    }
    return pruned;
  }

  /**
   * 失败的自动备份台账只留最近若干条。
   *
   * 它们没有对应文件，保留策略也不看它们，而持续性故障会让 worker 每 5 分钟写一条，
   * 一天近三百行。留最近几条足够排查，再多只是噪音。
   */
  private async pruneFailedScheduledRecords(): Promise<void> {
    const stale = await this.prisma.client.backupRecord.findMany({
      where: { trigger: "scheduled", status: "failed" },
      orderBy: { startedAt: "desc" },
      skip: KEEP_FAILED_SCHEDULED_RECORDS,
      select: { id: true },
    });
    if (!stale.length) return;
    await this.prisma.client.backupRecord
      .deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  /**
   * 抢占「同一时刻只有一个备份或恢复」。
   *
   * 检查与插入必须在同一个事务里由 advisory lock 串起来，否则两个请求会同时看到「没有 running」。
   */
  private async claim<T>(
    create: (tx: PrismaTransactionClient) => Promise<T>,
    options: { restore?: boolean } = {},
  ): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      // 锁顺序恒为 gate → claim。Worker 也是先持 gate 再由周期备份拿 claim，避免交叉死锁。
      if (options.restore) {
        const [gate] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${RESTORE_GATE_LOCK_KEY}) AS acquired
        `;
        if (!gate?.acquired) {
          // 门闩被 worker 整轮持有，而那一轮可能正在跑周期备份——那是几十分钟量级，不是「一会儿」。
          throw new AppError(
            "BACKUP_BUSY",
            "后台任务正在执行（可能正在生成周期备份），需等它结束才能恢复，请稍后重试",
            409,
          );
        }
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BACKUP_CLAIM_LOCK_KEY})`;
      const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
      const staleError = "任务中断（进程重启或超时）";
      await tx.backupRecord.updateMany({
        where: { status: "running", startedAt: { lt: staleBefore } },
        data: { status: "failed", finishedAt: new Date(), error: staleError },
      });
      await tx.restoreRecord.updateMany({
        where: { status: "running", startedAt: { lt: staleBefore } },
        data: { status: "failed", finishedAt: new Date(), error: staleError },
      });
      const [backups, restores] = await Promise.all([
        tx.backupRecord.count({ where: { status: "running" } }),
        tx.restoreRecord.count({ where: { status: "running" } }),
      ]);
      if (backups > 0 || restores > 0) {
        throw new AppError("BACKUP_BUSY", "已有备份或恢复任务正在进行，请稍后再试", 409);
      }
      return create(tx);
    });
  }

  private delegate(name: string, source: BackupDbClient = this.prisma.client) {
    const client = source as unknown as Record<
      string,
      {
        findMany: (args: unknown) => Promise<unknown>;
        createMany: (args: unknown) => Promise<unknown>;
        count: (args?: unknown) => Promise<number>;
      }
    >;
    const delegate = client[name];
    if (!delegate) throw new Error(`Prisma client 上没有 ${name} delegate`);
    return delegate;
  }
}

/**
 * 归档落盘目录的绝对路径。
 *
 * 独立成函数是因为上传导入的 multer storage 要在**服务实例之外**决定落盘位置：
 * 上传必须直接写进备份目录，之后转正只是同盘 rename——先落临时目录再拷贝，
 * 一份上 GB 的归档要整份搬一遍，还可能跨设备失败。
 */
export function resolveBackupDir(): string {
  const configured = loadConfig().BACKUP_DIR;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/** 归档文件名里的时间戳，用应用时区的本地时间——文件名是给人看的。 */
function archiveStamp(): string {
  const now = new Date();
  return `${todayKey().replace(/-/g, "")}-${currentTimeKey().replace(":", "")}${String(
    now.getSeconds(),
  ).padStart(2, "0")}-${String(now.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * 导入进来的归档在目录里叫什么。
 *
 * 上传的文件名本来就合规（多半就是从另一台机器下载下来的那份）时原样保留——管理员认得它。
 * 否则按归档自己的生成时间造一个规范名，而不是信任浏览器传来的字符串：它会被直接拼进
 * 备份目录的路径，`..`、分隔符、控制字符都得挡掉（`archivePath` 是最后一道，这里先规范化）。
 */
function importedArchiveName(originalName: string, createdAt: string): string {
  const base = originalName.split(/[\\/]/).pop() ?? "";
  const safe =
    base.startsWith(BACKUP_FILE_PREFIX) &&
    base.endsWith(BACKUP_FILE_SUFFIX) &&
    base.length <= 120 &&
    !base.includes("..") &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/.test(base);
  if (safe) return base;

  const created = new Date(createdAt);
  const stamp = Number.isNaN(created.getTime())
    ? `imported-${Date.now()}`
    : `imported-${created
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.(\d{3})Z$/, "-$1")}`;
  return `${BACKUP_FILE_PREFIX}${stamp}${BACKUP_FILE_SUFFIX}`;
}

/** 账本名可能重名或含非法字符，统一「名字-id 前 8 位」，既可读又唯一。 */
function excelEntryName(ledger: { id: string; name: string }): string {
  const safe = ledger.name.replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 40) || "账本";
  return `${safe}-${ledger.id.slice(0, 8)}.xlsx`;
}

function lazyStream(source: AsyncGenerator<string | Buffer>): Readable {
  return Readable.from(source, { objectMode: false });
}

function parseManifest(text: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单无法解析", 400);
  }
  const manifest = parsed as Partial<BackupManifest>;
  if (manifest.app !== SYSTEM_BACKUP_APP || manifest.kind !== SYSTEM_BACKUP_KIND) {
    throw new AppError("BACKUP_MANIFEST_INVALID", "这不是 Fin Nest 的系统备份文件", 400);
  }
  if (
    typeof manifest.formatVersion !== "number" ||
    !Number.isInteger(manifest.formatVersion) ||
    manifest.formatVersion < 1 ||
    manifest.formatVersion > SYSTEM_BACKUP_FORMAT_VERSION
  ) {
    throw new AppError(
      "BACKUP_VERSION_UNSUPPORTED",
      "备份文件由更新版本的 Fin Nest 生成，请先升级后再恢复",
      400,
    );
  }
  if (
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.ledgers) ||
    !manifest.files ||
    !Number.isInteger(manifest.files.count) ||
    manifest.files.count < 0 ||
    typeof manifest.files.bytes !== "string"
  ) {
    throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单字段不完整", 400);
  }
  // v1 归档没有 missing 字段：那时缺失附件会让备份整份失败，所以「缺条目」一律是损坏。
  if (manifest.files.missing === undefined) manifest.files.missing = [];
  if (
    !Array.isArray(manifest.files.missing) ||
    manifest.files.missing.some((key) => typeof key !== "string")
  ) {
    throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单的缺失附件列表无效", 400);
  }
  if (manifest.files.missing.length > manifest.files.count) {
    throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单的缺失附件数超过附件总数", 400);
  }
  const tableNames = new Set<string>();
  for (const table of manifest.tables) {
    if (
      !table ||
      typeof table.name !== "string" ||
      !/^[A-Za-z0-9_]+$/.test(table.name) ||
      typeof table.model !== "string" ||
      !Number.isInteger(table.rows) ||
      table.rows < 0 ||
      tableNames.has(table.name)
    ) {
      throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单的数据库表信息无效", 400);
    }
    tableNames.add(table.name);
  }
  for (const ledger of manifest.ledgers) {
    if (!ledger || typeof ledger.id !== "string" || typeof ledger.name !== "string") {
      throw new AppError("BACKUP_MANIFEST_INVALID", "备份清单的账本信息无效", 400);
    }
  }
  return manifest as BackupManifest;
}

/** 两个 `YYYY-MM-DD` 取较晚的一个；同宽度定长字符串，字典序即时间序。 */
function maxKey(left: string, right: string): string {
  return left >= right ? left : right;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function groupObjectKeysByBucket(
  objects: Array<{ bucket: string; objectKey: string }>,
): Array<{ bucket: string; objectKeys: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const object of objects) {
    const keys = grouped.get(object.bucket) ?? [];
    keys.push(object.objectKey);
    grouped.set(object.bucket, keys);
  }
  return Array.from(grouped, ([bucket, objectKeys]) => ({ bucket, objectKeys }));
}
