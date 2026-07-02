import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { AccountDetailScreen } from "./AccountDetailScreen";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <AccountDetailScreen accountId={accountId} />
      </RequireLedger>
    </AuthGate>
  );
}
