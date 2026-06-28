import type { ReactNode } from "react";

export type TransactionType = "expense" | "income" | "transfer";

export type BusinessOption = {
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
