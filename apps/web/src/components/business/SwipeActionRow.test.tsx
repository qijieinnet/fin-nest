import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwipeActionRow } from "./SwipeActionRow";

const setPointerCapture = vi.fn();
const releasePointerCapture = vi.fn();
const captured = new Set<number>();

function renderRow() {
  const onRowClick = vi.fn();
  const { container } = render(
    <SwipeActionRow actions={[{ label: "删除", onClick: vi.fn() }]}>
      <button onClick={onRowClick} type="button">
        整行
      </button>
    </SwipeActionRow>,
  );
  const content = container.querySelector(".biz-swipe-row__content");
  if (!content) throw new Error("找不到滑动行内容层");
  return { content, onRowClick };
}

describe("SwipeActionRow", () => {
  beforeEach(() => {
    captured.clear();
    setPointerCapture.mockClear();
    releasePointerCapture.mockClear();
    // jsdom 没有指针捕获，打桩以便断言调用时机。
    Element.prototype.setPointerCapture = function (pointerId: number) {
      captured.add(pointerId);
      setPointerCapture(pointerId);
    };
    Element.prototype.releasePointerCapture = function (pointerId: number) {
      captured.delete(pointerId);
      releasePointerCapture(pointerId);
    };
    Element.prototype.hasPointerCapture = (pointerId: number) => captured.has(pointerId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 捕获期间浏览器会把 click 改派到捕获元素，内部可点区就再也收不到 click。
   * 所以 pointerdown 当下绝不能捕获，否则 PC 上鼠标点整行没有任何反应。
   */
  it("按下时不捕获指针，内部点击照常触发", () => {
    const { content, onRowClick } = renderRow();

    fireEvent.pointerDown(content, { clientX: 100, clientY: 20, pointerId: 1 });
    expect(setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerUp(content, { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.click(content.querySelector("button")!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("方向锁定为横向后才捕获指针，抬起时释放", () => {
    const { content } = renderRow();

    fireEvent.pointerDown(content, { clientX: 100, clientY: 20, pointerId: 1 });
    // 未达 6px 方向锁定阈值：仍不捕获。
    fireEvent.pointerMove(content, { clientX: 97, clientY: 20, pointerId: 1 });
    expect(setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(content, { clientX: 60, clientY: 20, pointerId: 1 });
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerUp(content, { clientX: 60, clientY: 20, pointerId: 1 });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("纵向滚动不捕获指针", () => {
    const { content } = renderRow();

    fireEvent.pointerDown(content, { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(content, { clientX: 100, clientY: 60, pointerId: 1 });
    expect(setPointerCapture).not.toHaveBeenCalled();
  });
});
