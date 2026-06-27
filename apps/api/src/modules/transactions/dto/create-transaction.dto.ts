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

const moneyPattern = /^(0|[1-9]\d*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class TransactionAccountRelationDto {
  @ApiProperty()
  @IsString()
  accountId!: string;

  @ApiProperty({ enum: ["receivable_from_expense", "payable_from_income", "receivable_from_income", "payable_from_expense"] })
  @IsIn(["receivable_from_expense", "payable_from_income", "receivable_from_income", "payable_from_expense"])
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

  @ApiPropertyOptional({ example: "CNY" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

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

  @ApiPropertyOptional({ type: [TransactionAccountRelationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TransactionAccountRelationDto)
  relations?: TransactionAccountRelationDto[];
}
