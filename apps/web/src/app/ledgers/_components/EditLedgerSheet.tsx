"use client";

import type { Ledger } from "@/lib/api";
import { CreateLedgerSheet } from "./CreateLedgerSheet";

export function EditLedgerSheet({ ledger }: { ledger: Ledger }) {
  return <CreateLedgerSheet ledger={ledger} />;
}
