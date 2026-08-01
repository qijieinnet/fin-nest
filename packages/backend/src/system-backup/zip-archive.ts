import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import archiver from "archiver";
import yauzl from "yauzl";

/**
 * 归档读写的最小封装。
 *
 * 选 zip 而不是 tar.gz：备份要能在 Windows / macOS 双击打开，用户最终是奔着里面的 Excel 去的。
 * 全程流式——附件加起来可能上 GB，任何「先拼成 Buffer」的写法都会把进程撑爆。
 */

export type ZipWriter = {
  /**
   * 追加一个条目，**等它真正写完**再 resolve。
   *
   * 必须逐个 await：条目的数据源是「被消费时才去查库/取对象」的惰性流，
   * 一口气 append 几十个，Node 会为每个流预读第一块，于是几十条查询同时打向数据库，
   * 直接把 Prisma 连接池（默认 17）耗光并以 P2024 超时告终。
   */
  append(source: Buffer | Readable, name: string): Promise<void>;
  /** 收尾并等待文件真正落盘。 */
  finalize(): Promise<void>;
  /** 任务失败时立即停止继续写入半截归档。 */
  abort(): void;
};

export function createZipWriter(targetPath: string): ZipWriter {
  const output = createWriteStream(targetPath);
  // 压缩级别取 6：附件多是已压缩的图片/PDF，再往上加只换来 CPU 时间。
  // 超过 4GB 时 archiver 会自动切 zip64，不需要显式 forceZip64。
  const archive = archiver("zip", { zlib: { level: 6 } });

  // 归档层面的致命错误要能被每个 append 与 finalize 同时看到，
  // 否则一个没人监听的 "error" 事件会直接把进程带走——备份失败绝不该拖垮 API。
  let failure: Error | null = null;
  const failed = new Promise<never>((_, reject) => {
    const fail = (error: Error) => {
      failure ??= error;
      reject(error);
    };
    archive.on("error", fail);
    // "warning" 里的 ENOENT 是「某个源没了」，对备份来说同样是致命的。
    archive.on("warning", fail);
    output.on("error", fail);
  });
  // 上面的 promise 只在出错时才 settle，没人 await 时不能算未处理的 rejection。
  failed.catch(() => undefined);

  const closed = new Promise<void>((resolve) => output.on("close", () => resolve()));
  archive.pipe(output);

  return {
    append(source, name) {
      if (failure) return Promise.reject(failure);
      const written = new Promise<void>((resolve) => {
        const onEntry = (entry: archiver.EntryData) => {
          if (entry.name !== name) return;
          archive.off("entry", onEntry);
          resolve();
        };
        archive.on("entry", onEntry);
      });
      if (source instanceof Readable) {
        // 数据源自己报错时 archiver 也会转抛，但源流上没有监听器同样会炸进程，兜一层。
        source.on("error", (error: Error) => archive.emit("error", error));
      }
      archive.append(source, { name });
      return Promise.race([written, failed]);
    },
    async finalize() {
      await Promise.race([archive.finalize(), failed]);
      await Promise.race([closed, failed]);
    },
    abort() {
      archive.abort();
      output.destroy();
    },
  };
}

export type ZipEntry = { name: string; sizeBytes: number };

export type ZipReader = {
  entries: ZipEntry[];
  /** 打开某个条目的读取流。条目可按任意顺序读取（zip 的中央目录支持随机访问）。 */
  openStream(name: string): Promise<Readable>;
  close(): void;
};

export async function openZipReader(path: string): Promise<ZipReader> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    // autoClose=false：先把中央目录读完拿到全部条目，之后还要按拓扑顺序回头读，不能读到 end 就关。
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, file) => {
      if (error || !file) reject(error ?? new Error("无法打开备份归档"));
      else resolve(file);
    });
  });

  const byName = new Map<string, yauzl.Entry>();
  await new Promise<void>((resolve, reject) => {
    zipFile.on("entry", (entry: yauzl.Entry) => {
      if (!entry.fileName.endsWith("/")) byName.set(entry.fileName, entry);
      zipFile.readEntry();
    });
    zipFile.on("end", () => resolve());
    zipFile.on("error", reject);
    zipFile.readEntry();
  });

  return {
    entries: Array.from(byName.values()).map((entry) => ({
      name: entry.fileName,
      sizeBytes: Number(entry.uncompressedSize),
    })),
    openStream(name) {
      const entry = byName.get(name);
      if (!entry) return Promise.reject(new Error(`备份归档缺少条目：${name}`));
      return new Promise<Readable>((resolve, reject) => {
        zipFile.openReadStream(entry, (error, stream) => {
          if (error || !stream) reject(error ?? new Error(`无法读取备份条目：${name}`));
          else resolve(stream);
        });
      });
    },
    close() {
      zipFile.close();
    },
  };
}

/** 把一个条目整体读成文本（只用于 manifest 这类小文件）。 */
export async function readEntryText(reader: ZipReader, name: string): Promise<string> {
  const stream = await reader.openStream(name);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}
