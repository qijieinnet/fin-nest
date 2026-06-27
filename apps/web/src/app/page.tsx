import { APP_NAME } from "@fin-nest/shared";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="mt-2 text-sm text-zinc-500">脚手架就绪，业务页面在 F3 起逐步实现。</p>
      </div>
    </main>
  );
}
