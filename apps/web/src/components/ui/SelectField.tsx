"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, List } from "lucide-react";
import { cn } from "@/lib/format/class-names";

type SelectFieldOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  className?: string;
  clearLabel?: string;
  clearable?: boolean;
  icon?: ReactNode;
  label: string;
  menuWidth?: "default" | "trigger";
  onValueChange: (value: string) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  value: string;
};

export function SelectField({
  className,
  clearLabel = "清除选项",
  clearable = false,
  icon = <List size={24} />,
  label,
  menuWidth = "default",
  onValueChange,
  options,
  placeholder = "请选择",
  value,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
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

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    function updateMenuPosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = menuWidth === "trigger" ? 6 : -12;
      const width = menuWidth === "trigger" ? rect.width : rect.width * 0.68;
      const left = menuWidth === "trigger" ? rect.left : rect.left + rect.width * 0.28;
      setMenuStyle({
        left: Math.min(Math.max(12, left), window.innerWidth - width - 12),
        top: rect.bottom + gap,
        width,
      });
    }

    function closeOnScroll() {
      setOpen(false);
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [menuWidth, open]);

  const hasValue = value !== "";

  return (
    <div className={cn("select-field", className)} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="listbox"
        className="select-field__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="select-field__icon">{icon}</span>
        <span className="select-field__label">{label}</span>
        <span className="select-field__value">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className={cn("select-field__chevron", open && "select-field__chevron--open")} size={20} />
      </button>

      {open && menuStyle
        ? createPortal(
            <div className={cn("select-field__menu", className && `${className}__menu`)} id={menuId} ref={menuRef} role="listbox" style={menuStyle}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                aria-selected={selected}
                className="select-field__option"
                key={option.value}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
              </button>
            );
          })}
          {clearable && hasValue ? (
            <>
              <span className="select-field__divider" />
              <button
                className="select-field__option select-field__option--clear"
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                }}
                type="button"
              >
                <span>{clearLabel}</span>
              </button>
            </>
          ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
