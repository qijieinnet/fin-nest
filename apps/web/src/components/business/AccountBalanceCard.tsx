import type { ReactNode } from "react";
import { ChevronRight, WalletCards } from "lucide-react";
import { MoneyText } from "./MoneyText";

type AccountBalanceCardProps = {
  balanceMicros: bigint | number | string;
  balanceLabel?: string;
  badge?: string;
  children?: ReactNode;
  icon?: ReactNode;
  name: string;
  showChevron?: boolean;
  subtitle?: string;
};

export function AccountBalanceCard({
  balanceMicros,
  balanceLabel,
  badge,
  children,
  icon = <WalletCards size={20} />,
  name,
  showChevron = true,
  subtitle,
}: AccountBalanceCardProps) {
  return (
    <div className="biz-account-card">
      <span className="biz-account-card__icon">{icon}</span>
      <span className="biz-account-card__content">
        <span className="biz-account-card__title">
          <strong>{name}</strong>
          {badge ? <em>{badge}</em> : null}
        </span>
        {subtitle ? <small>{subtitle}</small> : null}
        {children}
      </span>
      <span className="biz-account-card__balance">
        {balanceLabel ? <small>{balanceLabel}</small> : null}
        <MoneyText amountMicros={balanceMicros} tone="auto" />
      </span>
      {showChevron ? <ChevronRight aria-hidden size={16} className="biz-account-card__chevron" /> : null}
    </div>
  );
}
