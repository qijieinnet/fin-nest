import { AuthGate } from "@/components/auth/AuthGate";
import { AgentTokensScreen } from "./AgentTokensScreen";

/** token 是用户级的（账本范围在 token 内选择），不需要 RequireLedger。 */
export default function AgentsPage() {
  return (
    <AuthGate mode="protected">
      <AgentTokensScreen />
    </AuthGate>
  );
}
