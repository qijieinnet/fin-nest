let fallbackCounter = 0;

function getBrowserCrypto(): Crypto | undefined {
  return typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
}

function randomHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nativeRandomUuid(cryptoSource: Crypto): string | null {
  if (typeof cryptoSource.randomUUID !== "function") return null;

  try {
    return cryptoSource.randomUUID();
  } catch {
    return null;
  }
}

function randomUuidFromValues(cryptoSource: Crypto): string | null {
  if (typeof cryptoSource.getRandomValues !== "function") return null;

  const bytes = new Uint8Array(16);
  cryptoSource.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = randomHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createClientId(prefix?: string): string {
  const cryptoSource = getBrowserCrypto();
  const id = cryptoSource ? (nativeRandomUuid(cryptoSource) ?? randomUuidFromValues(cryptoSource)) : null;

  if (id) return prefix ? `${prefix}-${id}` : id;

  fallbackCounter += 1;
  const fallback = `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${fallback}` : fallback;
}
