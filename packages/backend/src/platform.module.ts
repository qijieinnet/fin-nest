import { Global, Module } from "@nestjs/common";
import { AuditLogService } from "./audit/audit-log.service";
import { BackgroundJobsService } from "./background-jobs/background-jobs.service";
import { ApiExceptionFilter } from "./errors/api-exception.filter";
import { ExcelWorkbookService } from "./excel/excel-workbook.service";
import { FeishuClient } from "./feishu/feishu-client";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { NotificationTargetsResolver } from "./notifications/notification-targets.resolver";
import { NotificationService } from "./notifications/notification.service";
import { ReminderTargetsService } from "./notifications/reminder-targets.service";
import { PrismaModule } from "./prisma/prisma.module";
import { PushDeliveryService } from "./push/push-delivery.service";
import { WebPushClient } from "./push/web-push.client";
import { SystemBackupService } from "./system-backup/system-backup.service";
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
    ExcelWorkbookService,
    IdempotencyService,
    FeishuClient,
    WebPushClient,
    PushDeliveryService,
    NotificationService,
    NotificationTargetsResolver,
    ReminderTargetsService,
    SystemBackupService,
  ],
  exports: [
    PrismaModule,
    DatabaseTransactionService,
    AuditLogService,
    BackgroundJobsService,
    BigIntSerializeInterceptor,
    ExcelWorkbookService,
    IdempotencyService,
    FeishuClient,
    WebPushClient,
    PushDeliveryService,
    NotificationService,
    NotificationTargetsResolver,
    ReminderTargetsService,
    SystemBackupService,
  ],
})
export class BackendPlatformModule {}
