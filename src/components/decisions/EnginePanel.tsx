import { useMutation, useQuery } from "@tanstack/react-query";
import { Cpu, PackageMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { labApi } from "@/api/labApi";
import { recommendationApi } from "@/api/recommendationApi";
import { Pill } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DecisionAction, DecisionRun } from "@/types/domain";
import { formatDate, formatNumber } from "@/utils/formatting";

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function ActionPill({ action }: { action: DecisionAction }) {
  if (action === "order") return <Pill tone="danger">Order</Pill>;
  if (action === "expedite") return <Pill tone="warning">Expedite open order</Pill>;
  return <Pill tone="success">No action</Pill>;
}

/**
 * Runs the combined decision engine (Models 3 → 1 → policy → 4 → 2) for every medicine
 * and offers a what-if: dispense stock, then re-run and watch the decisions change.
 */
export function EnginePanel({ canDispense, onRan }: { canDispense: boolean; onRan: () => void }) {
  const [run, setRun] = useState<DecisionRun | null>(null);
  const [medicine, setMedicine] = useState("1");
  const [quantity, setQuantity] = useState("2000");
  const medicines = useQuery({
    queryKey: ["lab", "medicines"],
    queryFn: labApi.medicines,
    staleTime: 60_000,
  });

  const engine = useMutation({
    mutationFn: () => recommendationApi.runEngine(),
    onSuccess: (data) => {
      setRun(data);
      onRan();
      toast.success(`Checked ${data.checked} medicines`, {
        description: `${data.reorder} need an order · ${(data.durationMs / 1000).toFixed(1)} s`,
      });
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
    },
  });

  const dispense = useMutation({
    mutationFn: () => recommendationApi.dispense(Number(medicine), Number(quantity)),
    onSuccess: (data) => {
      toast.success(`Dispensed ${formatNumber(Number(quantity))} units of ${data.medicineName}`, {
        description: `${formatNumber(data.stockLeft)} units left. Re-running the decision engine…`,
      });
      engine.mutate();
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
    },
  });

  const rows = (run?.results ?? [])
    .slice()
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        b.stockoutProbability - a.stockoutProbability,
    );
  const expedite = rows.filter((r) => r.action === "expedite").length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="max-w-2xl">
          <CardTitle className="text-base">Decision engine</CardTitle>
          <CardDescription>
            For every medicine: score suppliers (Model 3), forecast demand over the lead time (Model
            1), set the reorder point, remove stock that will expire (Model 4), estimate stockout
            risk (Model 2), then decide.
          </CardDescription>
        </div>
        <Button onClick={() => engine.mutate()} disabled={engine.isPending}>
          <Cpu className="h-4 w-4" /> {engine.isPending ? "Running models…" : "Run decision engine"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {canDispense ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3">
            <div className="space-y-1">
              <Label className="text-xs">What-if: dispense stock</Label>
              <Select value={medicine} onValueChange={setMedicine}>
                <SelectTrigger className="h-9 w-72">
                  <SelectValue placeholder="Medicine" />
                </SelectTrigger>
                <SelectContent>
                  {(medicines.data ?? [])
                    .slice()
                    .sort((a, b) => a.modelId - b.modelId)
                    .map((m) => (
                      <SelectItem key={m.modelId} value={String(m.modelId)}>
                        {m.name} {m.strength} ({formatNumber(m.stock)} in stock)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="whatif-qty" className="text-xs">
                Units
              </Label>
              <Input
                id="whatif-qty"
                type="number"
                min={1}
                className="h-9 w-28"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => dispense.mutate()}
              disabled={dispense.isPending || engine.isPending || !Number(quantity)}
            >
              <PackageMinus className="h-4 w-4" /> Dispense, then re-run
            </Button>
            <p className="text-xs text-muted-foreground">
              Changes real stock in the demo database. Restore it with{" "}
              <code>import_datasets --reset</code>.
            </p>
          </div>
        ) : null}

        {run ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Pill tone="info">As at {formatDate(run.asOf)}</Pill>
              <Pill>{run.checked} medicines checked</Pill>
              <Pill tone="danger">{run.reorder} new orders</Pill>
              {expedite ? <Pill tone="warning">{expedite} to expedite</Pill> : null}
              <Pill>{(run.durationMs / 1000).toFixed(1)} s</Pill>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicine</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Usable + on order</TableHead>
                    <TableHead className="text-right">Reorder point</TableHead>
                    <TableHead className="text-right">Stockout risk</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Supplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.modelId} title={r.rationale}>
                      <TableCell className="font-medium">
                        {r.medicineName} {r.strength}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(r.currentStock)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(r.usableStock + r.onOrder)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(r.reorderPoint)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          r.stockoutProbability >= 0.5 && "font-semibold text-destructive",
                        )}
                      >
                        {(r.stockoutProbability * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell>
                        <ActionPill action={r.action} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.quantity ? formatNumber(r.quantity) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.supplierName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Assumptions: {run.assumptions["serviceLevel"]}% service level (z ={" "}
              {run.assumptions["z"]}), lead time + {run.assumptions["leadTimeBufferDays"]} buffer
              days, {run.assumptions["reviewPeriodDays"]}-day review period, ordering cost USD{" "}
              {run.assumptions["orderingCostUsd"]}, holding cost{" "}
              {(Number(run.assumptions["holdingRate"]) * 100).toFixed(0)}% a year, maximum{" "}
              {run.assumptions["maxCoverDays"]} days of cover per order.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the engine to check every medicine and refresh the recommendations below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
