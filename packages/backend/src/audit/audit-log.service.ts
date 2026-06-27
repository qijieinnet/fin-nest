import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { PrismaService } from "../prisma/prisma.service";

export type AuditLogSource = "user" | "service" | "system";

export type WriteAuditLogInput = {
  ledgerId?: string | null;
  actorUserId?: string | null;
  serviceTokenId?: string | null;
  source: AuditLogSource;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: WriteAuditLogInput, tx: Prisma.TransactionClient = this.prisma.client): Promise<void> {
    await tx.auditLog.create({
      data: {
        ledgerId: input.ledgerId ?? null,
        actorUserId: input.actorUserId ?? null,
        serviceTokenId: input.serviceTokenId ?? null,
        source: input.source,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }
}
