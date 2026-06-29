import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { MoreScreen } from "./MoreScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <MoreScreen />
      </RequireLedger>
    </AuthGate>
  );
}
