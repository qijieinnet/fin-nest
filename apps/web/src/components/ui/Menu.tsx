"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/format/class-names";
import { Surface } from "./Surface";

export type MenuItem = {
  /** 危险操作（红色），如「删除列表」。 */
  danger?: boolean;
  /** 标题下方的副标题，如「排序方式」下显示当前值「手动」。 */
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** 二级菜单：有值时点击进入子菜单（带返回行），忽略 onSelect。 */
  items?: MenuItem[];
  label: string;
  onSelect?: () => void;
  /** 选中态（表单选值场景），右侧显示对勾。 */
  selected?: boolean;
};

type MenuProps = {
  className?: string;
  /** 菜单项分组，组与组之间以粗分隔条隔开（同 iOS 上下文菜单）。 */
  groups: MenuItem[][];
  /** 选中叶子项后触发（用于收起弹层）。 */
  onClose?: () => void;
};

/** iOS 上下文菜单风格的列表面板，支持分组、副标题、二级菜单、选中态与危险项。 */
export function Menu({ className, groups, onClose }: MenuProps) {
  const [submenu, setSubmenu] = useState<MenuItem | null>(null);

  const renderItem = (item: MenuItem, index: number) => (
    <button
      className={cn("ui-menu__item", item.danger && "ui-menu__item--danger")}
      disabled={item.disabled}
      key={`${item.label}-${index}`}
      onClick={() => {
        if (item.items?.length) {
          setSubmenu(item);
          return;
        }
        item.onSelect?.();
        onClose?.();
      }}
      type="button"
    >
      {item.icon ? <span className="ui-menu__icon">{item.icon}</span> : null}
      <span className="ui-menu__copy">
        <span className="ui-menu__label">{item.label}</span>
        {item.description ? <span className="ui-menu__description">{item.description}</span> : null}
      </span>
      {item.items?.length ? (
        <ChevronRight className="ui-menu__trailing" size={16} />
      ) : item.selected ? (
        <Check className="ui-menu__trailing ui-menu__trailing--check" size={16} strokeWidth={2.6} />
      ) : null}
    </button>
  );

  return (
    <Surface className={cn("ui-menu", className)} variant="menu">
      {submenu ? (
        <>
          <div className="ui-menu__group">
            <button
              className="ui-menu__item ui-menu__item--back"
              onClick={() => setSubmenu(null)}
              type="button"
            >
              <span className="ui-menu__icon">
                <ChevronLeft size={17} />
              </span>
              <span className="ui-menu__copy">
                <span className="ui-menu__label">{submenu.label}</span>
              </span>
            </button>
          </div>
          <div className="ui-menu__group">{(submenu.items ?? []).map(renderItem)}</div>
        </>
      ) : (
        groups
          .filter((group) => group.length > 0)
          .map((group, index) => (
            <div className="ui-menu__group" key={index}>
              {group.map(renderItem)}
            </div>
          ))
      )}
    </Surface>
  );
}
