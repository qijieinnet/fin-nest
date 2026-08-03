import { resolveApiBaseUrl } from "@/lib/config/public-env";
import { ApiClientError, type ApiErrorPayload } from "./errors";
import { handleApiAuthFailure } from "./session-expiry";
import { getSessionToken } from "./token-storage";

type PrimitiveQueryValue = string | number | boolean | null | undefined;

export type ApiRequestOptions = Omit<RequestInit, "body" | "credentials"> & {
  body?: unknown;
  credentials?: RequestCredentials;
  query?: Record<string, PrimitiveQueryValue | PrimitiveQueryValue[]>;
};

export function buildApiUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const target = path.startsWith("http") ? path : `${resolveApiBaseUrl()}${path}`;
  // 同源代理下 base 是相对路径（如 /api），需要以当前页面 origin 补全。
  const url = new URL(target, typeof window === "undefined" ? undefined : window.location.origin);

  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      }
    }
  }

  return url.toString();
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof URLSearchParams ||
    typeof value === "string"
  );
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const { body, headers, query, credentials = "same-origin", ...init } = options;
  const requestHeaders = new Headers(headers);

  // 会话凭证放请求头而非 cookie；显式传入 authorization 的调用方优先。
  const token = getSessionToken();
  if (token && !requestHeaders.has("authorization")) {
    requestHeaders.set("authorization", `Bearer ${token}`);
  }

  const requestInit: RequestInit = {
    ...init,
    credentials,
    headers: requestHeaders,
  };

  if (body !== undefined) {
    if (isBodyInit(body)) {
      requestInit.body = body;
    } else {
      requestHeaders.set("content-type", requestHeaders.get("content-type") ?? "application/json");
      requestInit.body = JSON.stringify(body);
    }
  }

  const response = await fetch(buildApiUrl(path, query), requestInit);
  const parsed = await parseResponse(response);

  if (!response.ok) {
    const error = new ApiClientError(response.status, parsed as ApiErrorPayload | undefined);
    // 会话失效在这里统一收口，调用方不必各自判断（按错误码而非 401，见 session-expiry）。
    handleApiAuthFailure(error);
    throw error;
  }

  return parsed as TResponse;
}
