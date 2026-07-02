import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { ItemsScreen } from "./ItemsScreen";

export default function ItemsPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <ItemsScreen />
      </RequireLedger>
    </AuthGate>
  );
}
