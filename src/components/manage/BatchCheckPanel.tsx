import { useMutation } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { useState } from "react";

import { manageApi } from "@/api/manageApi";
import { EmptyBlock, ErrorBlock } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StockBatch } from "@/types/domain";
import { formatDate, formatNumber } from "@/utils/formatting";

import { BATCH_STATUS } from "./stockMeta";

const VERDICT: Record<StockBatch["status"], { title: string; className: string }> = {
  safe: { title: "Safe to dispense", className: "border-success/40 bg-success/10" },
  short_dated: { title: "Safe — short-dated, dispense first", className: "border-warning/40 bg-warning/10" },
  expired: { title: "EXPIRED — do not dispense", className: "border-destructive/50 bg-destructive/10" },
  quarantined: { title: "QUARANTINED — do not dispense", className: "border-destructive/50 bg-destructive/10" },
  empty: { title: "No stock recorded in this batch", className: "border-border bg-muted" },
};

/** "Is this pack safe to give?" — type or scan the batch number printed on the pack. */
export function BatchCheckPanel() {
  const [number, setNumber] = useState("");
  const lookup = useMutation({ mutationFn: (value: string) => manageApi.lookupBatch(value) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="h-4 w-4 text-primary" aria-hidden /> Check a pack before handing it over
        </CardTitle>
        <CardDescription>
          Enter (or scan) the batch number printed on the pack. The system checks its expiry date and quarantine status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="flex max-w-lg gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (number.trim()) lookup.mutate(number.trim());
          }}
        >
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Batch number, e.g. AMX-2409"
            aria-label="Batch number"
            className="font-mono"
            autoFocus
          />
          <Button type="submit" disabled={!number.trim() || lookup.isPending}>
            {lookup.isPending ? "Checking…" : "Check"}
          </Button>
        </form>

        {lookup.isError ? <ErrorBlock error={lookup.error} /> : null}
        {lookup.data && lookup.data.matches.length === 0 ? (
          <EmptyBlock
            title={`Batch ${lookup.data.number} is not on record`}
            detail="Do not dispense an unrecorded pack. Check the number, or receive the batch first."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {lookup.data?.matches.map((batch) => {
            const verdict = VERDICT[batch.status];
            const Icon = BATCH_STATUS[batch.status].icon;
            return (
              <div key={batch.id} className={cn("rounded-xl border-2 p-5", verdict.className)} role="status">
                <p className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Icon className="h-5 w-5" aria-hidden /> {verdict.title}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Medicine</dt>
                  <dd className="font-medium">
                    {batch.medicineName} {batch.strength}
                  </dd>
                  <dt className="text-muted-foreground">Batch</dt>
                  <dd className="font-mono">{batch.batchNumber}</dd>
                  <dt className="text-muted-foreground">Expiry date</dt>
                  <dd>
                    {formatDate(batch.expiryDate)}{" "}
                    <span className="text-muted-foreground">
                      (
                      {batch.daysToExpiry > 0
                        ? `${batch.daysToExpiry} days left`
                        : batch.daysToExpiry === 0
                          ? "expires today"
                          : `${-batch.daysToExpiry} days ago`}
                      )
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">Units in batch</dt>
                  <dd className="tabular-nums">{formatNumber(batch.quantity)}</dd>
                  <dt className="text-muted-foreground">Supplier</dt>
                  <dd>{batch.supplierName ?? "—"}</dd>
                  <dt className="text-muted-foreground">Checked as of</dt>
                  <dd>{formatDate(lookup.data!.asOf)}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
