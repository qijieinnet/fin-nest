import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { AiScreen } from "./AiScreen";

export default function Page() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <AiScreen />
      </RequireLedger>
    </AuthGate>
  );
}
