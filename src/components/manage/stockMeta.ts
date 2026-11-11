import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, Clock, PackageX, ShieldAlert } from "lucide-react";

import type { BatchStatus } from "@/types/domain";

export const BATCH_STATUS: Record<
  BatchStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral"; icon: typeof CheckCircle2 }
> = {
  safe: { label: "Safe", tone: "success", icon: CheckCircle2 },
  short_dated: { label: "Short-dated", tone: "warning", icon: Clock },
  expired: { label: "Expired", tone: "danger", icon: AlertOctagon },
  quarantined: { label: "Quarantined", tone: "danger", icon: ShieldAlert },
  empty: { label: "Empty", tone: "neutral", icon: PackageX },
};

/** Every screen that shows stock re-reads it after a change anywhere. */
export function useRefreshStock() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      [["batches"], ["catalogue"], ["inventory"], ["expiry"], ["dashboard"], ["recommendations"], ["lab"]].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    );
}

