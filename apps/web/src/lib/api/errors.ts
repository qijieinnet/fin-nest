export type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, payload?: ApiErrorPayload) {
    super(payload?.message ?? `Request failed with status ${status}`);
    this.name = "ApiClientError";
    this.status = status;
    this.code = payload?.code;
    this.details = payload?.details;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/**
 * 取面向用户的错误文案：后端统一返回中文 `message`，网络等异常回退到 fallback。
 */
export function getApiErrorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
  if (isApiClientError(error)) {
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return fallback;
  }
  return fallback;
}
