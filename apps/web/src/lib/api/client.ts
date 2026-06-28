import { publicEnv } from "@/lib/config/public-env";
import { ApiClientError, type ApiErrorPayload } from "./errors";

type PrimitiveQueryValue = string | number | boolean | null | undefined;

export type ApiRequestOptions = Omit<RequestInit, "body" | "credentials"> & {
  body?: unknown;
  credentials?: RequestCredentials;
  query?: Record<string, PrimitiveQueryValue | PrimitiveQueryValue[]>;
};

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${publicEnv.apiBaseUrl}${path}`);

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
  const { body, headers, query, credentials = "include", ...init } = options;
  const requestHeaders = new Headers(headers);
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

  const response = await fetch(buildUrl(path, query), requestInit);
  const parsed = await parseResponse(response);

  if (!response.ok) {
    throw new ApiClientError(response.status, parsed as ApiErrorPayload | undefined);
  }

  return parsed as TResponse;
}
