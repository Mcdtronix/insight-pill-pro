import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { type OfferInput, type SupplierInput, manageApi } from "@/api/manageApi";
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
import type { ManagedSupplier, SupplierOfferRow } from "@/types/domain";
import { formatCurrency } from "@/utils/formatting";

import { Field, NativeSelect } from "./shared";
import { useRefreshStock } from "./stockMeta";

const STATUS_TONE = { active: "success", review: "warning", suspended: "danger" } as const;

function fail(error: unknown) {
  const { title, detail } = describeError(error);
  toast.error(title, { description: detail });
}

/** Suppliers and their offers (who sells which medicine, at what price and lead time). */
export function SuppliersPanel({ canEdit }: { canEdit: boolean }) {
  const suppliers = useQuery({ queryKey: ["catalogue", "suppliers"], queryFn: manageApi.suppliers });
  const offers = useQuery({ queryKey: ["catalogue", "offers"], queryFn: () => manageApi.offers() });
  const [editing, setEditing] = useState<ManagedSupplier | "new" | null>(null);
  const [offer, setOffer] = useState<SupplierOfferRow | "new" | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Suppliers</CardTitle>
            <CardDescription>
              Suspended suppliers are skipped by the reorder engine. Performance scores are on Supplier Intelligence.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Add supplier
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {suppliers.isPending ? (
            <LoadingBlock rows={4} label="Loading suppliers" />
          ) : suppliers.isError ? (
            <ErrorBlock error={suppliers.error} onRetry={() => suppliers.refetch()} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Active offers</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(suppliers.data ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.contactEmail || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.phone || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.offerCount ?? 0}</TableCell>
                      <TableCell>
                        <Pill tone={STATUS_TONE[s.status]}>{s.status}</Pill>
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Supplier offers</CardTitle>
            <CardDescription>
              Price, lead time, pack size and minimum order for each medicine–supplier pair. The engine picks the best
              offer using the supplier scores.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button variant="outline" onClick={() => setOffer("new")}>
              <Plus className="h-4 w-4" /> Add offer
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {offers.isPending ? (
            <LoadingBlock rows={4} label="Loading offers" />
          ) : offers.isError ? (
            <ErrorBlock error={offers.error} onRetry={() => offers.refetch()} />
          ) : (offers.data ?? []).length === 0 ? (
            <EmptyBlock title="No offers yet" />
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicine</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Lead time</TableHead>
                    <TableHead className="text-right">Pack / min. order</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(offers.data ?? []).map((o) => (
                    <TableRow key={o.id} className={o.active ? undefined : "opacity-60"}>
                      <TableCell className="font-medium">{o.medicineName}</TableCell>
                      <TableCell>{o.supplierName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(o.unitCost, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.leadTimeDays} days</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {o.packSize} / {o.minimumOrder}
                      </TableCell>
                      <TableCell>{o.active ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}</TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setOffer(o)} aria-label={`Edit offer for ${o.medicineName}`}>
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
        </CardContent>
      </Card>

      {editing ? <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {offer ? <OfferDialog offer={offer === "new" ? null : offer} onClose={() => setOffer(null)} /> : null}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: ManagedSupplier | null; onClose: () => void }) {
  const refresh = useRefreshStock();
  const [form, setForm] = useState<Required<SupplierInput>>({
    name: supplier?.name ?? "",
    contactEmail: supplier?.contactEmail ?? "",
    phone: supplier?.phone ?? "",
    status: supplier?.status ?? "active",
  });
  const save = useMutation({
    mutationFn: () => (supplier ? manageApi.updateSupplier(supplier.id, form) : manageApi.createSupplier(form)),
    onSuccess: async (s) => {
      toast.success(supplier ? `Saved ${s.name}` : `Added ${s.name}`);
      onClose();
      await refresh();
    },
    onError: fail,
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
            <DialogTitle>{supplier ? `Edit ${supplier.name}` : "Add a supplier"}</DialogTitle>
            <DialogDescription>Add an offer afterwards so the engine can order from this supplier.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="sup-name">
            <Input id="sup-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Order email" htmlFor="sup-email">
              <Input id="sup-email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="sup-phone">
              <Input id="sup-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+263 …" />
            </Field>
          </div>
          <Field label="Status" htmlFor="sup-status">
            <NativeSelect id="sup-status" value={form.status} onChange={(v) => setForm({ ...form, status: v as ManagedSupplier["status"] })}>
              <option value="active">Active</option>
              <option value="review">Under review</option>
              <option value="suspended">Suspended — do not order</option>
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OfferDialog({ offer, onClose }: { offer: SupplierOfferRow | null; onClose: () => void }) {
  const refresh = useRefreshStock();
  const medicines = useQuery({ queryKey: ["catalogue", "medicines"], queryFn: manageApi.medicines, enabled: !offer });
  const suppliers = useQuery({ queryKey: ["catalogue", "suppliers"], queryFn: manageApi.suppliers, enabled: !offer });
  const [form, setForm] = useState({
    medicineId: offer?.medicineId ?? "",
    supplierId: offer?.supplierId ?? "",
    unitCost: String(offer?.unitCost ?? ""),
    leadTimeDays: String(offer?.leadTimeDays ?? "7"),
    packSize: String(offer?.packSize ?? "1"),
    minimumOrder: String(offer?.minimumOrder ?? "1"),
    active: offer?.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body: OfferInput = {
        medicineId: form.medicineId,
        supplierId: form.supplierId,
        unitCost: Number(form.unitCost),
        leadTimeDays: Number(form.leadTimeDays),
        packSize: Number(form.packSize),
        minimumOrder: Number(form.minimumOrder),
        active: form.active,
      };
      return offer ? manageApi.updateOffer(offer.id, body) : manageApi.createOffer(body);
    },
    onSuccess: async (o) => {
      toast.success(`Offer saved: ${o.medicineName} from ${o.supplierName}`);
      onClose();
      await refresh();
    },
    onError: fail,
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
            <DialogTitle>{offer ? `${offer.medicineName} from ${offer.supplierName}` : "Add a supplier offer"}</DialogTitle>
            <DialogDescription>The reorder engine uses these terms when it recommends an order.</DialogDescription>
          </DialogHeader>
          {offer ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Medicine" htmlFor="off-med">
                <NativeSelect id="off-med" value={form.medicineId} onChange={(v) => setForm({ ...form, medicineId: v })} required>
                  <option value="">Choose…</option>
                  {(medicines.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.strength}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Supplier" htmlFor="off-sup">
                <NativeSelect id="off-sup" value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} required>
                  <option value="">Choose…</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit cost (USD)" htmlFor="off-cost">
              <Input id="off-cost" type="number" min={0} step="0.0001" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required />
            </Field>
            <Field label="Lead time (days)" htmlFor="off-lead">
              <Input id="off-lead" type="number" min={1} max={365} value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} required />
            </Field>
            <Field label="Pack size" htmlFor="off-pack">
              <Input id="off-pack" type="number" min={1} value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} required />
            </Field>
            <Field label="Minimum order (units)" htmlFor="off-min">
              <Input id="off-min" type="number" min={1} value={form.minimumOrder} onChange={(e) => setForm({ ...form, minimumOrder: e.target.value })} required />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="off-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            <label htmlFor="off-active" className="text-sm">
              Active offer
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save offer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
