import { resolveApiBaseUrl } from "@/lib/config/public-env";
import { buildApiUrl } from "./client";
import { ApiClientError, type ApiErrorPayload } from "./errors";
import { handleApiAuthFailure } from "./session-expiry";
import { getSessionToken } from "./token-storage";

/** 超过这个大小就别往内存里塞了，优先走「另存为」直接流到磁盘。 */
const STREAM_THRESHOLD_BYTES = 64 * 1024 * 1024;

/**
 * 下载二进制文件（Excel / JSON 备份 / 系统备份归档）。apiRequest 的 parseResponse 只处理
 * json/text，走它会损坏 xlsx，所以单独用 fetch + a[download]。
 *
 * 系统备份归档可能上 GB，`response.blob()` 会把整份读进内存直接把标签页撑爆。因此大文件优先
 * 用 File System Access API 把响应流直接写进用户选定的文件；浏览器不支持（Firefox / Safari）
 * 或用户取消选择时回退到 blob——小文件本来就走这条路。
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
    const error = new ApiClientError(response.status, payload);
    handleApiAuthFailure(error);
    throw error;
  }
  const filename =
    filenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackName;
  const declared = Number(response.headers.get("content-length") ?? "0");

  if (declared > STREAM_THRESHOLD_BYTES && response.body) {
    const streamed = await streamToDisk(response.body, filename);
    // 用户取消了「另存为」：正文已经被消费，不能再退回 blob，直接当作放弃本次下载。
    if (streamed !== "unsupported") return;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

type SaveFilePicker = (options: {
  suggestedName?: string;
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

/** 返回 "unsupported" 表示浏览器没有这个 API，调用方应回退；其余情况本次下载已了结。 */
async function streamToDisk(
  body: ReadableStream<Uint8Array>,
  filename: string,
): Promise<"done" | "cancelled" | "unsupported"> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker !== "function") return "unsupported";
  let writable: WritableStream<Uint8Array>;
  try {
    const handle = await picker({ suggestedName: filename });
    writable = await handle.createWritable();
  } catch {
    // 用户取消选择，或页面不在安全上下文/用户手势里。
    return "cancelled";
  }
  await body.pipeTo(writable);
  return "done";
}

/**
 * 带进度的 multipart 上传。
 *
 * 用 XHR 而不是 fetch：系统备份归档动辄上 GB，没有进度条的话用户只能盯着一个转圈猜它是不是卡死了，
 * 而 fetch 至今没有可用的上传进度事件（`ReadableStream` 请求体的支持面和 duplex 要求都还不够）。
 */
export function uploadFileWithProgress<TResponse>(
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", buildApiUrl(path));
    const token = getSessionToken();
    if (token) request.setRequestHeader("authorization", `Bearer ${token}`);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () => {
      let payload: unknown = null;
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) resolve(payload as TResponse);
      else {
        const error = new ApiClientError(request.status, payload as ApiErrorPayload | undefined);
        handleApiAuthFailure(error);
        reject(error);
      }
    });
    request.addEventListener("error", () => reject(new ApiClientError(0, undefined)));
    request.addEventListener("abort", () => reject(new ApiClientError(0, undefined)));
    request.send(form);
  });
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
