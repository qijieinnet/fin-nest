import { localized, msg } from "@/lib/i18n";

/** 币种中文名（英文界面走词典）。目录在 @fin-nest/shared 的 CURRENCIES，这里只管显示名。 */
export const CURRENCY_NAMES: Record<string, string> = localized({
  CNY: msg("人民币"),
  USD: msg("美元"),
  HKD: msg("港币"),
  EUR: msg("欧元"),
  GBP: msg("英镑"),
  JPY: msg("日元"),
  KRW: msg("韩元"),
  TWD: msg("新台币"),
  MOP: msg("澳门元"),
  SGD: msg("新加坡元"),
  AUD: msg("澳元"),
  CAD: msg("加元"),
  NZD: msg("新西兰元"),
  CHF: msg("瑞士法郎"),
  THB: msg("泰铢"),
  MYR: msg("马来西亚林吉特"),
});

/** 「美元 USD」这种完整标签；未收录的直接用代码。 */
export function currencyLabel(code: string): string {
  const name = CURRENCY_NAMES[code];
  return name ? `${name} ${code}` : code;
}
