"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// pdfjs 体积较大且仅在打开 PDF 时才需要，动态 import 保持主包精简；
// worker 用 new URL(..., import.meta.url) 让打包器把 worker 作为静态资源发出。
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

type PdfPreviewProps = {
  url: string;
};

// 按容器宽度自适应渲染每一页到 canvas，纵向堆叠可滚动查看全部页面。
// 相比 <iframe> 依赖浏览器内置 PDF 阅读器（移动端普遍只出首页且不适配宽度），
// 自渲染在移动端/桌面端表现一致。
export function PdfPreview({ url }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // 渲染宽度：初始 0，挂载后由 ResizeObserver 写入，宽度显著变化（如旋转）时重渲染。
  const [renderWidth, setRenderWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width <= 0) return;
      // 阈值去抖，避免滚动条出现等微小变化触发整份重渲染。
      setRenderWidth((current) => (Math.abs(current - width) > 24 ? width : current));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || renderWidth <= 0) return;

    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setStatus("loading");

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }

        container.replaceChildren();
        // 高分屏按 devicePixelRatio 提升清晰度，上限 2 控制内存。
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          if (cancelled) break;
          const page = await doc.getPage(pageNumber);
          if (cancelled) break;

          const baseViewport = page.getViewport({ scale: 1 });
          const scale = renderWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.className = "biz-pdf-viewer__page";
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          // CSS 宽度锁定容器宽度、高度按比例，实现 fit-width。
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          container.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
          page.cleanup();
        }

        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (doc) void doc.loadingTask.destroy();
    };
  }, [url, renderWidth]);

  return (
    <div className="biz-pdf-viewer">
      <div className="biz-pdf-viewer__pages" ref={containerRef} />
      {status !== "ready" ? (
        <div className="biz-pdf-viewer__status" role="status">
          {status === "loading" ? (
            <>
              <Loader2 className="biz-pdf-viewer__spinner" size={22} />
              <span>正在加载 PDF…</span>
            </>
          ) : (
            <span>PDF 暂时无法预览</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
