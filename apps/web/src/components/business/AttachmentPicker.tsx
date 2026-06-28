"use client";

import { Paperclip, Plus } from "lucide-react";
import { Switch } from "@/components/ui";
import type { AttachmentItem } from "./business-types";
import { AttachmentPreview } from "./AttachmentPreview";

type AttachmentPickerProps = {
  accept?: string;
  enabled?: boolean;
  items: AttachmentItem[];
  onEnabledChange?: (enabled: boolean) => void;
  onFilesSelected: (files: File[]) => void;
  onOpen?: (item: AttachmentItem) => void;
  onRemove?: (id: string) => void;
};

export function AttachmentPicker({
  accept = "image/*,application/pdf",
  enabled,
  items,
  onEnabledChange,
  onFilesSelected,
  onOpen,
  onRemove,
}: AttachmentPickerProps) {
  const active = enabled ?? items.length > 0;

  return (
    <div className="biz-attachment-card">
      <div className="biz-toggle-card__header">
        <span className="biz-toggle-card__copy">
          <strong>附件</strong>
          <small>{active ? "上传票据、截图或凭证" : "关闭后不显示附件区域"}</small>
        </span>
        <Switch checked={active} disabled={!onEnabledChange} label="附件" onCheckedChange={onEnabledChange} />
      </div>
      {active ? (
        <div className="biz-attachment-card__body">
          <AttachmentPreview items={items} onOpen={onOpen} onRemove={onRemove} variant="grid" />
        <label className="biz-file-button">
          <input
            accept={accept}
            multiple
            onChange={(event) => {
              onFilesSelected(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <span className="ui-button ui-button--secondary">
            <span className="ui-button__icon">
              <Plus size={16} />
            </span>
            添加
          </span>
        </label>
        </div>
      ) : (
        <span className="biz-attachment-card__off">
          <Paperclip size={16} />
          未开启附件
        </span>
      )}
    </div>
  );
}
