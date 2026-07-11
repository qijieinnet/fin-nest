import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** 可批量修改的字段（一次只能改一项）。金额不在内。 */
export const BATCH_UPDATE_FIELDS = [
  "category",
  "account",
  "person",
  "occurredOn",
  "note",
] as const;

export type BatchUpdateField = (typeof BATCH_UPDATE_FIELDS)[number];

/**
 * 批量修改多笔交易的单个字段。服务端逐笔以现有数据重建完整 DTO 后仅覆盖目标字段，
 * 复用 update() 保持冲正流水/快照等不变式。转账行对分类/账户不适用会被跳过。
 */
export class BatchUpdateTransactionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  transactionIds!: string[];

  @ApiProperty({ enum: BATCH_UPDATE_FIELDS })
  @IsIn(BATCH_UPDATE_FIELDS)
  field!: BatchUpdateField;

  // ---- field=category 时使用 ----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  // ---- field=account 时使用（非转账）----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

  // ---- field=account 且为转账时使用（转出/转入账户，可只改一侧）----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromSubAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toSubAccountId?: string;

  // ---- field=person 时使用（留空表示清除人员）----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

  // ---- field=occurredOn 时使用 ----
  @ApiPropertyOptional({ example: "2026-06-27" })
  @IsOptional()
  @IsString()
  @Matches(datePattern)
  occurredOn?: string;

  // ---- field=note 时使用（留空表示清除备注）----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;
}
