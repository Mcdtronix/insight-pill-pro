import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supplierApi } from "@/api/supplierApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Pill } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Supplier } from "@/types/domain";
import { formatCurrency, formatDate, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/suppliers")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Supplier Intelligence — Pharma DSS" },
      {
        name: "description",
        content: "Supplier reliability scores, lead times, delivery performance and open order history.",
      },
      { property: "og:title", content: "Supplier Intelligence — Pharma DSS" },
      {
        property: "og:description",
        content: "Supplier reliability scores, lead times, delivery performance and open order history.",
      },
    ],
  }),
  component: SuppliersPage,
});

const STATUS_TONE = {
  active: "success",
  review: "warning",
  suspended: "danger",
} as const;

function SuppliersPage() {
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: supplierApi.list });
  const [selected, setSelected] = useState<Supplier | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics layer"
        title="Supplier Intelligence"
        description="Reliability scoring across delivery punctuality, lead-time stability, pricing consistency and quality — the inputs behind every sourcing decision."
        actions={<DecisionChain active="analytics" />}
      />

      <Card>
        <CardContent className="pt-6">
          {suppliers.isPending ? (
            <LoadingBlock rows={5} label="Loading suppliers" />
          ) : suppliers.isError ? (
            <ErrorBlock error={suppliers.error} onRetry={() => suppliers.refetch()} />
          ) : (suppliers.data ?? []).length === 0 ? (
            <EmptyBlock title="No suppliers registered" detail="Add suppliers to start scoring performance." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="w-48">Overall score</TableHead>
                    <TableHead className="text-right">On-time</TableHead>
                    <TableHead className="text-right">Avg lead time</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Defect rate</TableHead>
                    <TableHead className="text-right">Open orders</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(suppliers.data ?? []).map((supplier) => (
                    <TableRow key={supplier.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{supplier.name}</span>
                        <span className="block text-xs text-muted-foreground">{supplier.contactEmail}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={supplier.overallScore} className="h-2" />
                          <span className="text-sm font-medium tabular-nums">{supplier.overallScore}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{supplier.onTimeDeliveryPct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{supplier.avgLeadTimeDays} d</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        ±{supplier.leadTimeVarianceDays} d
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{supplier.defectRatePct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{supplier.openOrders}</TableCell>
                      <TableCell className="text-right tabular-nums">{supplier.lateDeliveries}</TableCell>
                      <TableCell>
                        <Pill tone={STATUS_TONE[supplier.status]}>
                          {supplier.status === "review" ? "Under review" : supplier.status === "suspended" ? "Suspended" : "Active"}
                        </Pill>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(supplier)}>
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected ? <SupplierDetail supplier={selected} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SupplierDetail({ supplier }: { supplier: Supplier }) {
  const performance = useQuery({
    queryKey: ["supplier-performance", supplier.id],
    queryFn: () => supplierApi.performance(supplier.id),
  });

  return (
    <div className="space-y-6">
      <SheetHeader className="px-0">
        <SheetTitle>{supplier.name}</SheetTitle>
        <SheetDescription>
          {supplier.contactEmail} · {supplier.phone}
        </SheetDescription>
      </SheetHeader>

      <div className="grid grid-cols-2 gap-3">
        <Score label="Overall" value={supplier.overallScore} />
        <Score label="On-time delivery" value={supplier.onTimeDeliveryPct} />
        <Score label="Price consistency" value={supplier.priceConsistencyPct} />
        <Score label="Quality" value={supplier.qualityPct} />
      </div>

      {performance.isPending ? (
        <LoadingBlock rows={4} label="Loading supplier performance" />
      ) : performance.isError ? (
        <ErrorBlock error={performance.error} onRetry={() => performance.refetch()} />
      ) : performance.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance trend</CardTitle>
              <CardDescription>Score and punctuality over recent periods.</CardDescription>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performance.data.trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="score" name="Score" stroke="var(--chart-1)" strokeWidth={2} />
                  <Line type="monotone" dataKey="onTime" name="On-time %" stroke="var(--chart-2)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent orders</CardTitle>
              <CardDescription>Delivery history behind the reliability score.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Placed</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance.data.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs">{order.id}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.placedAt, "dd MMM")}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.expectedAt, "dd MMM")}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.receivedAt ? formatDate(order.receivedAt, "dd MMM") : "Pending"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(order.value, 0)}</TableCell>
                        <TableCell>
                          <Pill
                            tone={
                              order.status === "delivered" ? "success" : order.status === "late" ? "danger" : "info"
                            }
                          >
                            {order.status === "delivered" ? "Delivered" : order.status === "late" ? "Late" : "Pending"}
                          </Pill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {formatNumber(supplier.openOrders)} open orders · {formatNumber(supplier.lateDeliveries)} late deliveries
        recorded.
      </p>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <Progress value={value} className="mt-2 h-1.5" />
    </div>
  );
}
