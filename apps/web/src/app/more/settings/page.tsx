import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { RecordSettingsScreen } from "./RecordSettingsScreen";

export default function RecordSettingsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <RecordSettingsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
