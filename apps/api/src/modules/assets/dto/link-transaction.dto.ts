import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class LinkTransactionDto {
  @ApiProperty()
  @IsString()
  transactionId!: string;
}
