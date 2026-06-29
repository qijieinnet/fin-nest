import { AuthGate } from "@/components/auth/AuthGate";
import { LoginScreen } from "./LoginScreen";

export default function LoginPage() {
  return (
    <AuthGate mode="guest">
      <LoginScreen />
    </AuthGate>
  );
}
