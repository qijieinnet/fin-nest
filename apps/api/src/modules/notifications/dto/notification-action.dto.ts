import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import type { NotificationActionKey } from "@fin-nest/backend";
import { NOTIFICATION_ACTIONS } from "../notification-actions.service";

/**
 * 落地页点的按钮。取值与飞书卡片按钮同源（`NOTIFICATION_ACTIONS`），
 * 两条渠道多一个少一个都会在这里被 400 挡住。
 */
export class NotificationActionDto {
  @ApiProperty({ enum: NOTIFICATION_ACTIONS, description: "要执行的动作。" })
  @IsIn(NOTIFICATION_ACTIONS)
  action!: NotificationActionKey;
}
