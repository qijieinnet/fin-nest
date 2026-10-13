import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { FxRatesScreen } from "./FxRatesScreen";

export default function FxRatesPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <FxRatesScreen />
      </RequireLedger>
    </AuthGate>
  );
}
