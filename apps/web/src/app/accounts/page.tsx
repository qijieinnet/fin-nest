import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { ComingSoonScreen } from "@/components/app/ComingSoonScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <ComingSoonScreen subtitle="账户与净资产页将在 F5 上线。" title="账户" />
      </RequireLedger>
    </AuthGate>
  );
}
