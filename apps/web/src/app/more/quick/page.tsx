import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { QuickTemplatesScreen } from "./QuickTemplatesScreen";

export default function QuickTemplatesPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <QuickTemplatesScreen />
      </RequireLedger>
    </AuthGate>
  );
}
