import { AuthGate } from "@/components/auth/AuthGate";
import { JoinLedgerScreen } from "./JoinLedgerScreen";

export default function JoinLedgerPage() {
  return (
    <AuthGate mode="protected">
      <JoinLedgerScreen />
    </AuthGate>
  );
}
