import { AuthGate } from "@/components/auth/AuthGate";
import { LedgersScreen } from "./LedgersScreen";

export default function LedgersPage() {
  return (
    <AuthGate mode="protected">
      <LedgersScreen />
    </AuthGate>
  );
}
