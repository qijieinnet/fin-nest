import { Global, Module } from "@nestjs/common";
import { AuditLogService } from "./audit/audit-log.service";
import { BackgroundJobsService } from "./background-jobs/background-jobs.service";
import { ApiExceptionFilter } from "./errors/api-exception.filter";
import { FeishuClient } from "./feishu/feishu-client";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { NotificationService } from "./notifications/notification.service";
import { ReminderTargetsService } from "./notifications/reminder-targets.service";
import { PrismaModule } from "./prisma/prisma.module";
import { BigIntSerializeInterceptor } from "./serialization/bigint-serialize.interceptor";
import { DatabaseTransactionService } from "./transactions/database-transaction.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    ApiExceptionFilter,
    DatabaseTransactionService,
    AuditLogService,
    BackgroundJobsService,
    BigIntSerializeInterceptor,
    IdempotencyService,
    FeishuClient,
    NotificationService,
    ReminderTargetsService,
  ],
  exports: [
    PrismaModule,
    DatabaseTransactionService,
    AuditLogService,
    BackgroundJobsService,
    BigIntSerializeInterceptor,
    IdempotencyService,
    FeishuClient,
    NotificationService,
    ReminderTargetsService,
  ],
})
export class BackendPlatformModule {}
