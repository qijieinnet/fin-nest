import { randomBytes, createHash } from "node:crypto";

export function createInviteCode(): string {
  return `fn_inv_${randomBytes(18).toString("base64url")}`;
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}
