import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PlanShareTokenService } from "./plan-share-token.service";

/** 免登录：凭计划分享 token 读取「本期」卡片统计。刻意不挂 SessionAuthGuard。 */
@ApiTags("public-plans")
@Controller("public/plans")
export class PublicPlansController {
  constructor(private readonly shareTokens: PlanShareTokenService) {}

  @Get(":token/progress")
  @ApiOkResponse({ description: "凭分享 token 返回本期卡片统计（不含账本内部信息）" })
  progress(@Param("token") token: string) {
    return this.shareTokens.readCard(token);
  }
}
