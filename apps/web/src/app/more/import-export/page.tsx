import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { ImportExportScreen } from "./ImportExportScreen";

export default function ImportExportPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <ImportExportScreen />
      </RequireLedger>
    </AuthGate>
  );
}
