import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { ComingSoonScreen } from "@/components/app/ComingSoonScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <ComingSoonScreen subtitle="统计分析页将在 F6 上线，可从「更多」进入。" title="统计" />
      </RequireLedger>
    </AuthGate>
  );
}
