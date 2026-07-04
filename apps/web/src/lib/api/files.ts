import { buildApiUrl } from "./client";
import { ledgerApiPath } from "./endpoints";
import { ApiClientError, type ApiErrorPayload } from "./errors";
import { getSessionToken } from "./token-storage";

async function parseErrorPayload(response: Response): Promise<ApiErrorPayload | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return undefined;
  }
}

export async function createAuthorizedObjectUrl(path: string): Promise<string> {
  const headers = new Headers();
  const token = getSessionToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(buildApiUrl(path), {
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    throw new ApiClientError(response.status, await parseErrorPayload(response));
  }

  return URL.createObjectURL(await response.blob());
}

export async function uploadAttachmentFile(
  ledgerId: string,
  ownerType: "transaction" | "insurance" | "item",
  ownerId: string,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.append("ownerType", ownerType);
  formData.append("ownerId", ownerId);
  formData.append("file", file, file.name);

  const headers = new Headers();
  const token = getSessionToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(buildApiUrl(ledgerApiPath(ledgerId, "/files/upload")), {
    body: formData,
    credentials: "same-origin",
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new ApiClientError(response.status, await parseErrorPayload(response));
  }
}
