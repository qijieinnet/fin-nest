import { Suspense } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { NewBillScreen } from "./NewBillScreen";

export default function NewBillPage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <Suspense>
          <NewBillScreen />
        </Suspense>
      </RequireLedger>
    </AuthGate>
  );
}
