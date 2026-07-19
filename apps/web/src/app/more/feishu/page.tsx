import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { FeishuBindingScreen } from "./FeishuBindingScreen";

export default function FeishuPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <FeishuBindingScreen />
      </RequireLedger>
    </AuthGate>
  );
}
