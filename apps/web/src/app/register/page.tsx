import type { Viewport } from "next";
import { AuthGate } from "@/components/auth/AuthGate";
import { RegisterScreen } from "./RegisterScreen";

export const viewport: Viewport = {
  themeColor: "#eef3fb",
};

export default function RegisterPage() {
  return (
    <AuthGate mode="guest">
      <RegisterScreen />
    </AuthGate>
  );
}
