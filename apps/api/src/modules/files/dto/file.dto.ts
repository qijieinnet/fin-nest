import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class UploadAttachmentDto {
  @ApiProperty({ enum: ["transaction", "insurance", "item"] })
  @IsIn(["transaction", "insurance", "item"])
  ownerType!: string;

  @ApiProperty()
  @IsString()
  ownerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checksum?: string;
}
