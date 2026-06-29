import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { BillsScreen } from "./BillsScreen";

export default function BillsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <BillsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
