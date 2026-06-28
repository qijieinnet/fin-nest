import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { BindAttachmentDto, CreateUploadUrlDto } from "./dto/file.dto";
import { FilesService } from "./files.service";

@ApiTags("files")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("files/upload-url")
  @ApiCreatedResponse()
  createUploadUrl(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: CreateUploadUrlDto) {
    return this.files.createUploadUrl(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Post("attachments")
  @ApiCreatedResponse()
  bind(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Body() body: BindAttachmentDto) {
    return this.files.bindAttachment(ledgerId, (auth as SessionAuthContext).userId, body);
  }

  @Get("attachments")
  @ApiOkResponse()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Query("ownerType") ownerType: string,
    @Query("ownerId") ownerId: string,
  ) {
    return this.files.listAttachments(ledgerId, ownerType, ownerId, (auth as SessionAuthContext).userId);
  }

  @Get("attachments/:attachmentId/download-url")
  @ApiOkResponse()
  downloadUrl(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("attachmentId") attachmentId: string) {
    return this.files.createDownloadUrl(ledgerId, attachmentId, (auth as SessionAuthContext).userId);
  }

  @Delete("attachments/:attachmentId")
  @ApiNoContentResponse()
  async delete(@CurrentAuth() auth: AuthContext, @Param("ledgerId") ledgerId: string, @Param("attachmentId") attachmentId: string): Promise<void> {
    await this.files.deleteAttachment(ledgerId, attachmentId, (auth as SessionAuthContext).userId);
  }
}
