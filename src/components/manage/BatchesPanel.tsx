import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCog, PackagePlus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { type ReceiveBatchInput, manageApi } from "@/api/manageApi";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BatchStatus, StockBatch } from "@/types/domain";
import { formatCurrency, formatDate, formatNumber } from "@/utils/formatting";

import { BatchStatusPill, Field, NativeSelect, ReasonDialog } from "./shared";
import { BATCH_STATUS, useRefreshStock } from "./stockMeta";

const FILTERS: { value: BatchStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "expired", label: "Expired" },
  { value: "short_dated", label: "Short-dated" },
  { value: "quarantined", label: "Quarantined" },
  { value: "safe", label: "Safe" },
];

type Action = { kind: "quarantine" | "release" | "dispose" | "expiry"; batch: StockBatch } | null;

function toast409(error: unknown) {
  const { title, detail } = describeError(error);
  toast.error(title, { description: detail });
}

/** Every batch with its expiry date and safety status; receive, quarantine, correct and dispose. */
export function BatchesPanel({ canEdit }: { canEdit: boolean }) {
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => manageApi.batches() });
  const refresh = useRefreshStock();
  const [filter, setFilter] = useState<BatchStatus | "all">("all");
  const [term, setTerm] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [newExpiry, setNewExpiry] = useState("");

  const counts = useMemo(() => {
    const c: Partial<Record<BatchStatus | "all", number>> = { all: 0 };
    for (const b of batches.data ?? []) {
      c.all = (c.all ?? 0) + 1;
      c[b.status] = (c[b.status] ?? 0) + 1;
    }
    return c;
  }, [batches.data]);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (batches.data ?? []).filter(
      (b) =>
        (filter === "all" || b.status === filter) &&
        (!needle || b.medicineName.toLowerCase().includes(needle) || b.batchNumber.toLowerCase().includes(needle)),
    );
  }, [batches.data, filter, term]);

  const done = async (message: string) => {
    toast.success(message);
    setAction(null);
    setNewExpiry("");
    await refresh();
  };

  const update = useMutation({
    mutationFn: ({ batch, reason }: { batch: StockBatch; reason: string }) => {
      if (action?.kind === "expiry") return manageApi.updateBatch(batch.id, { expiryDate: newExpiry, reason });
      return manageApi.updateBatch(batch.id, { quarantined: action?.kind === "quarantine", reason });
    },
    onSuccess: (b) => done(`Batch ${b.batchNumber}: ${b.statusLabel.toLowerCase()}`),
    onError: toast409,
  });
  const dispose = useMutation({
    mutationFn: ({ batch, reason }: { batch: StockBatch; reason: string }) => manageApi.disposeBatch(batch.id, reason),
    onSuccess: (b) => done(`Batch ${b.batchNumber} written off and removed from stock`),
    onError: toast409,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Batches and expiry dates</CardTitle>
          <CardDescription>
            Each delivery is a batch with its own expiry date. Expired and quarantined batches are blocked from
            dispensing automatically.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button onClick={() => setReceiving(true)}>
            <PackagePlus className="h-4 w-4" /> Receive stock
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              onClick={() => setFilter(f.value)}
              className={cn(f.value === "expired" && (counts.expired ?? 0) > 0 && filter !== "expired" && "border-destructive/50 text-destructive")}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.value] ?? 0}</span>
            </Button>
          ))}
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search medicine or batch"
            aria-label="Search batches"
            className="ml-auto max-w-xs"
          />
        </div>

        {batches.isPending ? (
          <LoadingBlock rows={6} label="Loading batches" />
        ) : batches.isError ? (
          <ErrorBlock error={batches.error} onRetry={() => batches.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No batches match" detail="Change the filter or search." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id} className={cn(b.status === "expired" && "bg-destructive/5")}>
                    <TableCell>
                      <span className="font-medium">{b.medicineName}</span>
                      <span className="block text-xs text-muted-foreground">{b.strength}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{b.batchNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.receivedAt)}</TableCell>
                    <TableCell>
                      {formatDate(b.expiryDate)}
                      <span
                        className={cn(
                          "block text-xs",
                          b.daysToExpiry <= 0 ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {b.daysToExpiry > 0
                          ? `${b.daysToExpiry} days left`
                          : b.daysToExpiry === 0
                            ? "expires today"
                            : `expired ${-b.daysToExpiry} days ago`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(b.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(b.quantity * b.unitCost, 0)}
                    </TableCell>
                    <TableCell>
                      <BatchStatusPill status={b.status} />
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right whitespace-nowrap">
                        {b.quarantined ? (
                          <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "release", batch: b })}>
                            <ShieldCheck className="h-4 w-4" /> Release
                          </Button>
                        ) : b.status !== "expired" ? (
                          <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "quarantine", batch: b })}>
                            <ShieldAlert className="h-4 w-4" /> Quarantine
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setNewExpiry(b.expiryDate);
                            setAction({ kind: "expiry", batch: b });
                          }}
                          aria-label={`Correct expiry date of batch ${b.batchNumber}`}
                        >
                          <CalendarCog className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant={b.status === "expired" ? "destructive" : "ghost"}
                          onClick={() => setAction({ kind: "dispose", batch: b })}
                        >
                          <Trash2 className="h-4 w-4" /> {b.status === "expired" ? "Dispose" : ""}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {Object.entries(BATCH_STATUS)
            .filter(([k]) => k !== "empty")
            .map(([, v]) => v.label)
            .join(" · ")}{" "}
          — short-dated means inside the policy's expiry window: still safe, dispensed first.
        </p>
      </CardContent>

      <ReceiveDialog open={receiving} onOpenChange={setReceiving} onReceived={refresh} />

      <ReasonDialog
        open={action?.kind === "quarantine" || action?.kind === "release"}
        onOpenChange={(open) => !open && setAction(null)}
        title={action?.kind === "release" ? `Release batch ${action?.batch.batchNumber}?` : `Quarantine batch ${action?.batch.batchNumber}?`}
        description={
          action?.kind === "release"
            ? "The batch becomes available for dispensing again (if it is not expired)."
            : "The batch is blocked from dispensing until it is released. Use for recalls, damage or a quality query."
        }
        confirmLabel={action?.kind === "release" ? "Release" : "Quarantine"}
        destructive={action?.kind === "quarantine"}
        pending={update.isPending}
        onConfirm={(reason) => action && update.mutate({ batch: action.batch, reason })}
      />
      <ReasonDialog
        open={action?.kind === "expiry"}
        onOpenChange={(open) => !open && setAction(null)}
        title={`Correct the expiry date of batch ${action?.batch.batchNumber}`}
        description="Use only to fix a typing error. The old and new dates are kept in the audit trail."
        confirmLabel="Save expiry date"
        pending={update.isPending}
        extra={
          <Field label="Expiry date on the pack" htmlFor="new-expiry">
            <Input id="new-expiry" type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} required />
          </Field>
        }
        onConfirm={(reason) => action && update.mutate({ batch: action.batch, reason })}
      />
      <ReasonDialog
        open={action?.kind === "dispose"}
        onOpenChange={(open) => !open && setAction(null)}
        title={`Dispose of batch ${action?.batch.batchNumber}?`}
        description={`Writes off all ${formatNumber(action?.batch.quantity ?? 0)} remaining units of ${
          action?.batch.medicineName ?? ""
        }. Follow MCAZ disposal procedures for the physical stock.`}
        confirmLabel="Dispose"
        destructive
        pending={dispose.isPending}
        onConfirm={(reason) => action && dispose.mutate({ batch: action.batch, reason })}
      />
    </Card>
  );
}

