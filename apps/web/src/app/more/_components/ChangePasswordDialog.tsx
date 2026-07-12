"use client";

import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Surface } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, getApiErrorMessage } from "@/lib/api";
import { useToast } from "@/providers";

type ChangePasswordDialogProps = {
  onClose: () => void;
  open: boolean;
};

/** 密码长度限制需与后端 ChangePasswordDto 的 @Length(8, 128) 保持一致。 */
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/** 修改密码弹窗：当前密码 + 新密码 + 确认，样式沿用系统 Surface/Input/Button 主题。 */
export function ChangePasswordDialog({ onClose, open }: ChangePasswordDialogProps) {
  const { showToast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<void>(API_ENDPOINTS.password, {
        method: "PATCH",
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      showToast({ message: "密码已更新", tone: "success", title: "修改成功" });
      onClose();
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  // 关闭后重置表单，避免下次打开残留旧输入。
  // 依赖 mutation.reset（引用稳定），不要依赖整个 mutation 对象——它每次渲染都是新引用，会导致无限循环。
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (open) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFormError(null);
    resetMutation();
  }, [open, resetMutation]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !mutation.isPending) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, mutation.isPending]);

  if (!mounted || !open) return null;

  const handleSubmit = () => {
    if (mutation.isPending) return;
    if (newPassword.length < MIN_LENGTH) {
      setFormError(`新密码至少 ${MIN_LENGTH} 位`);
      return;
    }
    if (newPassword.length > MAX_LENGTH) {
      setFormError(`新密码不超过 ${MAX_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === currentPassword) {
      setFormError("新密码不能与当前密码相同");
      return;
    }
    setFormError(null);
    mutation.mutate();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        aria-label="取消修改密码"
        className="absolute inset-0 bg-black/20 backdrop-blur-[12px]"
        disabled={mutation.isPending}
        onClick={onClose}
        type="button"
      />
      <Surface
        className="w-full max-w-[360px] rounded-[28px] border-white/75 bg-white/70 p-5 shadow-[0_28px_80px_rgba(18,24,38,0.22)]"
        variant="panel"
      >
        <form
          className="relative z-[1] flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-tint-soft)] text-[var(--color-tint)]">
              <KeyRound size={24} strokeWidth={2.2} />
            </span>
            <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">修改密码</h2>
            <p className="mt-1.5 text-sm leading-6 text-[var(--color-text-secondary)]">
              修改后其他设备的登录将被退出，需重新登录。
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <Input
              autoComplete="current-password"
              autoFocus
              label="当前密码"
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="请输入当前密码"
              type="password"
              value={currentPassword}
            />
            <Input
              autoComplete="new-password"
              label="新密码"
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={`至少 ${MIN_LENGTH} 位`}
              type="password"
              value={newPassword}
            />
            <Input
              autoComplete="new-password"
              label="确认新密码"
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="再次输入新密码"
              type="password"
              value={confirmPassword}
            />
          </div>

          {formError ? (
            <p className="mt-3 text-center text-xs text-[var(--color-accent-expense)]">{formError}</p>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button
              className="w-full justify-center"
              disabled={mutation.isPending}
              onClick={onClose}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              className="w-full justify-center"
              disabled={
                mutation.isPending ||
                currentPassword.length === 0 ||
                newPassword.length === 0 ||
                confirmPassword.length === 0
              }
              loading={mutation.isPending}
              type="submit"
              variant="primary"
            >
              {mutation.isPending ? "提交中…" : "确认修改"}
            </Button>
          </div>
        </form>
      </Surface>
    </div>,
    document.body,
  );
}
