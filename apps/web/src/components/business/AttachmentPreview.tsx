"use client";

import { FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import type { AttachmentItem } from "./business-types";

function formatFileSize(sizeBytes?: number): string {
  if (!sizeBytes) return "";
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AttachmentPreviewProps = {
  items: AttachmentItem[];
  onOpen?: (item: AttachmentItem) => void;
  onRemove?: (id: string) => void;
  variant?: "list" | "grid";
};

export function AttachmentPreview({ items, onOpen, onRemove, variant = "list" }: AttachmentPreviewProps) {
  if (items.length === 0) {
    return <p className="biz-muted">暂无附件</p>;
  }

  if (variant === "grid") {
    return (
      <div className="biz-attachment-grid">
        {items.map((item) => {
          const isImage = item.contentType?.startsWith("image/");
          return (
            <div className="biz-attachment-tile" key={item.id}>
              <button aria-label={`打开 ${item.name}`} onClick={() => onOpen?.(item)} type="button">
                {isImage && item.url ? <img alt="" src={item.url} /> : <Paperclip size={20} />}
              </button>
              {onRemove ? (
                <button aria-label={`移除 ${item.name}`} onClick={() => onRemove(item.id)} type="button">
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="biz-attachment-list">
      {items.map((item) => {
        const isImage = item.contentType?.startsWith("image/");
        const isPdf = item.contentType === "application/pdf";
        return (
          <div className="biz-attachment" key={item.id}>
            <button
              className="biz-attachment__open"
              onClick={() => onOpen?.(item)}
              type="button"
            >
              <span className="biz-attachment__thumb">
                {isImage && item.url ? (
                  <img alt="" src={item.url} />
                ) : isImage ? (
                  <ImageIcon size={18} />
                ) : isPdf ? (
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
              <IconButton icon={<X size={16} />} label={`移除 ${item.name}`} onClick={() => onRemove(item.id)} variant="muted" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
