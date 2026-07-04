import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { EditPendingScreen } from "./EditPendingScreen";

export default async function EditPendingPage({
  params,
}: {
  params: Promise<{ pendingId: string }>;
}) {
  const { pendingId } = await params;
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <EditPendingScreen pendingId={pendingId} />
      </RequireLedger>
    </AuthGate>
  );
}
