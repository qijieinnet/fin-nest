import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { PlansScreen } from "./PlansScreen";

export default function BudgetPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <PlansScreen />
      </RequireLedger>
    </AuthGate>
  );
}
