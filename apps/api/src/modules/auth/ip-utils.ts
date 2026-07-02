import { isIP } from "node:net";

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
