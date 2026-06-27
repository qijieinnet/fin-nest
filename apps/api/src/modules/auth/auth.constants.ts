export const SESSION_COOKIE_NAME = "fin_nest_session";
export const SESSION_TTL_DAYS = 30;

export const SERVICE_TOKEN_SCOPES = [
  "users:read",
  "ledgers:read",
  "transactions:read",
  "transactions:write:draft",
  "ai:write",
  "files:read",
] as const;

export type ServiceTokenScope = (typeof SERVICE_TOKEN_SCOPES)[number];
