"use client";

import { useId, useState } from "react";
import { CircleHelp } from "lucide-react";

type InlineHintProps = {
  text: string;
};

export function InlineHint({ text }: InlineHintProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="biz-inline-hint" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        aria-controls={open ? tooltipId : undefined}
        aria-expanded={open}
        aria-label="查看说明"
        className="biz-inline-hint__trigger"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <CircleHelp size={16} />
      </button>
      {open ? (
        <span className="biz-inline-hint__bubble" id={tooltipId} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}
