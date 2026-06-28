import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RemindersService } from "./reminders.service";

@ApiTags("reminders")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get("reminder-summary")
  @ApiOkResponse()
  summary(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.reminders.summary(ledgerId, (auth as SessionAuthContext).userId);
  }
}
