import type { CSSProperties } from "react";

type AppLogoProps = {
  className?: string;
  /** 图标边长（px），默认 32。 */
  size?: number;
  style?: CSSProperties;
};

/** Fin Nest 品牌图标（与 app/icon.svg 一致），用于登录页、桌面侧栏等处。 */
export function AppLogo({ className, size = 32, style }: AppLogoProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      style={style}
      viewBox="0 0 128 128"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="appLogoBg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#EFF4FD" />
          <stop offset="1" stopColor="#DBE8F8" />
        </linearGradient>
      </defs>
      <rect fill="url(#appLogoBg)" height="128" rx="28" width="128" />
      <circle cx="64" cy="48" fill="#F1C877" r="12" />
      <path
        d="M26 58 Q64 90 102 58"
        fill="none"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path
        d="M34 64 Q64 87 94 64"
        fill="none"
        opacity="0.6"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="3.4"
      />
      <path
        d="M43 69 Q64 82 85 69"
        fill="none"
        opacity="0.45"
        stroke="#7295D4"
        strokeLinecap="round"
        strokeWidth="2.6"
      />
    </svg>
  );
}