function ReceiveDialog({
  open,
  onOpenChange,
  onReceived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReceived: () => Promise<unknown>;
}) {
  const medicines = useQuery({ queryKey: ["catalogue", "medicines"], queryFn: manageApi.medicines, enabled: open });
  const suppliers = useQuery({ queryKey: ["catalogue", "suppliers"], queryFn: manageApi.suppliers, enabled: open });
  const day = useQuery({ queryKey: ["system-day"], queryFn: manageApi.systemDay, enabled: open, staleTime: 60_000 });
  const empty = { medicineId: "", supplierId: "", batchNumber: "", receivedAt: "", expiryDate: "", quantity: "", unitCost: "" };
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof empty) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const receive = useMutation({
    mutationFn: () => {
      const input: ReceiveBatchInput = {
        medicineId: form.medicineId,
        supplierId: form.supplierId || null,
        batchNumber: form.batchNumber,
        expiryDate: form.expiryDate,
        quantity: Number(form.quantity),
        unitCost: Number(form.unitCost),
      };
      const receivedAt = form.receivedAt || day.data?.today;
      return manageApi.receiveBatch(receivedAt ? { ...input, receivedAt } : input);
    },
    onSuccess: async (b) => {
      toast.success(`Received ${formatNumber(b.quantity)} units of ${b.medicineName}`, {
        description: `Batch ${b.batchNumber}, expires ${formatDate(b.expiryDate)} — ${b.statusLabel.toLowerCase()}.`,
      });
      setForm(empty);
      onOpenChange(false);
      await onReceived();
    },
    onError: toast409,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            receive.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Receive stock</DialogTitle>
            <DialogDescription>
              Copy the batch number and expiry date exactly as printed on the pack. Already-expired stock is refused.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medicine" htmlFor="rcv-medicine" className="sm:col-span-2">
              <NativeSelect id="rcv-medicine" value={form.medicineId} onChange={set("medicineId")} required>
                <option value="">Choose a medicine</option>
                {(medicines.data ?? [])
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.strength}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Supplier" htmlFor="rcv-supplier" className="sm:col-span-2">
              <NativeSelect id="rcv-supplier" value={form.supplierId} onChange={set("supplierId")}>
                <option value="">Not recorded</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Batch number" htmlFor="rcv-batch">
              <Input
                id="rcv-batch"
                value={form.batchNumber}
                onChange={(e) => set("batchNumber")(e.target.value)}
                className="font-mono uppercase"
                required
              />
            </Field>
            <Field label="Quantity received (units)" htmlFor="rcv-qty">
              <Input id="rcv-qty" type="number" min={1} step={1} value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} required />
            </Field>
            <Field
              label="Received on"
              htmlFor="rcv-received"
              hint={day.data ? `Leave blank for today (${formatDate(day.data.today)}).` : undefined}
            >
              <Input id="rcv-received" type="date" value={form.receivedAt} max={day.data?.today} onChange={(e) => set("receivedAt")(e.target.value)} />
            </Field>
            <Field label="Expiry date" htmlFor="rcv-expiry">
              <Input id="rcv-expiry" type="date" value={form.expiryDate} min={day.data?.today} onChange={(e) => set("expiryDate")(e.target.value)} required />
            </Field>
            <Field label="Unit cost (USD)" htmlFor="rcv-cost">
              <Input id="rcv-cost" type="number" min={0} step="0.0001" value={form.unitCost} onChange={(e) => set("unitCost")(e.target.value)} required />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={receive.isPending}>
              {receive.isPending ? "Saving…" : "Receive stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
