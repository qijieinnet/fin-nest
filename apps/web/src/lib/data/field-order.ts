import type { RecordSetting, TransactionType } from "@/lib/api";

/** 记账表单字段的默认顺序（与后端记账设置默认值保持一致）。 */
export const DEFAULT_FIELD_ORDER = [
  "type",
  "amount",
  "category",
  "account",
  "date",
  "person",
  "note",
];

/** 取生效的字段顺序：优先用记账设置里的配置，未配置时回退默认顺序。 */
export function effectiveFieldOrder(setting?: Pick<RecordSetting, "fieldOrder"> | null): string[] {
  return setting?.fieldOrder?.length ? setting.fieldOrder : DEFAULT_FIELD_ORDER;
}

/**
 * 按交易类型整理需要渲染的字段（已去掉 type / amount，二者固定在顶部）。
 * 转账时分类不适用、账户改为「转出/转入」组合卡，统一挪到日期之后。
 */
export function orderedFieldsForType(order: string[], type: TransactionType): string[] {
  const fields = order.filter((field) => field !== "type" && field !== "amount");
  if (type !== "transfer") return fields;

  const withoutAccount = fields.filter((field) => field !== "account");
  const dateIndex = withoutAccount.indexOf("date");
  if (dateIndex === -1) return [...withoutAccount, "account"];
  return [
    ...withoutAccount.slice(0, dateIndex + 1),
    "account",
    ...withoutAccount.slice(dateIndex + 1),
  ];
}
