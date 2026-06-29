import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { EditBillScreen } from "./EditBillScreen";

export default async function EditBillPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <EditBillScreen transactionId={transactionId} />
      </RequireLedger>
    </AuthGate>
  );
}
