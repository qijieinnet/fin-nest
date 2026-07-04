import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { PendingBillsScreen } from "./PendingBillsScreen";

export default function PendingBillsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <PendingBillsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
