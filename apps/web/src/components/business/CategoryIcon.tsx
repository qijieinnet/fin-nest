import type { CSSProperties, ReactNode } from "react";
import {
  Apple,
  Bus,
  Car,
  CircleDollarSign,
  Coffee,
  CreditCard,
  Gift,
  HeartPulse,
  Home,
  Plane,
  ReceiptText,
  Shirt,
  ShoppingBag,
  Sparkles,
  Utensils,
  Wallet,
  WalletCards,
} from "lucide-react";

const iconMap: Record<string, ReactNode> = {
  account: <WalletCards size={18} />,
  apple: <Apple size={18} />,
  bus: <Bus size={18} />,
  car: <Car size={18} />,
  coffee: <Coffee size={18} />,
  food: <Utensils size={18} />,
  utensils: <Utensils size={18} />,
  gift: <Gift size={18} />,
  health: <HeartPulse size={18} />,
  home: <Home size={18} />,
  income: <CircleDollarSign size={18} />,
  plane: <Plane size={18} />,
  receipt: <ReceiptText size={18} />,
  shopping: <ShoppingBag size={18} />,
  "shopping-bag": <ShoppingBag size={18} />,
  sparkles: <Sparkles size={18} />,
  transfer: <CreditCard size={18} />,
  wallet: <Wallet size={18} />,
  wear: <Shirt size={18} />,
};

type CategoryIconProps = {
  color?: string;
  icon?: string;
};

export function CategoryIcon({ color, icon = "receipt" }: CategoryIconProps) {
  const content = iconMap[icon] ?? <span className="text-[18px] leading-none">{icon}</span>;

  return (
    <span
      className="biz-category-icon"
      style={color ? ({ "--biz-icon-color": color } as CSSProperties) : undefined}
    >
      {content}
    </span>
  );
}
