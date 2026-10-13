import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CURRENCY_CODES } from "@fin-nest/shared";

const moneyPattern = /^(0|[1-9]\d*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class TransactionAccountRelationDto {
  @ApiProperty()
  @IsString()
  accountId!: string;

  @ApiProperty({
    enum: [
      "receivable_from_expense",
      "payable_from_income",
      "receivable_from_income",
      "payable_from_expense",
    ],
  })
  @IsIn([
    "receivable_from_expense",
    "payable_from_income",
    "receivable_from_income",
    "payable_from_expense",
  ])
  relationKind!: string;

  @ApiProperty({ example: "12000000" })
  @IsString()
  @Matches(moneyPattern)
  amountMicros!: string;
}

export class CreateTransactionDto {
  @ApiProperty({ enum: ["expense", "income", "transfer"] })
  @IsIn(["expense", "income", "transfer"])
  type!: string;

  @ApiProperty({ example: "8800000" })
  @IsString()
  @Matches(moneyPattern)
  grossAmountMicros!: string;

  @ApiProperty({ example: "2026-06-27" })
  @IsString()
  @Matches(datePattern)
  occurredOn!: string;

  @ApiPropertyOptional({ example: "CNY", description: "必须等于账本本币；不传即本币" })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  currency?: string;

  @ApiPropertyOptional({
    example: "USD",
    description:
      "外币那一侧的币种（不能是本币），与 originalAmountMicros 成对出现；grossAmountMicros 仍是本币金额",
  })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  originalCurrency?: string | null;

  @ApiPropertyOptional({ example: "10000000" })
  @IsOptional()
  @IsString()
  @Matches(moneyPattern)
  originalAmountMicros?: string | null;

  @ApiPropertyOptional({
    example: "HKD",
    description: "仅转账：转出、转入都是外币且币种不同时，转入侧币种（须等于转入账户币种）",
  })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  toCurrency?: string | null;

  @ApiPropertyOptional({ example: "78000000" })
  @IsOptional()
  @IsString()
  @Matches(moneyPattern)
  toAmountMicros?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subAccountId?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemId?: string | null;

  @ApiPropertyOptional({ enum: ["consumable", "purchase"] })
  @IsOptional()
  @IsIn(["consumable", "purchase"])
  itemLinkKind?: "consumable" | "purchase";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionId?: string | null;

  @ApiPropertyOptional({ type: [TransactionAccountRelationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TransactionAccountRelationDto)
  relations?: TransactionAccountRelationDto[];
}
