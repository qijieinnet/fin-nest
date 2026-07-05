"use client";

import { useSearchParams } from "next/navigation";
import { NewBillFormScreen } from "../_components/NewBillFormScreen";

export function NewBillScreen() {
  const templateId = useSearchParams().get("template");
  return <NewBillFormScreen templateId={templateId} />;
}
