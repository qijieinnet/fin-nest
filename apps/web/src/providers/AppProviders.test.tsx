import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "./AppProviders";
import { ConfirmProvider } from "./ConfirmProvider";
import { NavigationProgressProvider } from "./NavigationProgressProvider";
import { SheetStackProvider } from "./SheetStackProvider";
import { ToastProvider } from "./ToastProvider";

/**
 * 只调用组件函数拿元素树、不挂载：AppProviders 里的 Auth / Ledger 一挂载就发请求，
 * 而这里要断言的只是嵌套顺序。
 */
function providerChain(node: ReactNode, chain: unknown[] = []): unknown[] {
  if (!isValidElement(node)) return chain;
  const element = node as ReactElement<{ children?: ReactNode }>;
  return providerChain(element.props.children, [...chain, element.type]);
}

describe("AppProviders", () => {
  /**
   * Toast / Confirm / SheetStack 都把弹层渲染成 children 的兄弟节点，因此它们的内容
   * 不在自己的 provider 之下。进度条 provider 一旦被套进这三者里层，弹层里任何调
   * useAppRouter 的组件（桌面「记一笔」就是）都会抛错整页白屏。
   */
  it("进度条 provider 在 Toast / Confirm / SheetStack 之上", () => {
    const chain = providerChain(AppProviders({ children: null }));
    const navIndex = chain.indexOf(NavigationProgressProvider);

    expect(navIndex).toBeGreaterThanOrEqual(0);
    for (const overlayProvider of [ToastProvider, ConfirmProvider, SheetStackProvider]) {
      expect(chain.indexOf(overlayProvider)).toBeGreaterThan(navIndex);
    }
  });
});
