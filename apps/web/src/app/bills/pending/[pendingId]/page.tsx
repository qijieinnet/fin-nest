import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { BillDetailScreen } from "../../[transactionId]/BillDetailScreen";

export default async function PendingBillDetailPage({
  params,
}: {
  params: Promise<{ pendingId: string }>;
}) {
  const { pendingId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <BillDetailScreen pendingId={pendingId} />
      </RequireLedger>
    </AuthGate>
  );
}
