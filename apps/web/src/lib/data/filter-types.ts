import type { TransactionType } from "@/lib/api";

export type FilterField =
  | "account"
  | "amountRange"
  | "category"
  | "createdRange"
  | "creator"
  | "dateRange"
  | "keyword"
  | "person"
  | "type";

export type BusinessFilterValue = {
  accountId?: string | null;
  accountIds?: string[];
  amountMax?: string;
  amountMin?: string;
  categoryId?: string | null;
  categoryIds?: string[];
  creatorId?: string | null;
  creatorIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  createdFrom?: string;
  createdTo?: string;
  keyword?: string;
  personId?: string | null;
  personIds?: string[];
  subcategoryIds?: string[];
  timePreset?: "month" | "lastmonth" | "week" | "lastweek" | "30d" | "year" | "lastyear" | "all" | "custom";
  type?: TransactionType | "all";
};

export const defaultFilterValue: BusinessFilterValue = {
  type: "all",
  timePreset: "month",
};
