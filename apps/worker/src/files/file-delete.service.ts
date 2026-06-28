import { Injectable } from "@nestjs/common";
import { PrismaService } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { Client } from "minio";

export type FileDeletePayload = {
  fileId?: string;
  bucket?: string;
  objectKey?: string;
};

@Injectable()
export class FileDeleteService {
  private readonly config = loadConfig();
  private readonly minio = new Client({
    endPoint: this.config.MINIO_ENDPOINT,
    port: this.config.MINIO_PORT,
    useSSL: this.config.MINIO_USE_SSL,
    accessKey: this.config.MINIO_ACCESS_KEY,
    secretKey: this.config.MINIO_SECRET_KEY,
  });

  constructor(private readonly prisma: PrismaService) {}

  async deleteObject(payload: FileDeletePayload): Promise<void> {
    if (!payload.fileId || !payload.bucket || !payload.objectKey) {
      throw new Error("Invalid file.delete payload");
    }
    await this.minio.removeObject(payload.bucket, payload.objectKey);
    await this.prisma.client.file.deleteMany({ where: { id: payload.fileId, status: "delete_pending" } });
  }
}
