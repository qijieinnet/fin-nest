import type { ReactNode } from "react";

export type TransactionType = "expense" | "income" | "transfer";

export type BusinessOption = {
  /** 选项名后面的小标签（账户选择器用它显示归属人员）。 */
  badge?: string;
  color?: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  label: string;
  parentId?: string;
};

export type CategoryOption = BusinessOption & {
  iconName?: string;
  kind?: "expense" | "income";
  parentId?: string;
};

export type AttachmentItem = {
  contentType?: string;
  id: string;
  name: string;
  sizeBytes?: number;
  url?: string;
};
