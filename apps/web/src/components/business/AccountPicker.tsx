"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, WalletCards } from "lucide-react";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption } from "./business-types";

type AccountPickerProps = {
  label?: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  value: string | null;
};

export function AccountPicker({ label = "账户", onValueChange, options, value }: AccountPickerProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.id === value);
  const primaryOptions = useMemo(() => options.filter((option) => !option.parentId), [options]);
  const selectedParent = selectedOption?.parentId
    ? options.find((option) => option.id === selectedOption.parentId)
    : selectedOption;
  const [expandedId, setExpandedId] = useState<string | null>(selectedParent?.id ?? primaryOptions[0]?.id ?? null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setExpandedId(selectedParent?.id ?? primaryOptions[0]?.id ?? null);
    }
  }, [open, primaryOptions, selectedParent?.id]);

  return (
    <div className="select-field account-select-field" ref={containerRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="select-field__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="select-field__icon">
          <WalletCards size={20} />
        </span>
        <span className="select-field__label">{label}</span>
        <span className="select-field__value">{selectedOption?.label ?? "选择账户"}</span>
        <ChevronDown className={cn("select-field__chevron", open && "select-field__chevron--open")} size={20} />
      </button>

      {open ? (
        <div className="select-field__menu account-select-menu" id={menuId} role="listbox">
          {primaryOptions.map((option) => {
            const children = options.filter((child) => child.parentId === option.id);
            const hasChildren = children.length > 0;
            const selected = option.id === value;
            const expanded = expandedId === option.id;
            return (
              <div className="account-select-menu__group" key={option.id}>
                <button
                  aria-expanded={hasChildren ? expanded : undefined}
                  aria-selected={selected}
                  className="select-field__option account-select-menu__option"
                  disabled={option.disabled}
                  onClick={() => {
                    if (hasChildren) {
                      setExpandedId(expanded ? null : option.id);
                      return;
                    }
                    onValueChange(option.id);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  {hasChildren ? <ChevronRight className={cn(expanded && "account-select-menu__chevron--open")} size={16} /> : null}
                </button>
                {hasChildren && expanded ? (
                  <div className="account-select-menu__children">
                    {children.map((child) => {
                      const childSelected = child.id === value;
                      return (
                        <button
                          aria-selected={childSelected}
                          className="select-field__option account-select-menu__option account-select-menu__option--child"
                          disabled={child.disabled}
                          key={child.id}
                          onClick={() => {
                            onValueChange(child.id);
                            setOpen(false);
                          }}
                          role="option"
                          type="button"
                        >
                          <span>{child.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          {value ? (
            <>
              <span className="select-field__divider" />
              <button
                className="select-field__option select-field__option--clear"
                onClick={() => {
                  onValueChange(null);
                  setOpen(false);
                }}
                type="button"
              >
                <span>清除选项</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
