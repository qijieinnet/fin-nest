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
  meta?: ReactNode;
  onClick?: () => void;
  personName?: string;
  time?: string;
  title: string;
  type: TransactionType;
};

export function TransactionRow({
  accountName,
  amountMicros,
  categoryColor,
  categoryIcon,
  categoryName,
  description,
  meta,
  onClick,
  personName,
  time,
  title,
  type,
}: TransactionRowProps) {
  const content = (
    <>
      <CategoryIcon color={categoryColor} icon={categoryIcon} />
      <span className="biz-transaction-row__main">
        <strong>{title}</strong>
        <small>
          {[categoryName, accountName, personName, time].filter(Boolean).join(" · ")}
        </small>
        {description ? <em>{description}</em> : null}
      </span>
      <span className="biz-transaction-row__side">
        <MoneyText
          amountMicros={amountMicros}
          showPositiveSign={type === "income"}
          tone={type === "transfer" ? "transfer" : "auto"}
        />
        {meta ? <small>{meta}</small> : null}
      </span>
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
  totalMicros?: bigint | number | string;
};

export function TransactionGroup({ children, className, dateLabel, totalMicros }: TransactionGroupProps) {
  return (
    <section className={cn("biz-transaction-group", className)}>
      <header className="biz-transaction-group__header">
        <strong>{dateLabel}</strong>
        {totalMicros !== undefined ? <MoneyText amountMicros={totalMicros} tone="neutral" /> : null}
      </header>
      <div className="biz-transaction-group__rows">{children}</div>
    </section>
  );
}

