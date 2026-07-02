import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { StatsScreen } from "./StatsScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <StatsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
