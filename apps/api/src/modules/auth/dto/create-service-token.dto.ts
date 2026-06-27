import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length } from "class-validator";
import { SERVICE_TOKEN_SCOPES } from "../auth.constants";

export class CreateServiceTokenDto {
  @ApiProperty({ example: "Dify integration" })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ enum: SERVICE_TOKEN_SCOPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(SERVICE_TOKEN_SCOPES, { each: true })
  scopes!: string[];

  @ApiPropertyOptional({ type: [String], example: ["192.168.1.0/24"] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  allowedIps?: string[];

  @ApiPropertyOptional({ example: "2027-01-01T00:00:00.000Z" })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
