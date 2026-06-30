import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { AutoScreen } from "./AutoScreen";

export default function AutoAccountingPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <AutoScreen />
      </RequireLedger>
    </AuthGate>
  );
}
