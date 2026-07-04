"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RotateCcw,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { IconButton } from "@/components/ui";
import type { AttachmentItem } from "./business-types";

function formatFileSize(sizeBytes?: number): string {
  if (!sizeBytes) return "";
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AttachmentPreviewProps = {
  items: AttachmentItem[];
  onOpen?: (item: AttachmentItem) => Promise<string | void> | string | void;
  onRemove?: (id: string) => void;
  variant?: "list" | "grid";
};

type ActivePreview = {
  index: number;
  item: AttachmentItem;
  url: string;
};

function isImage(item: AttachmentItem): boolean {
  return Boolean(item.contentType?.startsWith("image/"));
}

function isPdf(item: AttachmentItem): boolean {
  return item.contentType === "application/pdf";
}

function isVideo(item: AttachmentItem): boolean {
  return Boolean(item.contentType?.startsWith("video/"));
}

function canPreviewInPage(item: AttachmentItem): boolean {
  return isImage(item) || isPdf(item) || isVideo(item);
}

async function downloadUrl(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

export function AttachmentPreview({
  items,
  onOpen,
  onRemove,
  variant = "list",
}: AttachmentPreviewProps) {
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null);
  const [mounted, setMounted] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const generatedUrlsRef = useRef<string[]>([]);
  const loadingPreviewIdsRef = useRef<Set<string>>(new Set());

  const previewItems = useMemo(() => items.filter(canPreviewInPage), [items]);

  useEffect(() => {
    setMounted(true);
    return () => {
      for (const url of generatedUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      generatedUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!onOpen) return;
    let cancelled = false;
    for (const item of items) {
      if (!isImage(item) || item.url || previewUrls[item.id] || loadingPreviewIdsRef.current.has(item.id)) {
        continue;
      }
      loadingPreviewIdsRef.current.add(item.id);
      void Promise.resolve(onOpen(item))
        .then((result) => {
          if (cancelled) return;
          if (typeof result !== "string") return;
          if (result.startsWith("blob:")) {
            generatedUrlsRef.current.push(result);
          }
          setPreviewUrls((current) => ({ ...current, [item.id]: current[item.id] ?? result }));
        })
        .catch(() => undefined)
        .finally(() => {
          loadingPreviewIdsRef.current.delete(item.id);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [items, onOpen, previewUrls]);

  async function resolveUrl(item: AttachmentItem): Promise<string | null> {
    if (item.url) return item.url;
    const cachedUrl = previewUrls[item.id];
    if (cachedUrl) return cachedUrl;
    const result = await onOpen?.(item);
    if (typeof result !== "string") return null;
    if (result.startsWith("blob:")) {
      generatedUrlsRef.current.push(result);
    }
    setPreviewUrls((current) => ({ ...current, [item.id]: result }));
    return result;
  }

  async function openPreviewAt(index: number) {
    const nextItem = previewItems[index];
    if (!nextItem) return;
    const url = await resolveUrl(nextItem);
    if (!url) return;
    setActivePreview({ index, item: nextItem, url });
    setZoom(1);
  }

  async function handleOpen(item: AttachmentItem) {
    const url = await resolveUrl(item);
    if (!url) return;
    if (canPreviewInPage(item)) {
      const index = Math.max(
        0,
        previewItems.findIndex((candidate) => candidate.id === item.id),
      );
      setActivePreview({ index, item, url });
      setZoom(1);
      return;
    }
    await downloadUrl(url, item.name);
  }

  const closePreview = () => {
    setActivePreview(null);
    setZoom(1);
  };

  const showPrevious = () => {
    if (!activePreview || previewItems.length < 2) return;
    const nextIndex = (activePreview.index - 1 + previewItems.length) % previewItems.length;
    void openPreviewAt(nextIndex);
  };

  const showNext = () => {
    if (!activePreview || previewItems.length < 2) return;
    const nextIndex = (activePreview.index + 1) % previewItems.length;
    void openPreviewAt(nextIndex);
  };

  useEffect(() => {
    if (!activePreview) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePreview();
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
      if (event.key === "+" || event.key === "=") {
        setZoom((current) => Math.min(4, current + 0.25));
      }
      if (event.key === "-") {
        setZoom((current) => Math.max(0.5, current - 0.25));
      }
      if (event.key === "0") setZoom(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const previewOverlay =
    mounted && activePreview
      ? createPortal(
          <AttachmentFullscreenPreview
            hasMultiple={previewItems.length > 1}
            item={activePreview.item}
            onClose={closePreview}
            onNext={showNext}
            onPrevious={showPrevious}
            onResetZoom={() => setZoom(1)}
            onZoomIn={() => setZoom((current) => Math.min(4, current + 0.25))}
            onZoomOut={() => setZoom((current) => Math.max(0.5, current - 0.25))}
            position={`${activePreview.index + 1} / ${previewItems.length}`}
            url={activePreview.url}
            zoom={zoom}
          />,
          document.body,
        )
      : null;

  if (items.length === 0) {
    return <p className="biz-muted">暂无附件</p>;
  }

  if (variant === "grid") {
    return (
      <div className="biz-attachment-grid">
        {items.map((item) => {
          const image = isImage(item);
          const video = isVideo(item);
          const pdf = isPdf(item);
          const url = item.url ?? previewUrls[item.id];
          return (
            <div className="biz-attachment-tile" key={item.id}>
              <button
                aria-label={`打开 ${item.name}`}
                onClick={() => void handleOpen(item)}
                type="button"
              >
                {image && url ? (
                  <img alt="" src={url} />
                ) : video && url ? (
                  <video aria-hidden muted playsInline preload="metadata" src={url} />
                ) : image ? (
                  <ImageIcon size={20} />
                ) : video ? (
                  <Video size={20} />
                ) : pdf ? (
                  <FileText size={20} />
                ) : (
                  <Paperclip size={20} />
                )}
              </button>
              {onRemove ? (
                <button
                  aria-label={`移除 ${item.name}`}
                  onClick={() => onRemove(item.id)}
                  type="button"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
        {previewOverlay}
      </div>
    );
  }

  return (
    <div className="biz-attachment-list">
      {items.map((item) => {
        const image = isImage(item);
        const pdf = isPdf(item);
        const video = isVideo(item);
        const url = item.url ?? previewUrls[item.id];
        return (
          <div className="biz-attachment" key={item.id}>
            <button
              className="biz-attachment__open"
              onClick={() => void handleOpen(item)}
              type="button"
            >
              <span className="biz-attachment__thumb">
                {image && url ? (
                  <img alt="" src={url} />
                ) : video && url ? (
                  <video aria-hidden muted playsInline preload="metadata" src={url} />
                ) : image ? (
                  <ImageIcon size={18} />
                ) : video ? (
                  <Video size={18} />
                ) : pdf ? (
                  <FileText size={18} />
                ) : (
                  <Paperclip size={18} />
                )}
              </span>
              <span className="biz-attachment__copy">
                <strong>{item.name}</strong>
                <small>{formatFileSize(item.sizeBytes) || item.contentType || "文件"}</small>
              </span>
            </button>
            {onRemove ? (
              <IconButton
                icon={<X size={16} />}
                label={`移除 ${item.name}`}
                onClick={() => onRemove(item.id)}
                variant="muted"
              />
            ) : null}
          </div>
        );
      })}
      {previewOverlay}
    </div>
  );
}

function AttachmentFullscreenPreview({
  hasMultiple,
  item,
  onClose,
  onNext,
  onPrevious,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  position,
  url,
  zoom,
}: {
  hasMultiple: boolean;
  item: AttachmentItem;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  position: string;
  url: string;
  zoom: number;
}) {
  const image = isImage(item);
  return (
    <div className="biz-attachment-preview">
      <button
        aria-label="关闭预览"
        className="biz-attachment-preview__backdrop"
        onClick={onClose}
        type="button"
      />
      <header className="biz-attachment-preview__header">
        <div>
          <strong>{item.name}</strong>
          {hasMultiple ? <small>{position}</small> : null}
        </div>
        <div className="biz-attachment-preview__actions">
          {image ? (
            <>
              <IconButton
                icon={<ZoomOut size={17} />}
                label="缩小"
                onClick={onZoomOut}
                variant="muted"
              />
              <span>{Math.round(zoom * 100)}%</span>
              <IconButton
                icon={<ZoomIn size={17} />}
                label="放大"
                onClick={onZoomIn}
                variant="muted"
              />
              <IconButton
                icon={<RotateCcw size={17} />}
                label="重置缩放"
                onClick={onResetZoom}
                variant="muted"
              />
            </>
          ) : null}
          <IconButton icon={<X size={18} />} label="关闭预览" onClick={onClose} variant="muted" />
        </div>
      </header>
      <div className="biz-attachment-preview__body">
        {hasMultiple ? (
          <button
            aria-label="上一张附件"
            className="biz-attachment-preview__nav biz-attachment-preview__nav--previous"
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft size={24} />
          </button>
        ) : null}
        {image ? (
          <img alt={item.name} src={url} style={{ transform: `scale(${zoom})` }} />
        ) : isVideo(item) ? (
          <video controls playsInline src={url} />
        ) : (
          <iframe src={url} title={item.name} />
        )}
        {hasMultiple ? (
          <button
            aria-label="下一张附件"
            className="biz-attachment-preview__nav biz-attachment-preview__nav--next"
            onClick={onNext}
            type="button"
          >
            <ChevronRight size={24} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
