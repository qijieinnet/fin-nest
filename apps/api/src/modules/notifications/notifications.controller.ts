import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { NotificationActionDto } from "./dto/notification-action.dto";
import { UpdateNotificationSettingsDto } from "./dto/notification-settings.dto";
import { DetachPushSubscriptionDto, SavePushSubscriptionDto } from "./dto/push-subscription.dto";
import { NotificationsService } from "./notifications.service";

/**
 * 通知设置、Web Push 订阅登记，以及推送落地页 `/n/{id}` 的数据与动作。
 *
 * 全部是**账号维度**的（不挂 ledgerId）：渠道开关与设备订阅属于人，不属于账本。
 * 唯一的例外是候选接收人列表，它天然是账本维度的，见 `NotifyCandidatesController`。
 */
@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // 注意顺序：静态段的路由必须排在 `:id` 之前，否则 /notifications/settings 会被当成一个 id。
  @Get("settings")
  @ApiOkResponse({ description: "渠道可用性 + 我的开关 + 我的推送设备" })
  settings(@CurrentAuth() auth: AuthContext, @Query("endpoint") endpoint?: string) {
    return this.notifications.settings((auth as SessionAuthContext).userId, endpoint);
  }

  @Patch("settings")
  @ApiOkResponse({ description: "更新渠道开关，返回更新后的完整设置" })
  updateSettings(@CurrentAuth() auth: AuthContext, @Body() body: UpdateNotificationSettingsDto) {
    return this.notifications.updateSettings((auth as SessionAuthContext).userId, body);
  }

  @Post("subscriptions")
  @ApiOkResponse({ description: "登记/更新本设备的 Web Push 订阅（按 endpoint upsert）" })
  saveSubscription(
    @CurrentAuth() auth: AuthContext,
    @Body() body: SavePushSubscriptionDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.notifications.saveSubscription(
      (auth as SessionAuthContext).userId,
      body,
      userAgent ?? null,
    );
  }

  @Post("subscriptions/detach")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "按 endpoint 移除本设备订阅（关闭本机通知）" })
  async detachSubscription(
    @CurrentAuth() auth: AuthContext,
    @Body() body: DetachPushSubscriptionDto,
  ): Promise<void> {
    await this.notifications.removeSubscriptionByEndpoint(
      (auth as SessionAuthContext).userId,
      body.endpoint,
    );
  }

  @Delete("subscriptions/:id")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "移除指定推送设备（只能删自己的）" })
  async removeSubscription(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
  ): Promise<void> {
    await this.notifications.removeSubscription((auth as SessionAuthContext).userId, id);
  }

  @Post("test")
  @ApiOkResponse({ description: "给自己的所有设备发一条测试通知，返回成功/失败台数" })
  sendTest(@CurrentAuth() auth: AuthContext) {
    return this.notifications.sendTest((auth as SessionAuthContext).userId);
  }

  @Get(":id")
  @ApiOkResponse({ description: "推送落地页要渲染的一条提醒（本账本成员可见）" })
  view(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    return this.notifications.view(id, (auth as SessionAuthContext).userId);
  }

  @Post(":id/actions")
  @ApiOkResponse({ description: "执行提醒上的动作，返回执行后的提醒状态" })
  act(
    @CurrentAuth() auth: AuthContext,
    @Param("id") id: string,
    @Body() body: NotificationActionDto,
  ) {
    return this.notifications.act(id, body.action, (auth as SessionAuthContext).userId);
  }
}

/**
 * 候选接收人。挂在 `ledgers/:ledgerId` 下与其余账本子资源同源
 * ——「能推给谁」取决于账本成员，而不是取决于我。
 */
@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class NotifyCandidatesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("notify-candidates")
  @ApiOkResponse({ description: "本账本成员 + 每人当前可达的推送渠道，供选择接收人" })
  candidates(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.notifications.candidates(ledgerId, (auth as SessionAuthContext).userId);
  }
}
