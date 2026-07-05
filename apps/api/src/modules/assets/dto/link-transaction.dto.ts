import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class LinkTransactionDto {
  @ApiProperty()
  @IsString()
  transactionId!: string;

  @ApiPropertyOptional({ enum: ["related", "consumable", "purchase"] })
  @IsOptional()
  @IsIn(["related", "consumable", "purchase"])
  linkKind?: string;
}
