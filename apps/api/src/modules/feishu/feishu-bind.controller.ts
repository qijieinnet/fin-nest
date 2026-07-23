import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CreateBindCodeDto } from "./dto/create-bind-code.dto";
import { FeishuBindingService } from "./feishu-binding.service";

/**
 * 飞书绑定的 Web 侧接口。绑定是用户级的（一个用户可绑多个飞书号），
 * 因此不挂在 `ledgers/:ledgerId` 下；生成绑定码时才需要指定默认账本。
 */
@ApiTags("feishu")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("feishu")
export class FeishuBindController {
  constructor(private readonly binding: FeishuBindingService) {}

  @Get("status")
  @ApiOkResponse({ description: "飞书机器人是否已配置启用" })
  status() {
    return this.binding.status();
  }

  @Get("bindings")
  @ApiOkResponse({ description: "当前用户的生效绑定" })
  listBindings(@CurrentAuth() auth: AuthContext) {
    return this.binding.listBindings((auth as SessionAuthContext).userId);
  }

  @Get("ledgers/:ledgerId/bindings")
  @ApiOkResponse({ description: "本账本所有成员的生效绑定，供选择推送接收人" })
  listLedgerBindings(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.binding.listLedgerBindings(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post("bind-codes")
  @ApiCreatedResponse({ description: "生成一次性绑定码，明文仅返回一次" })
  createBindCode(@CurrentAuth() auth: AuthContext, @Body() body: CreateBindCodeDto) {
    return this.binding.createBindCode(body.ledgerId, (auth as SessionAuthContext).userId);
  }

  @Delete("bindings/:id")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "解绑（软删）" })
  async revokeBinding(@CurrentAuth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    await this.binding.revokeBinding(id, (auth as SessionAuthContext).userId);
  }
}
