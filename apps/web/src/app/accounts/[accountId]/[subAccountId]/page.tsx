import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { SubAccountDetailScreen } from "./SubAccountDetailScreen";

export default async function SubAccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string; subAccountId: string }>;
}) {
  const { accountId, subAccountId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <SubAccountDetailScreen accountId={accountId} subAccountId={subAccountId} />
      </RequireLedger>
    </AuthGate>
  );
}
