import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { AGENT_TOKEN_SCOPES } from "../agent-token.constants";

export class CreateAgentTokenDto {
  @ApiProperty({ example: "Claude Code - 笔记本" })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: "可访问的账本；不传或空数组 = 我所在的全部账本",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  ledgerIds?: string[];

  @ApiProperty({ enum: AGENT_TOKEN_SCOPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(AGENT_TOKEN_SCOPES, { each: true })
  scopes!: string[];

  @ApiPropertyOptional({ type: [String], example: ["192.168.1.0/24"] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowedIps?: string[];

  @ApiPropertyOptional({ example: "2027-01-01T00:00:00.000Z", description: "不传 = 永不过期" })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class UpdateAgentTokenDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  ledgerIds?: string[];

  @ApiPropertyOptional({ enum: AGENT_TOKEN_SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AGENT_TOKEN_SCOPES, { each: true })
  scopes?: string[];
}
