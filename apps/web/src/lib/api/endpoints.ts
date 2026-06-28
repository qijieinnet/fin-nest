export const API_ENDPOINTS = {
  health: "/health",
  me: "/auth/me",
  ledgers: "/ledgers",
} as const;

export function ledgerApiPath(ledgerId: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/ledgers/${encodeURIComponent(ledgerId)}${normalized}`;
}
