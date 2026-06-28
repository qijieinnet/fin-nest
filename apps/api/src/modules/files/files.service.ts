import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Injectable } from "@nestjs/common";
import { BackgroundJobsService, PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { Client } from "minio";
import { AppError } from "@fin-nest/backend";
import { LedgersService } from "../ledgers/ledgers.service";
import { BindAttachmentDto, CreateUploadUrlDto } from "./dto/file.dto";

@Injectable()
export class FilesService {
  private readonly minio = new Client({
    endPoint: loadConfig().MINIO_ENDPOINT,
    port: loadConfig().MINIO_PORT,
    useSSL: loadConfig().MINIO_USE_SSL,
    accessKey: loadConfig().MINIO_ACCESS_KEY,
    secretKey: loadConfig().MINIO_SECRET_KEY,
  });
  private readonly bucket = loadConfig().MINIO_BUCKET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BackgroundJobsService,
    private readonly ledgers: LedgersService,
  ) {}

  async createUploadUrl(ledgerId: string, userId: string, input: CreateUploadUrlDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, input.ownerType, input.ownerId);
    const now = new Date();
    const extension = safeExt(input.originalName);
    const objectKey = `ledgers/${ledgerId}/${input.ownerType}/${input.ownerId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    const uploadUrl = await this.minio.presignedPutObject(this.bucket, objectKey, 15 * 60);
    return { bucket: this.bucket, objectKey, uploadUrl, expiresInSeconds: 15 * 60 };
  }

  async bindAttachment(ledgerId: string, userId: string, input: BindAttachmentDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, input.ownerType, input.ownerId);
    if (!input.objectKey.startsWith(`ledgers/${ledgerId}/${input.ownerType}/${input.ownerId}/`)) {
      throw new AppError("INVALID_OBJECT_KEY", "对象 key 与业务对象不匹配", 400);
    }
    return this.prisma.client.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          ledgerId,
          ownerUserId: userId,
          bucket: this.bucket,
          objectKey: input.objectKey,
          originalName: input.originalName,
          mime: input.mime,
          sizeBytes: BigInt(input.sizeBytes),
          checksum: input.checksum,
          status: "attached",
        },
      });
      const attachment = await tx.attachment.create({
        data: { ledgerId, fileId: file.id, ownerType: input.ownerType, ownerId: input.ownerId, createdBy: userId },
      });
      return { file, attachment };
    });
  }

  async listAttachments(ledgerId: string, ownerType: string, ownerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertOwner(ledgerId, ownerType, ownerId);
    return this.prisma.client.attachment.findMany({ where: { ledgerId, ownerType, ownerId }, orderBy: { createdAt: "asc" } });
  }

  async createDownloadUrl(ledgerId: string, attachmentId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({ where: { id: attachmentId, ledgerId } });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId);
    const file = await this.prisma.client.file.findFirst({ where: { id: attachment.fileId, ledgerId, deletedAt: null } });
    if (!file) throw new AppError("FILE_NOT_FOUND", "文件不存在", 404);
    return {
      downloadUrl: await this.minio.presignedGetObject(file.bucket, file.objectKey, 15 * 60),
      expiresInSeconds: 15 * 60,
    };
  }

  async deleteAttachment(ledgerId: string, attachmentId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    const attachment = await this.prisma.client.attachment.findFirst({ where: { id: attachmentId, ledgerId } });
    if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    await this.assertOwner(ledgerId, attachment.ownerType, attachment.ownerId);
    const file = await this.prisma.client.file.findFirstOrThrow({ where: { id: attachment.fileId, ledgerId } });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachment.id } });
      await tx.file.update({ where: { id: file.id }, data: { status: "delete_pending", deletedAt: new Date() } });
    });
    try {
      await this.minio.removeObject(file.bucket, file.objectKey);
    } catch {
      await this.jobs.enqueue({
        type: "file.delete",
        payload: { fileId: file.id, bucket: file.bucket, objectKey: file.objectKey },
      });
    }
  }

  async deleteAttachmentsForOwner(ledgerId: string, ownerType: string, ownerId: string): Promise<{ deleted: number }> {
    const attachments = await this.prisma.client.attachment.findMany({ where: { ledgerId, ownerType, ownerId } });
    if (!attachments.length) return { deleted: 0 };

    const fileIds = attachments.map((attachment) => attachment.fileId);
    const files = await this.prisma.client.file.findMany({ where: { ledgerId, id: { in: fileIds } } });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.attachment.deleteMany({ where: { id: { in: attachments.map((attachment) => attachment.id) } } });
      await tx.file.updateMany({
        where: { id: { in: files.map((file) => file.id) } },
        data: { status: "delete_pending", deletedAt: new Date() },
      });
    });

    for (const file of files) {
      try {
        await this.minio.removeObject(file.bucket, file.objectKey);
      } catch {
        await this.jobs.enqueue({
          type: "file.delete",
          payload: { fileId: file.id, bucket: file.bucket, objectKey: file.objectKey },
        });
      }
    }
    return { deleted: attachments.length };
  }

  private async assertOwner(ledgerId: string, ownerType: string, ownerId: string) {
    if (ownerType === "transaction") {
      const row = await this.prisma.client.transaction.findFirst({ where: { id: ownerId, ledgerId, deletedAt: null } });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "insurance") {
      const row = await this.prisma.client.insurance.findFirst({ where: { id: ownerId, ledgerId, deletedAt: null } });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    if (ownerType === "item") {
      const row = await this.prisma.client.item.findFirst({ where: { id: ownerId, ledgerId, deletedAt: null } });
      if (!row) throw new AppError("OWNER_NOT_FOUND", "业务对象不存在", 404);
      return;
    }
    throw new AppError("OWNER_TYPE_INVALID", "附件归属类型无效", 400);
  }
}

function safeExt(name: string): string {
  const extension = extname(name).toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(extension) ? extension : "";
}
