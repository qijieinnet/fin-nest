import { AuthGate } from "@/components/auth/AuthGate";
import { UsersScreen } from "./UsersScreen";

export default function UsersPage() {
  return (
    <AuthGate mode="protected">
      <UsersScreen />
    </AuthGate>
  );
}
