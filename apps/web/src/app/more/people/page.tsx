import { AuthGate } from "@/components/auth/AuthGate";
import { RequireLedger } from "@/components/auth/RequireLedger";
import { PeopleScreen } from "./PeopleScreen";

export default function PeoplePage() {
  return (
    <AuthGate mode="protected">
      <RequireLedger>
        <PeopleScreen />
      </RequireLedger>
    </AuthGate>
  );
}
