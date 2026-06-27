import { isIP } from "node:net";

export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  if (!first) return null;
  if (first.startsWith("::ffff:")) return first.slice("::ffff:".length);
  return first;
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
