import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { ComingSoonScreen } from "@/components/app/ComingSoonScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <ComingSoonScreen subtitle="支出限额、收入目标、周期计划将在 F6 上线。" title="计划" />
      </RequireLedger>
    </AuthGate>
  );
}
