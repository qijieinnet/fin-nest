import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

export class ImportExcelQueryDto {
  /** 默认 dryRun：只校验并返回预览，确认导入时传 dryRun=false 重新上传同一文件。 */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value !== "false" && value !== false)
  @IsBoolean()
  dryRun?: boolean;
}
