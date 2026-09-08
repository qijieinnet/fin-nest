import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { INVESTMENT_ENTRY_KINDS, type InvestmentEntryKind } from "./adjust-account.dto";

/** 把一条已有的投资流水在「市值涨跌」与「本金存取」之间改判。金额不变，只换归类。 */
export class ReclassifyEntryDto {
  @ApiProperty({ enum: INVESTMENT_ENTRY_KINDS })
  @IsIn(INVESTMENT_ENTRY_KINDS)
  entryType!: InvestmentEntryKind;
}
