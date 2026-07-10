import { isIP } from "node:net";

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

/**
 * 提取客户端 IP。仅当部署在可信反向代理后（TRUST_PROXY=true）才读 X-Forwarded-For，
 * 否则该头可被调用方伪造（登录限速、service token IP 白名单都会被绕过），只信 socket 地址。
 */
export function clientIpFromRequest(request: RequestLike, trustProxy: boolean): string | null {
  if (trustProxy) {
    const header = request.headers["x-forwarded-for"];
    const value = Array.isArray(header) ? header[0] : header;
    if (value) return normalizeIp(value);
  }
  return normalizeIp(request.ip ?? request.socket?.remoteAddress);
}

export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  // x-forwarded-for 前部由客户端可控（可伪造），最后一跳才是最近的可信代理追加的地址。
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const candidate = parts[parts.length - 1];
  if (!candidate) return null;
  if (candidate.startsWith("::ffff:")) return candidate.slice("::ffff:".length);
  return candidate;
}

export function ipMatchesAllowedCidrs(ip: string | null, allowedCidrs: string[]): boolean {
  if (allowedCidrs.length === 0) return true;
  if (!ip || isIP(ip) === 0) return false;
  return allowedCidrs.some((cidr) => matchesCidr(ip, cidr));
}

function matchesCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  if (!network || isIP(network) === 0) return false;
  if (!prefixText) return ip === network;

  const prefix = Number(prefixText);
  if (isIP(ip) !== 4 || isIP(network) !== 4 || !Number.isInteger(prefix)) {
    return ip === network;
  }

  const ipValue = ipv4ToInt(ip);
  const networkValue = ipv4ToInt(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipValue & mask) === (networkValue & mask);
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}
