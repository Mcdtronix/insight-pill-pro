import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, PackageMinus, ScanSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { manageApi } from "@/api/manageApi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DispensePlan } from "@/types/domain";
import { formatDate, formatNumber } from "@/utils/formatting";

import { BatchStatusPill, Field, NativeSelect } from "./shared";
import { useRefreshStock } from "./stockMeta";

/**
 * Dispense to a patient in two steps: CHECK shows exactly which batches will be used
 * (earliest expiry first) and what is held back as expired or quarantined; CONFIRM
 * records it. The backend applies the same rules again, so nothing unsafe can slip through.
 */
export function DispensePanel({ canDispense }: { canDispense: boolean }) {
  const medicines = useQuery({ queryKey: ["catalogue", "medicines"], queryFn: manageApi.medicines });
  const refresh = useRefreshStock();
  const [medicineId, setMedicineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [plan, setPlan] = useState<DispensePlan | null>(null);

  const active = (medicines.data ?? []).filter((m) => m.active);
  const qty = Number(quantity);
  const valid = medicineId !== "" && Number.isInteger(qty) && qty > 0;

  const check = useMutation({
    mutationFn: () => manageApi.previewDispense(medicineId, qty),
    onSuccess: setPlan,
    onError: (error) => toast.error(describeError(error).title, { description: describeError(error).detail }),
  });

  const dispense = useMutation({
    mutationFn: () => manageApi.dispense(medicineId, qty, reference.trim() || undefined),
    onSuccess: async (result) => {
      toast.success(`Dispensed ${formatNumber(result.dispensed ?? qty)} units of ${result.medicineName}`, {
        description: `From batch ${result.lines.map((l) => l.batchNumber).join(", ")}. ${formatNumber(
          result.stockLeft ?? 0,
        )} safe units left.`,
      });
      setPlan(null);
      setQuantity("");
      setReference("");
      await refresh();
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
      check.mutate();
    },
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageMinus className="h-4 w-4 text-primary" aria-hidden /> Dispense to a patient
          </CardTitle>
          <CardDescription>
            Check first. Expired and quarantined batches are never used; the earliest safe expiry goes out first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) check.mutate();
            }}
          >
            <Field label="Medicine" htmlFor="dispense-medicine">
              <NativeSelect
                id="dispense-medicine"
                value={medicineId}
                onChange={(value) => {
                  setMedicineId(value);
                  setPlan(null);
                }}
                required
              >
                <option value="">{medicines.isPending ? "Loading…" : "Choose a medicine"}</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.strength} — {formatNumber(m.dispensable)} safe
                    {m.expiredUnits ? `, ${formatNumber(m.expiredUnits)} expired` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Quantity (units)" htmlFor="dispense-qty">
              <Input
                id="dispense-qty"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setPlan(null);
                }}
                required
              />
            </Field>
            <Field label="Prescription / reference (optional)" htmlFor="dispense-ref">
              <Input
                id="dispense-ref"
                value={reference}
                maxLength={120}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. Rx 2024/1187, Ward 6"
              />
            </Field>
            <Button type="submit" variant="outline" className="w-full" disabled={!valid || check.isPending}>
              <ScanSearch className="h-4 w-4" /> {check.isPending ? "Checking…" : "Check stock"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispensing plan</CardTitle>
          <CardDescription>
            {plan ? `Stock position on ${formatDate(plan.asOf)}.` : "Choose a medicine and quantity, then check stock."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan ? (
            <>
              {plan.canDispense ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertTitle>Safe to dispense {formatNumber(plan.requested)} units</AlertTitle>
                  <AlertDescription>
                    {formatNumber(plan.available)} safe units in stock. Hand out the batches below, in this order.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertOctagon className="h-4 w-4" />
                  <AlertTitle>Cannot dispense</AlertTitle>
                  <AlertDescription>{plan.refusal}</AlertDescription>
                </Alert>
              )}

              {plan.warnings.length ? (
                <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
                  {plan.warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              ) : null}

              {plan.lines.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Batch</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">In batch</TableHead>
                        <TableHead className="text-right">Take</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-mono text-sm">{line.batchNumber}</TableCell>
                          <TableCell>
                            {formatDate(line.expiryDate)}
                            <span className="block text-xs text-muted-foreground">{line.daysToExpiry} days left</span>
                          </TableCell>
                          <TableCell>
                            <BatchStatusPill status={line.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(line.quantity)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatNumber(line.take)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {plan.canDispense ? (
                canDispense ? (
                  <Button onClick={() => dispense.mutate()} disabled={dispense.isPending}>
                    <PackageMinus className="h-4 w-4" />
                    {dispense.isPending ? "Recording…" : `Confirm and dispense ${formatNumber(plan.requested)} units`}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Your role can check stock but not dispense.</p>
                )
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The plan lists every batch that will be used and anything held back as expired or quarantined.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
