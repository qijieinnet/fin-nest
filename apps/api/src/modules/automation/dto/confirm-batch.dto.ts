import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsString } from "class-validator";

export class ConfirmAutoPendingBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  pendingIds!: string[];
}
