import { AuthGate } from "@/components/auth/AuthGate";
import { SystemSettingsScreen } from "./SystemSettingsScreen";

export default function SystemSettingsPage() {
  return (
    <AuthGate mode="protected">
      <SystemSettingsScreen />
    </AuthGate>
  );
}
