import { APP_NAME } from "@fin-nest/shared";
import { MobileAppShell, MobilePage } from "@/components/ui";

export default function HomePage() {
  return (
    <MobileAppShell>
      <MobilePage title={APP_NAME} description="移动端应用骨架就绪，业务页面在 F3 起逐步实现。">
        <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            F0 已提供移动端容器、safe area、设计 token、API client、OpenAPI 类型生成入口和 PWA
            manifest。
          </p>
        </section>
      </MobilePage>
    </MobileAppShell>
  );
}
