import { AuthGate } from "@/components/auth/AuthGate";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";

export default function NotificationsPage() {
  return (
    <AuthGate mode="protected">
      <NotificationSettingsScreen />
    </AuthGate>
  );
}
