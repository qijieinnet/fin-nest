import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/** 识图补充要求上限：够写十几条规则，又不至于把系统提示撑得太长。 */
export const AI_IMAGE_INSTRUCTIONS_MAX_LENGTH = 1000;

export class UpdateAiPreferencesDto {
  @ApiPropertyOptional({
    description: "识别账单图片时的长期补充要求；传空串或 null 即清除",
    maxLength: AI_IMAGE_INSTRUCTIONS_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(AI_IMAGE_INSTRUCTIONS_MAX_LENGTH)
  imageInstructions?: string | null;
}
