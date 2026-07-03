import { AuthGate } from "@/components/auth/AuthGate";
import { AdminScreen } from "./AdminScreen";

export default function AdminPage() {
  return (
    <AuthGate mode="protected">
      <AdminScreen />
    </AuthGate>
  );
}
