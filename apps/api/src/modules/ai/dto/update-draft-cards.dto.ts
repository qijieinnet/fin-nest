import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * 草稿字段整体替换（只收 id，名称由服务端按账本数据回填）。
 * 校验口径与 AI 的 draft_transaction 工具完全一致：分类/账户/人员必须属于本账本、类型匹配。
 */
export class AiDraftInputDto {
  @ApiProperty({ enum: ["expense", "income", "transfer"] })
  @IsIn(["expense", "income", "transfer"])
  type!: "expense" | "income" | "transfer";

  @ApiProperty({ description: "金额 micros 字符串（正整数）" })
  @Matches(/^\d{1,19}$/)
  grossAmountMicros!: string;

  @ApiProperty({ description: "YYYY-MM-DD" })
  @IsString()
  occurredOn!: string;

  @ApiPropertyOptional({ description: "HH:mm，识图草稿的交易时分（仅展示）" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  occurredTime?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subcategoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() personId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fromAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fromSubAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() toAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() toSubAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class DraftCardPatchDto {
  @ApiProperty({ description: "消息 cards 数组中的下标" })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cardIndex!: number;

  @ApiProperty({ type: AiDraftInputDto })
  @ValidateNested()
  @Type(() => AiDraftInputDto)
  draft!: AiDraftInputDto;
}

/** 批量修改同一条消息里的多张待确认草稿（行内编辑 / 批量设置账户分类），全部校验通过才落库。 */
export class UpdateDraftCardsDto {
  @ApiProperty({ type: [DraftCardPatchDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DraftCardPatchDto)
  drafts!: DraftCardPatchDto[];
}
