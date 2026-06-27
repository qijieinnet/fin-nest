import { Prisma } from "@fin-nest/db";

const DEFAULT_FIELD_ORDER = ["type", "amount", "category", "account", "date", "person", "note"];
const DEFAULT_VISIBLE_FIELDS = {
  account: true,
  person: true,
  note: true,
  attachments: true,
};

const DEFAULT_CATEGORIES = [
  { type: "expense", name: "餐饮", icon: "utensils", sortOrder: 10 },
  { type: "expense", name: "交通", icon: "bus", sortOrder: 20 },
  { type: "expense", name: "购物", icon: "shopping-bag", sortOrder: 30 },
  { type: "expense", name: "居家", icon: "home", sortOrder: 40 },
  { type: "income", name: "工资", icon: "wallet", sortOrder: 10 },
  { type: "income", name: "奖金", icon: "sparkles", sortOrder: 20 },
] as const;

export async function initializeLedgerDefaults(
  tx: Prisma.TransactionClient,
  ledgerId: string,
  actorUserId: string,
): Promise<void> {
  await tx.recordSetting.upsert({
    where: { ledgerId },
    create: {
      ledgerId,
      fieldOrder: DEFAULT_FIELD_ORDER,
      visibleFields: DEFAULT_VISIBLE_FIELDS,
      updatedBy: actorUserId,
    },
    update: {},
  });

  await tx.budgetSetting.upsert({
    where: { ledgerId },
    create: { ledgerId, enabled: false, updatedBy: actorUserId },
    update: {},
  });

  await tx.person.upsert({
    where: { ledgerId_name: { ledgerId, name: "我" } },
    create: {
      ledgerId,
      name: "我",
      icon: "user",
      isDefault: true,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    },
    update: { isDefault: true },
  });

  for (const category of DEFAULT_CATEGORIES) {
    await tx.category.upsert({
      where: {
        ledgerId_type_name: {
          ledgerId,
          type: category.type,
          name: category.name,
        },
      },
      create: {
        ledgerId,
        type: category.type,
        name: category.name,
        icon: category.icon,
        sortOrder: category.sortOrder,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      update: {},
    });
  }
}
