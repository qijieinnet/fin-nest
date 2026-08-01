import { AuthGate } from "@/components/auth/AuthGate";
import { BackupScreen } from "./BackupScreen";

export default function BackupPage() {
  return (
    <AuthGate mode="protected">
      <BackupScreen />
    </AuthGate>
  );
}
