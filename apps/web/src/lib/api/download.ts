import { resolveApiBaseUrl } from "@/lib/config/public-env";
import { ApiClientError, type ApiErrorPayload } from "./errors";
import { getSessionToken } from "./token-storage";

/**
 * 下载二进制文件（Excel / JSON 备份）。apiRequest 的 parseResponse 只处理
 * json/text，走它会损坏 xlsx，所以单独用 fetch + blob + a[download]。
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const target = path.startsWith("http") ? path : `${resolveApiBaseUrl()}${path}`;
  const url = new URL(target, window.location.origin);
  const token = getSessionToken();
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    let payload: ApiErrorPayload | undefined;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      payload = undefined;
    }
    throw new ApiClientError(response.status, payload);
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // 编码异常时继续尝试普通 filename。
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}
