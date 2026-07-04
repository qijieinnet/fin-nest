import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { CategoryIcon } from "./CategoryIcon";
import { MoneyText } from "./MoneyText";
import type { TransactionType } from "./business-types";

type TransactionRowProps = {
  accountName?: string;
  amountMicros: bigint | number | string;
  categoryColor?: string;
  categoryIcon?: string;
  categoryName: string;
  description?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  personName?: string;
  recordName?: string;
  time?: string;
  title: string;
  type: TransactionType;
};

export function TransactionRow({
  amountMicros,
  categoryColor,
  categoryIcon,
  description,
  icon,
  meta,
  onClick,
  personName,
  title,
  type,
}: TransactionRowProps) {
  const content = (
    <>
      <span className="biz-transaction-row__icon">
        {icon ?? <CategoryIcon color={categoryColor} icon={categoryIcon} />}
      </span>
      <span className="biz-transaction-row__main">
        <strong>{title}</strong>
        {personName ? <small>{personName}</small> : null}
        {description ? <small>{description}</small> : null}
      </span>
      <span className="biz-transaction-row__side">
        <MoneyText amountMicros={amountMicros} tone={type} trimTrailingZeros />
        {meta ? <small>{meta}</small> : null}
      </span>
      {onClick ? (
        <ChevronRight className="biz-transaction-row__chevron" size={16} strokeWidth={3} />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button className="biz-transaction-row" onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return <div className="biz-transaction-row">{content}</div>;
}

type TransactionGroupProps = {
  children: ReactNode;
  className?: string;
  dateLabel: string;
  incomeMicros?: bigint | number | string;
  totalMicros?: bigint | number | string;
};

export function TransactionGroup({
  children,
  className,
  dateLabel,
  incomeMicros,
  totalMicros,
}: TransactionGroupProps) {
  return (
    <section className={cn("biz-transaction-group", className)}>
      <header className="biz-transaction-group__header">
        <strong>{dateLabel}</strong>
        {totalMicros !== undefined || incomeMicros !== undefined ? (
          <span className="biz-transaction-group__summary">
            {totalMicros !== undefined ? (
              <span className="biz-transaction-group__summary-item biz-transaction-group__summary-item--expense">
                <MoneyText amountMicros={totalMicros} trimTrailingZeros />
              </span>
            ) : null}
            {incomeMicros !== undefined ? (
              <span className="biz-transaction-group__summary-item biz-transaction-group__summary-item--income">
                <MoneyText amountMicros={incomeMicros} trimTrailingZeros />
              </span>
            ) : null}
          </span>
        ) : null}
      </header>
      <div className="biz-transaction-group__rows">{children}</div>
    </section>
  );
}
