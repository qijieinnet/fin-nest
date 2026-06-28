import type { ReactNode } from "react";
import { WalletCards } from "lucide-react";
import { MoneyText } from "./MoneyText";

type AccountBalanceCardProps = {
  balanceMicros: bigint | number | string;
  icon?: ReactNode;
  name: string;
  subtitle?: string;
};

export function AccountBalanceCard({
  balanceMicros,
  icon = <WalletCards size={20} />,
  name,
  subtitle,
}: AccountBalanceCardProps) {
  return (
    <div className="biz-account-card">
      <span className="biz-account-card__icon">{icon}</span>
      <span>
        <strong>{name}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <MoneyText amountMicros={balanceMicros} tone="auto" />
    </div>
  );
}

