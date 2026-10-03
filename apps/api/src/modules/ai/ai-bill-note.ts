// 识图记账的备注兜底清洗：账单截图的「交易描述」常是支付通道/交易类型这类无信息量的词
// （代付、消费、网银在线、微信支付），或被列表截断成看不出是谁的半截名称（「微信支付-Man…」）。
// 提示词已要求模型不写这些，这里用确定性规则再兜一层，不依赖模型每次都照做。

/** 只表示支付通道/交易类型、不指向具体商户或对方的词。整段等于其一时丢弃。 */
const GENERIC_BILL_TERMS = new Set([
  "代付",
  "代扣",
  "消费",
  "支付",
  "付款",
  "收款",
  "交易",
  "转账",
  "转帐",
  "网银在线",
  "网上支付",
  "在线支付",
  "网上银行",
  "手机银行",
  "快捷支付",
  "扫码支付",
  "二维码支付",
  "银联",
  "银联在线",
  "银联快捷",
  "银联消费",
  "云闪付",
  "刷卡消费",
  "pos消费",
  "跨行消费",
  "商户消费",
  "财付通",
  "微信",
  "微信支付",
  "微信转账",
  "微信红包",
  "支付宝",
  "美团支付",
  "京东支付",
  "抖音支付",
  "拼多多支付",
]);

/** 截断标记：列表行尾的省略号。 */
const TRUNCATION = /(?:…+|\.{2,}|⋯+)\s*$/;

/** 分段符：截图描述常用逗号、横线、括号、斜杠把通道与商户拼在一起。 */
const SEPARATORS = /[，,、\-—–_|/／:：()（）[\]【】\s]+/;

/** 半截名称至少要这么长才保留（CJK 按字、拉丁按字符），短于此区分不出是谁。 */
const MIN_CJK_FRAGMENT = 3;
const MIN_LATIN_FRAGMENT = 5;

function isMeaningfulFragment(segment: string): boolean {
  const cjk = segment.match(/[一-鿿]/g)?.length ?? 0;
  if (cjk > 0) return cjk >= MIN_CJK_FRAGMENT;
  return segment.replace(/[^a-z0-9]/gi, "").length >= MIN_LATIN_FRAGMENT;
}

/**
 * 清洗识图草稿的备注：去掉通用通道/交易类型词；被截断的末段太短（区分不出是谁）则丢弃；
 * 截断的省略号去掉。清洗后为空返回 undefined（不写备注）。
 */
export function cleanBillNote(note: string | undefined): string | undefined {
  const raw = note?.trim();
  if (!raw) return undefined;
  const truncated = TRUNCATION.test(raw);
  const segments = raw
    .replace(TRUNCATION, "")
    .split(SEPARATORS)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const kept = segments.filter((segment, index) => {
    if (GENERIC_BILL_TERMS.has(segment.toLowerCase())) return false;
    if (truncated && index === segments.length - 1) return isMeaningfulFragment(segment);
    return true;
  });
  const cleaned = kept.join(" ").trim();
  return cleaned || undefined;
}
