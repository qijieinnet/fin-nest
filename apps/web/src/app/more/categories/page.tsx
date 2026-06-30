import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { CategoriesScreen } from "./CategoriesScreen";

export default function CategoriesPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <CategoriesScreen />
      </RequireLedger>
    </AuthGate>
  );
}
