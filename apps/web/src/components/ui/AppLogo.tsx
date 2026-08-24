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
        <linearGradient
          id="appLogoMarkGradient"
          gradientUnits="userSpaceOnUse"
          x1="35"
          x2="94"
          y1="36"
          y2="98"
        >
          <stop offset="0" stopColor="#7259D9" />
          <stop offset="0.52" stopColor="#4B68D5" />
          <stop offset="1" stopColor="#2698C1" />
        </linearGradient>
      </defs>
      <rect fill="#FFFFFF" height="128" rx="28" width="128" />
      <path
        d="M37 87 V40 L91 87 V40"
        fill="none"
        stroke="url(#appLogoMarkGradient)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="10"
      />
      <path
        d="M37 87 Q64 103 91 87"
        fill="none"
        stroke="url(#appLogoMarkGradient)"
        strokeLinecap="round"
        strokeWidth="7"
      />
      <circle cx="64" cy="63" fill="url(#appLogoMarkGradient)" r="12" />
      <path
        d="M64 54 C65.1 59.1 67.9 61.9 73 63 C67.9 64.1 65.1 66.9 64 72 C62.9 66.9 60.1 64.1 55 63 C60.1 61.9 62.9 59.1 64 54Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
