import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { CreatePersonDto, UpdatePersonDto } from "./dto/person.dto";
import { RecordsService } from "./records.service";

@ApiTags("people")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId/people")
export class PeopleController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse()
  list(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string) {
    return this.records.listPeople(ledgerId, (auth as SessionAuthContext).userId);
  }

  @Post()
  @ApiCreatedResponse()
  create(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreatePersonDto) {
    return this.records.createPerson(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Patch(":personId")
  @ApiOkResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("personId") personId: string,
    @Body() body: UpdatePersonDto,
  ) {
    return this.records.updatePerson(ledgerId, personId, (auth as SessionAuthContext).userId, body);
  }

  @Delete(":personId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("personId") personId: string,
  ): Promise<void> {
    await this.records.deletePerson(ledgerId, personId, (auth as SessionAuthContext).userId);
  }
}
