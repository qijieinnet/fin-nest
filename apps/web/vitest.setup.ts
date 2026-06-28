import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: {
    supports: () => true,
  },
});
