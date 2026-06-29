import { AuthGate } from "@/components/auth/AuthGate";
import { RegisterScreen } from "./RegisterScreen";

export default function RegisterPage() {
  return (
    <AuthGate mode="guest">
      <RegisterScreen />
    </AuthGate>
  );
}
