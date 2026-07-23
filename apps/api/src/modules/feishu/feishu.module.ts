import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AssetsModule } from "../assets/assets.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { FeishuBindController } from "./feishu-bind.controller";
import { FeishuBindingService } from "./feishu-binding.service";
import { FeishuCardActionService } from "./feishu-card-action.service";
import { FeishuEventService } from "./feishu-event.service";
import { FeishuInboxService } from "./feishu-inbox.service";
import { FeishuWsService } from "./feishu-ws.service";

/**
 * 飞书机器人（可选启用，见 docs/FEISHU_BOT_PLAN.md）。
 *
 * 模块始终注册，但未配置 FEISHU_APP_ID/SECRET 时：Web 侧接口返回未启用、前端隐藏入口，
 * 长连接不建立、收件箱不启动（与 AI 模块同一套「可选启用」处理）。
 *
 * 消息链路：WS handler 落库 + ack → 收件箱异步消费 → 事件服务路由指令 / 接 AiService → 卡片渲染。
 * 卡片按钮链路：WS handler 同步处理（不调 LLM）→ §8 鉴权 → 建交易 → 回写卡片。
 */
@Module({
  // AssetsModule / AutomationModule 供推送卡片的按钮（退订、确认续订、确认记账、忽略）
  // 调用与 Web 端完全相同的业务方法——鉴权、幂等、审计都在里面。
  imports: [
    AuthModule,
    LedgersModule,
    AiModule,
    TransactionsModule,
    AssetsModule,
    AutomationModule,
  ],
  controllers: [FeishuBindController],
  providers: [
    // FeishuClient 由 BackendPlatformModule（@Global）提供，worker 侧也要用，故不在此重复注册。
    FeishuBindingService,
    FeishuCardActionService,
    FeishuEventService,
    FeishuInboxService,
    FeishuWsService,
  ],
  exports: [FeishuBindingService],
})
export class FeishuModule {}
