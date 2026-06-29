import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { BillDetailScreen } from "./BillDetailScreen";

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <BillDetailScreen transactionId={transactionId} />
      </RequireLedger>
    </AuthGate>
  );
}
