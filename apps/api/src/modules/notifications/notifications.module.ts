import { Module } from "@nestjs/common";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { AutomationModule } from "../automation/automation.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { NotificationActionsService } from "./notification-actions.service";
import { NotificationsController, NotifyCandidatesController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * 推送渠道的账号侧：渠道开关、Web Push 设备订阅、落地页 `/n/{id}` 的读与动作。
 *
 * `NotificationActionsService` 导出给飞书模块复用——卡片按钮与落地页必须走同一份
 * 抢占与业务调用，否则两条渠道会各点各的，一次续订被推进两个计费周期。
 *
 * AssetsModule / AutomationModule 提供动作真正落到的业务方法（退订、确认续订、
 * 确认入账、删除待确认），鉴权与审计都在它们内部。
 */
@Module({
  imports: [AuthModule, LedgersModule, AssetsModule, AutomationModule],
  controllers: [NotificationsController, NotifyCandidatesController],
  providers: [NotificationsService, NotificationActionsService],
  exports: [NotificationActionsService],
})
export class NotificationsModule {}
