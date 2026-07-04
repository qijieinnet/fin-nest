import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";
import { TransactionAccountRelationDto } from "../../transactions/dto/create-transaction.dto";

export class CreateQuickTemplateDto {
  @ApiProperty({ enum: ["expense", "income", "transfer"] })
  @IsIn(["expense", "income", "transfer"])
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ example: "8800000" })
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  amountMicros?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategoryId?: string;

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
  fromAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toSubAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  directEnabled?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateQuickTemplateDto extends PartialType(CreateQuickTemplateDto) {}
