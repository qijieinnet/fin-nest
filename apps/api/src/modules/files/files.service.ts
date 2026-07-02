import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Injectable } from "@nestjs/common";
import { AppError, BackgroundJobsService, PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { Prisma } from "@fin-nest/db";
import { Client } from "minio";
import { LedgersService } from "../ledgers/ledgers.service";
import { BindAttachmentDto, CreateUploadUrlDto } from "./dto/file.dto";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

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

  async createUploadUrl(ledgerId: string, userId: string, input: CreateUploadUrlDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    assertAllowedMime(input.mime);
    await this.assertOwner(ledgerId, input.ownerType, input.ownerId);
    const now = new Date();
    const extension = safeExt(input.originalName);
    const objectKey = `ledgers/${ledgerId}/${input.ownerType}/${input.ownerId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    const uploadUrl = await this.minio.presignedPutObject(this.bucket, objectKey, 15 * 60);
    return { bucket: this.bucket, objectKey, uploadUrl, expiresInSeconds: 15 * 60 };
  }

  async bindAttachment(ledgerId: string, userId: string, input: BindAttachmentDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    assertAllowedMime(input.mime);
    await this.assertOwner(ledgerId, input.ownerType, input.ownerId);
    if (!input.objectKey.startsWith(`ledgers/${ledgerId}/${input.ownerType}/${input.ownerId}/`)) {
      throw new AppError("INVALID_OBJECT_KEY", "对象 key 与业务对象不匹配", 400);
    }
    // Trust the object actually present in storage rather than the client-reported size.
    const stat = await this.minio.statObject(this.bucket, input.objectKey).catch(() => null);
    if (!stat) throw new AppError("OBJECT_NOT_FOUND", "上传对象不存在或已过期", 400);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "文件大小超过限制", 400);
    }
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const file = await tx.file.create({
          data: {
            ledgerId,
            ownerUserId: userId,
            bucket: this.bucket,
            objectKey: input.objectKey,
            originalName: input.originalName,
            mime: input.mime,
            sizeBytes: BigInt(stat.size),
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
        return { file, attachment };
      });
    } catch (error) {
      // object_key 全局唯一，重复绑定（双击/重放）给出明确的 409 而不是 500。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("OBJECT_ALREADY_BOUND", "该上传对象已绑定过附件", 409);
      }
      throw error;
    }
  }

  async listAttachments(ledgerId: string, ownerType: string, ownerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, ownerType, ownerId);
    return this.prisma.client.attachment.findMany({
      where: { ledgerId, ownerType, ownerId },
      include: { file: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async createDownloadUrl(ledgerId: string, attachmentId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, ledgerId },
    });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId);
    const file = await this.prisma.client.file.findFirst({
      where: { id: attachment.fileId, ledgerId, deletedAt: null },
    });
    if (!file) throw new AppError("FILE_NOT_FOUND", "文件不存在", 404);
    return {
      downloadUrl: await this.minio.presignedGetObject(file.bucket, file.objectKey, 15 * 60),
      expiresInSeconds: 15 * 60,
    };
  }

  async deleteAttachment(ledgerId: string, attachmentId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, ledgerId },
    });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId);
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

  private async assertOwner(ledgerId: string, ownerType: string, ownerId: string) {
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
