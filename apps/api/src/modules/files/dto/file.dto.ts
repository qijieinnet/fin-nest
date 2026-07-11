import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class UploadAttachmentDto {
  @ApiProperty({ enum: ["transaction", "insurance", "item", "subscription"] })
  @IsIn(["transaction", "insurance", "item", "subscription"])
  ownerType!: string;

  @ApiProperty()
  @IsString()
  ownerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checksum?: string;
}
