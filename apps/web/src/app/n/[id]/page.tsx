import { AuthGate } from "@/components/auth/AuthGate";
import { NotificationLandingScreen } from "./NotificationLandingScreen";

/**
 * 推送通知的落地页。
 *
 * 刻意**不套 RequireLedger**：推送可能来自当前未选中的那个账本，逼用户先切账本才能
 * 处理一条提醒毫无道理。接口本身按 notification.ledgerId 校验成员身份。
 */
export default async function NotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthGate mode="protected">
      <NotificationLandingScreen notificationId={id} />
    </AuthGate>
  );
}
