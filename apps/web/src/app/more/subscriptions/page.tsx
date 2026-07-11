import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { SubscriptionsScreen } from "./SubscriptionsScreen";

export default function SubscriptionsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <SubscriptionsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
