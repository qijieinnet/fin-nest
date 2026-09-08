import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

/**
 * 投资账户改余额时，这笔差额算收益还是算本金。
 * 只对 type='invest' 生效，其余账户的余额修改一律是 adjustment（记错了纠错）。
 */
export const INVESTMENT_ENTRY_KINDS = ["revaluation", "principal"] as const;
export type InvestmentEntryKind = (typeof INVESTMENT_ENTRY_KINDS)[number];

export class AdjustAccountDto {
  @ApiProperty({ example: "120000000" })
  @IsString()
  @Matches(/^-?\d+$/)
  balanceAfterMicros!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

  /**
   * 不传按 revaluation（市值涨跌）处理——这是投资账户改余额的主要用途，
   * 也让 51 号迁移之前就存在的调用方行为保持不变。
   */
  @ApiPropertyOptional({ enum: INVESTMENT_ENTRY_KINDS })
  @IsOptional()
  @IsIn(INVESTMENT_ENTRY_KINDS)
  kind?: InvestmentEntryKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;
}
