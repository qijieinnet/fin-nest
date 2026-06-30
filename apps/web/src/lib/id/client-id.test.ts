import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientId } from "./client-id";

describe("createClientId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses native randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(createClientId("sheet")).toBe("sheet-11111111-1111-4111-8111-111111111111");
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_value, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    });

    expect(createClientId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
