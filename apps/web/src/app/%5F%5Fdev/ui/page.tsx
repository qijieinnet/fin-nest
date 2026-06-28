import { notFound } from "next/navigation";
import { publicEnv } from "@/lib/config/public-env";
import { DevUiScreen } from "./DevUiScreen";

export default function DevUiPage() {
  if (!publicEnv.enableDevUi) {
    notFound();
  }

  return <DevUiScreen />;
}
