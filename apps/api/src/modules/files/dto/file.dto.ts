import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateUploadUrlDto {
  @ApiProperty({ enum: ["transaction", "insurance", "item"] })
  @IsIn(["transaction", "insurance", "item"])
  ownerType!: string;

  @ApiProperty()
  @IsString()
  ownerId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  originalName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  mime!: string;
}

export class BindAttachmentDto extends CreateUploadUrlDto {
  @ApiProperty()
  @IsString()
  objectKey!: string;

  @ApiProperty({ example: "1024" })
  @IsString()
  @Matches(/^(0|[1-9]\d*)$/)
  sizeBytes!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checksum?: string;
}
