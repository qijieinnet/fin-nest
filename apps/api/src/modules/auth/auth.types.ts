export type SessionAuthContext = {
  kind: "session";
  userId: string;
  sessionId: string;
  isAdmin: boolean;
};

export type ServiceAuthContext = {
  kind: "service";
  serviceTokenId: string;
  scopes: string[];
  actorUserId?: string;
  ledgerId?: string;
};

export type AuthContext = SessionAuthContext | ServiceAuthContext;

export type RequestWithAuth = {
  auth?: AuthContext;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};
