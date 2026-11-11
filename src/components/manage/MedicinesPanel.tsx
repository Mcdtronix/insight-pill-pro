import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { type MedicineInput, manageApi } from "@/api/manageApi";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Pill } from "@/components/common/StatusBadge";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CatalogueMedicine } from "@/types/domain";
import { formatDate, formatNumber } from "@/utils/formatting";

import { Field } from "./shared";
import { useRefreshStock } from "./stockMeta";

/** The medicine catalogue with a live stock summary that separates safe, expired and quarantined units. */
export function MedicinesPanel({ canEdit }: { canEdit: boolean }) {
  const medicines = useQuery({ queryKey: ["catalogue", "medicines"], queryFn: manageApi.medicines });
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<CatalogueMedicine | "new" | null>(null);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (medicines.data ?? []).filter(
      (m) => !needle || m.name.toLowerCase().includes(needle) || m.category.toLowerCase().includes(needle),
    );
  }, [medicines.data, term]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Medicines (products)</CardTitle>
          <CardDescription>
            Every product the pharmacy stocks. "Safe" excludes expired and quarantined units.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search name or category"
            aria-label="Search medicines"
            className="w-56"
          />
          {canEdit ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Add medicine
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {medicines.isPending ? (
          <LoadingBlock rows={6} label="Loading medicines" />
        ) : medicines.isError ? (
          <ErrorBlock error={medicines.error} onRetry={() => medicines.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No medicines match" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Safe</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Quarantined</TableHead>
                  <TableHead>Next safe expiry</TableHead>
                  <TableHead>Suppliers</TableHead>
                  <TableHead>Forecast</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id} className={m.active ? undefined : "opacity-60"}>
                    <TableCell>
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[m.strength, m.form].filter(Boolean).join(" · ")}
                        {m.active ? "" : " · inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(m.onHand)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatNumber(m.dispensable)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.expiredUnits ? (
                        <span className="font-semibold text-destructive">{formatNumber(m.expiredUnits)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.quarantinedUnits ? formatNumber(m.quarantinedUnits) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.earliestSafeExpiry ? formatDate(m.earliestSafeExpiry) : "—"}
                    </TableCell>
                    <TableCell>
                      {m.offerCount ? (
                        <span className="tabular-nums">{m.offerCount}</span>
                      ) : (
                        <Pill tone="warning">None</Pill>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.forecastReady ? (
                        <Pill tone="success">Ready</Pill>
                      ) : (
                        <span title="The demand model needs this medicine in its training data and 30 days of history.">
                          <Pill tone="neutral">Not yet</Pill>
                        </span>
                      )}
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A new medicine can be stocked and dispensed straight away. Forecasts and reorder decisions start once it is
          in the demand model and has 30 days of history. Add a supplier offer so the engine knows who sells it.
        </p>
      </CardContent>
      {editing ? <MedicineDialog medicine={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function MedicineDialog({ medicine, onClose }: { medicine: CatalogueMedicine | null; onClose: () => void }) {
  const refresh = useRefreshStock();
  const [form, setForm] = useState<Required<MedicineInput>>({
    name: medicine?.name ?? "",
    strength: medicine?.strength ?? "",
    category: medicine?.category ?? "",
    form: medicine?.form ?? "",
    active: medicine?.active ?? true,
  });
  const set = (key: keyof MedicineInput) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => (medicine ? manageApi.updateMedicine(medicine.id, form) : manageApi.createMedicine(form)),
    onSuccess: async (m) => {
      toast.success(medicine ? `Saved ${m.name}` : `Added ${m.name}`);
      onClose();
      await refresh();
    },
    onError: (error) => toast.error(describeError(error).title, { description: describeError(error).detail }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{medicine ? `Edit ${medicine.name}` : "Add a medicine"}</DialogTitle>
            <DialogDescription>Stock and expiry dates are added per batch under Dispensing → Batches.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="med-name" className="sm:col-span-2">
              <Input id="med-name" value={form.name} onChange={(e) => set("name")(e.target.value)} required />
            </Field>
            <Field label="Strength" htmlFor="med-strength">
              <Input id="med-strength" value={form.strength} onChange={(e) => set("strength")(e.target.value)} placeholder="500mg" />
            </Field>
            <Field label="Form" htmlFor="med-form">
              <Input id="med-form" value={form.form} onChange={(e) => set("form")(e.target.value)} placeholder="Tablet, syrup…" />
            </Field>
            <Field label="Category" htmlFor="med-category" className="sm:col-span-2">
              <Input id="med-category" value={form.category} onChange={(e) => set("category")(e.target.value)} placeholder="Antibiotic" required />
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch id="med-active" checked={form.active} onCheckedChange={set("active")} />
              <label htmlFor="med-active" className="text-sm">
                Active — inactive medicines cannot be received or dispensed
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : medicine ? "Save changes" : "Add medicine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
