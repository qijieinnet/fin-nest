import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AuthContext, SessionAuthContext } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { UploadAttachmentDto } from "./dto/file.dto";
import { FilesService, MAX_FILE_SIZE_BYTES } from "./files.service";

@ApiTags("files")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("ledgers/:ledgerId")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("files/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  @ApiCreatedResponse()
  upload(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Body() body: UploadAttachmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.files.uploadAttachment(ledgerId, (auth as SessionAuthContext).userId, body, file);
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

  @Get("attachments/:attachmentId/content")
  @ApiOkResponse()
  async content(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("attachmentId") attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.files.getAttachmentContent(
      ledgerId,
      attachmentId,
      (auth as SessionAuthContext).userId,
    );
    response.setHeader("cache-control", "private, max-age=60");
    response.setHeader("content-type", result.mime);
    response.setHeader("content-length", result.sizeBytes.toString());
    response.setHeader(
      "content-disposition",
      contentDisposition(result.fileName, shouldRenderInline(result.mime)),
    );
    await new Promise<void>((resolve, reject) => {
      result.stream.once("error", reject);
      response.once("finish", resolve);
      result.stream.pipe(response);
    });
  }

  @Delete("attachments/:attachmentId")
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param("ledgerId") ledgerId: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<void> {
    await this.files.deleteAttachment(ledgerId, attachmentId, (auth as SessionAuthContext).userId);
  }
}

function shouldRenderInline(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}

function contentDisposition(filename: string, inline: boolean): string {
  const disposition = inline ? "inline" : "attachment";
  const encoded = encodeURIComponent(filename);
  const fallback = filename.replace(/["\r\n\\]/g, "_").replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
