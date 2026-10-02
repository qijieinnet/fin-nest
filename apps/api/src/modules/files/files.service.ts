import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { AppError, BackgroundJobsService, PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { Prisma } from "@fin-nest/db";
import { Client } from "minio";
import { LedgersService } from "../ledgers/ledgers.service";
import { UploadAttachmentDto } from "./dto/file.dto";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
// AI 聊天附图只收识图上游普遍支持的格式；HEIC 由前端压缩时转成 JPEG。
export const AI_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const PUBLIC_FILE_SELECT = {
  checksum: true,
  createdAt: true,
  deletedAt: true,
  id: true,
  ledgerId: true,
  mime: true,
  originalName: true,
  ownerUserId: true,
  sizeBytes: true,
  status: true,
} satisfies Prisma.FileSelect;

export type UploadedAttachmentFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Injectable()
export class FilesService {
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
    private readonly jobs: BackgroundJobsService,
    private readonly ledgers: LedgersService,
  ) {}

  async uploadAttachment(
    ledgerId: string,
    userId: string,
    input: UploadAttachmentDto,
    uploadedFile: UploadedAttachmentFile | undefined,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, input.ownerType, input.ownerId, userId);
    if (!uploadedFile) throw new AppError("FILE_REQUIRED", "请选择要上传的文件", 400);
    const mime = uploadedFile.mimetype || "application/octet-stream";
    assertAllowedMime(mime);
    if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "文件大小超过限制", 400);
    }

    const now = new Date();
    const extension = safeExt(uploadedFile.originalname);
    const objectKey = `ledgers/${ledgerId}/${input.ownerType}/${input.ownerId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    await this.minio.putObject(this.bucket, objectKey, uploadedFile.buffer, uploadedFile.size, {
      "Content-Type": mime,
    });

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const file = await tx.file.create({
          data: {
            ledgerId,
            ownerUserId: userId,
            bucket: this.bucket,
            objectKey,
            originalName: uploadedFile.originalname,
            mime,
            sizeBytes: BigInt(uploadedFile.size),
            checksum: input.checksum,
            status: "attached",
          },
        });
        const attachment = await tx.attachment.create({
          data: {
            ledgerId,
            fileId: file.id,
            ownerType: input.ownerType,
            ownerId: input.ownerId,
            createdBy: userId,
          },
        });
        return { file: toPublicFile(file), attachment };
      });
    } catch (error) {
      await this.minio.removeObject(this.bucket, objectKey).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 随业务对象一起落附件：先把对象写进存储，再在同一个事务里由 createOwner 建业务行、写 files/attachments，
   * 任一步失败都回收已上传的对象。用于 AI 聊天消息附图——消息行与图片要么一起出现、要么都不出现，
   * 不会留下「有消息没图」或「有图没主人」的半截状态。调用方负责成员/归属校验与文件格式校验。
   */
  async storeWithOwner<T>(
    ledgerId: string,
    userId: string,
    owner: { type: "ai_message"; id: string },
    uploadedFiles: UploadedAttachmentFile[],
    createOwner: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ owner: T; attachmentIds: string[] }> {
    const now = new Date();
    const prefix = `ledgers/${ledgerId}/${owner.type}/${owner.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const stored: Array<{ file: UploadedAttachmentFile; objectKey: string }> = [];
    const removeStored = () =>
      Promise.all(
        stored.map(({ objectKey }) =>
          this.minio.removeObject(this.bucket, objectKey).catch(() => undefined),
        ),
      );
    try {
      for (const file of uploadedFiles) {
        const objectKey = `${prefix}/${randomUUID()}${safeExt(file.originalname)}`;
        await this.minio.putObject(this.bucket, objectKey, file.buffer, file.size, {
          "Content-Type": file.mimetype,
        });
        stored.push({ file, objectKey });
      }
      return await this.prisma.client.$transaction(async (tx) => {
        const created = await createOwner(tx);
        const attachmentIds: string[] = [];
        for (const { file, objectKey } of stored) {
          const row = await tx.file.create({
            data: {
              ledgerId,
              ownerUserId: userId,
              bucket: this.bucket,
              objectKey,
              originalName: file.originalname,
              mime: file.mimetype,
              sizeBytes: BigInt(file.size),
              status: "attached",
            },
          });
          const attachment = await tx.attachment.create({
            data: {
              ledgerId,
              fileId: row.id,
              ownerType: owner.type,
              ownerId: owner.id,
              createdBy: userId,
            },
          });
          attachmentIds.push(attachment.id);
        }
        return { owner: created, attachmentIds };
      });
    } catch (error) {
      await removeStored();
      throw error;
    }
  }

  async listAttachments(ledgerId: string, ownerType: string, ownerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, ownerType, ownerId, userId);
    return this.prisma.client.attachment.findMany({
      where: { ledgerId, ownerType, ownerId },
      include: { file: { select: PUBLIC_FILE_SELECT } },
      orderBy: { createdAt: "asc" },
    });
  }

  async getAttachmentContent(
    ledgerId: string,
    attachmentId: string,
    userId: string,
  ): Promise<{
    fileName: string;
    mime: string;
    sizeBytes: bigint;
    stream: Readable;
  }> {
    const { file } = await this.getAccessibleAttachmentFile(ledgerId, attachmentId, userId);
    const stream = await this.minio
      .getObject(file.bucket, file.objectKey)
      .catch(() => {
        throw new AppError("OBJECT_NOT_FOUND", "附件文件不存在", 404);
      });
    return {
      fileName: file.originalName ?? "attachment",
      mime: file.mime || "application/octet-stream",
      sizeBytes: file.sizeBytes,
      stream,
    };
  }

  async deleteAttachment(ledgerId: string, attachmentId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, ledgerId },
    });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId, userId);
    const file = await this.prisma.client.file.findFirstOrThrow({
      where: { id: attachment.fileId, ledgerId },
    });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachment.id } });
      await tx.file.update({
        where: { id: file.id },
        data: { status: "delete_pending", deletedAt: new Date() },
      });
    });
    await this.purgeObject(file);
  }

  async deleteAttachmentsForOwner(
    ledgerId: string,
    ownerType: string,
    ownerId: string,
  ): Promise<{ deleted: number }> {
    const attachments = await this.prisma.client.attachment.findMany({
      where: { ledgerId, ownerType, ownerId },
    });
    if (!attachments.length) return { deleted: 0 };

    const fileIds = attachments.map((attachment) => attachment.fileId);
    const files = await this.prisma.client.file.findMany({
      where: { ledgerId, id: { in: fileIds } },
    });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: { id: { in: attachments.map((attachment) => attachment.id) } },
      });
      await tx.file.updateMany({
        where: { id: { in: files.map((file) => file.id) } },
        data: { status: "delete_pending", deletedAt: new Date() },
      });
    });

    for (const file of files) {
      await this.purgeObject(file);
    }
    return { deleted: attachments.length };
  }

  /**
   * Remove the stored object and clear the file row. On storage failure the file row is left in
   * `delete_pending` and a `file.delete` job retries the removal asynchronously.
   */
  private async purgeObject(file: {
    id: string;
    bucket: string;
    objectKey: string;
  }): Promise<void> {
    try {
      await this.minio.removeObject(file.bucket, file.objectKey);
      await this.prisma.client.file.deleteMany({
        where: { id: file.id, status: "delete_pending" },
      });
    } catch {
      await this.jobs.enqueue({
        type: "file.delete",
        payload: { fileId: file.id, bucket: file.bucket, objectKey: file.objectKey },
      });
    }
  }

  private async getAccessibleAttachmentFile(ledgerId: string, attachmentId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, ledgerId },
    });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId, userId);
    const file = await this.prisma.client.file.findFirst({
      where: { id: attachment.fileId, ledgerId, deletedAt: null },
    });
    if (!file) throw new AppError("FILE_NOT_FOUND", "文件不存在", 404);
    return { attachment, file };
  }

  private async assertOwner(ledgerId: string, ownerType: string, ownerId: string, userId: string) {
    if (ownerType === "ai_message") {
      // AI 会话按创建者私有：附图只有会话本人能看，同账本其他成员也不行。
      const row = await this.prisma.client.aiMessage.findFirst({
        where: { id: ownerId, ledgerId },
        select: { conversationId: true },
      });
      const conversation = row
        ? await this.prisma.client.aiConversation.findFirst({
            where: { id: row.conversationId, ledgerId, userId, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (!conversation) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "transaction") {
      const row = await this.prisma.client.transaction.findFirst({
        where: { id: ownerId, ledgerId, deletedAt: null },
      });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "insurance") {
      const row = await this.prisma.client.insurance.findFirst({
        where: { id: ownerId, ledgerId, deletedAt: null },
      });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "item") {
      const row = await this.prisma.client.item.findFirst({
        where: { id: ownerId, ledgerId, deletedAt: null },
      });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "subscription") {
      const row = await this.prisma.client.subscription.findFirst({
        where: { id: ownerId, ledgerId, deletedAt: null },
      });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    throw new AppError("OWNER_TYPE_INVALID", "附件归属类型无效", 400);
  }
}

function assertAllowedMime(mime: string): void {
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    throw new AppError("MIME_NOT_ALLOWED", "不支持的文件类型", 400);
  }
}

function safeExt(name: string): string {
  const extension = extname(name).toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(extension) ? extension : "";
}

function toPublicFile<TFile extends { bucket: string; objectKey: string }>(file: TFile) {
  const { bucket: _bucket, objectKey: _objectKey, ...publicFile } = file;
  return publicFile;
}
