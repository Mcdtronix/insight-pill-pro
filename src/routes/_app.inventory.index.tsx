import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { inventoryApi } from "@/api/inventoryApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { StockStatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
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
import type { StockStatus } from "@/types/domain";
import { STOCK_STATUS_LABELS } from "@/utils/constants";
import { formatCurrency, formatDate, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/inventory/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inventory — Pharma DSS" },
      { name: "description", content: "Track stock levels, reorder points and expiry dates across every medicine." },
      { property: "og:title", content: "Inventory — Pharma DSS" },
      { property: "og:description", content: "Stock levels, reorder points and expiry dates for every medicine." },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const inventory = useQuery({ queryKey: ["inventory"], queryFn: inventoryApi.list });
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<StockStatus | "all">("all");
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set((inventory.data ?? []).map((item) => item.category))).sort(),
    [inventory.data],
  );

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (inventory.data ?? []).filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (category !== "all" && item.category !== category) return false;
      if (!needle) return true;
      return (
        item.medicineName.toLowerCase().includes(needle) || item.supplierName.toLowerCase().includes(needle)
      );
    });
  }, [inventory.data, term, status, category]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Raw data layer"
        title="Inventory"
        description="Current stock positions, reorder thresholds and consumption rates for every tracked medicine."
        actions={<DecisionChain active="data" />}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-3">
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search medicine or supplier"
              className="max-w-xs"
              aria-label="Search inventory"
            />
            <Select value={status} onValueChange={(value) => setStatus(value as StockStatus | "all")}>
              <SelectTrigger className="w-48" aria-label="Filter by stock status">
                <SelectValue placeholder="Stock status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(STOCK_STATUS_LABELS) as StockStatus[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STOCK_STATUS_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-48" aria-label="Filter by category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="ml-auto self-center text-sm text-muted-foreground">
              {formatNumber(rows.length)} of {formatNumber((inventory.data ?? []).length)} items
            </p>
          </div>

          {inventory.isPending ? (
            <LoadingBlock rows={6} label="Loading inventory" />
          ) : inventory.isError ? (
            <ErrorBlock error={inventory.error} onRetry={() => inventory.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyBlock title="No matching medicines" detail="Adjust the search or filters to widen the results." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicine</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Reorder point</TableHead>
                    <TableHead className="text-right">Daily use</TableHead>
                    <TableHead>Earliest expiry</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{item.medicineName}</span>
                        <span className="block text-xs text-muted-foreground">{item.strength}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.category}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(item.currentStock)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatNumber(item.reorderPoint)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatNumber(item.dailyConsumption)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(item.earliestExpiry)}</TableCell>
                      <TableCell className="text-muted-foreground">{item.supplierName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(item.currentStock * item.unitCost, 0)}
                      </TableCell>
                      <TableCell>
                        <StockStatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/inventory/$medicineId" params={{ medicineId: item.medicineId }}>
                            View
                          </Link>
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
    </div>
  );
}
