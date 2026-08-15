"use client";

import { useEffect, useRef } from "react";

type NotePanelProps = {
  maxLength: number;
  onValueChange: (value: string) => void;
  value: string;
};

/**
 * 备注面板：键盘里唯一需要系统键盘的页签。
 * 键盘整体会被抬到系统键盘之上（见 AmountKeypad 的 visualViewport 位移），
 * 两套键盘才能同屏共存——这也是备注此前没进键盘的原因。
 */
export function NotePanel({ maxLength, onValueChange, value }: NotePanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 挂载即聚焦：点「备注」页签就是要打字，不该再点一次输入框。
  // 面板只在自己是当前页签时挂载，所以这里等价于「切到备注页签时聚焦」。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="keypad-note">
      <textarea
        aria-label="备注"
        // input-flat：聚焦不画全局焦点环，输入框自己的背景已经足够指示焦点。
        className="keypad-note__input input-flat"
        maxLength={maxLength}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="添加备注"
        ref={inputRef}
        rows={2}
        value={value}
      />
      <span className="keypad-note__count">
        {value.length}/{maxLength}
      </span>
    </div>
  );
}
