import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { InsurancesScreen } from "./InsurancesScreen";

export default function InsurancesPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <InsurancesScreen />
      </RequireLedger>
    </AuthGate>
  );
}
