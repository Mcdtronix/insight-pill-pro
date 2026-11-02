import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { inventoryApi } from "@/api/inventoryApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { RiskBadge } from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExpiryRisk } from "@/types/domain";
import { formatCurrency, formatDate, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/expiry")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Expiry Risk — Pharma DSS" },
      {
        name: "description",
        content: "Batches at risk of expiring before they can be dispensed, with the value at stake.",
      },
      { property: "og:title", content: "Expiry Risk — Pharma DSS" },
      {
        property: "og:description",
        content: "Batches at risk of expiring before they can be dispensed, with the value at stake.",
      },
    ],
  }),
  component: ExpiryPage,
});

const WINDOWS = [30, 60, 90, 180, 365];

function ExpiryPage() {
  const batches = useQuery({ queryKey: ["expiry-risk"], queryFn: inventoryApi.expiryRisk });
  const [risk, setRisk] = useState<ExpiryRisk | "all">("all");
  const [windowDays, setWindowDays] = useState(180);
  const [term, setTerm] = useState("");

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (batches.data ?? [])
      .filter((batch) => (risk === "all" || batch.risk === risk) && batch.daysRemaining <= windowDays)
      .filter((batch) => !needle || `${batch.medicineName} ${batch.batchNumber}`.toLowerCase().includes(needle))
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [batches.data, risk, windowDays, term]);

  const exposure = rows.reduce((sum, batch) => sum + batch.potentialLossValue, 0);
  const unitsAtRisk = rows.reduce((sum, batch) => sum + batch.projectedUnusedUnits, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Action layer"
        title="Expiry Risk"
        description="Batches whose remaining shelf life is shorter than the time needed to dispense them, ranked by the money at stake."
        actions={<DecisionChain active="action" />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary
          label={`Batches at risk (of ${formatNumber(rows.length)} expiring in window)`}
          value={formatNumber(rows.filter((batch) => batch.projectedUnusedUnits > 0).length)}
        />
        <Summary label="Units likely unused" value={formatNumber(unitsAtRisk)} />
        <Summary label="Value exposed" value={formatCurrency(exposure, 0)} tone />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-3">
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search medicine or batch number"
              className="max-w-xs"
              aria-label="Search expiry batches"
            />
            <Select value={risk} onValueChange={(value) => setRisk(value as ExpiryRisk | "all")}>
              <SelectTrigger className="w-44" aria-label="Filter by risk level">
                <SelectValue placeholder="Risk level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk levels</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(windowDays)} onValueChange={(value) => setWindowDays(Number(value))}>
              <SelectTrigger className="w-48" aria-label="Expiry window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    Expiring within {days} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {batches.isPending ? (
            <LoadingBlock rows={6} label="Loading expiry risk" />
          ) : batches.isError ? (
            <ErrorBlock error={batches.error} onRetry={() => batches.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyBlock
              title="No batches at risk in this window"
              detail="Every batch is expected to be dispensed before its expiry date."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicine</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Days left</TableHead>
                    <TableHead className="text-right">Daily use</TableHead>
                    <TableHead className="text-right">Projected unused</TableHead>
                    <TableHead className="text-right">Potential loss</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Recommended action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{batch.medicineName}</span>
                        <span className="block text-xs text-muted-foreground">{batch.strength}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {batch.batchNumber}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(batch.quantity)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(batch.expiryDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{batch.daysRemaining}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatNumber(batch.dailyConsumption)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(batch.projectedUnusedUnits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(batch.potentialLossValue, 0)}
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={batch.risk} />
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {batch.recommendation}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold ${tone ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
