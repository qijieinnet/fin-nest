import type { Viewport } from "next";
import { AuthGate } from "@/components/auth/AuthGate";
import { LoginScreen } from "./LoginScreen";

export const viewport: Viewport = {
  themeColor: "#eef3fb",
};

export default function LoginPage() {
  return (
    <AuthGate mode="guest">
      <LoginScreen />
    </AuthGate>
  );
}
