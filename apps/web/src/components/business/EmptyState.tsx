import type { ReactNode } from "react";

type EmptyStateProps = {
  action?: ReactNode;
  icon?: ReactNode;
  message?: string;
  title: string;
};

export function EmptyState({ action, icon, message, title }: EmptyStateProps) {
  return (
    <div className="biz-empty">
      {icon ? <span className="biz-empty__icon">{icon}</span> : null}
      <strong>{title}</strong>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

