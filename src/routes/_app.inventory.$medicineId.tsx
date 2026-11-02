import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { forecastApi } from "@/api/forecastApi";
import { inventoryApi } from "@/api/inventoryApi";
import { medicineApi } from "@/api/medicineApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { StockStatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatNumber, orNotAvailable } from "@/utils/formatting";

export const Route = createFileRoute("/_app/inventory/$medicineId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Medicine detail — Pharma DSS" },
      { name: "description", content: "Stock position, movement history and demand outlook for a single medicine." },
      { property: "og:title", content: "Medicine detail — Pharma DSS" },
      { property: "og:description", content: "Stock position, movement history and demand outlook." },
    ],
  }),
  component: MedicineDetailPage,
});

function MedicineDetailPage() {
  const { medicineId } = Route.useParams();
  const item = useQuery({ queryKey: ["inventory", medicineId], queryFn: () => inventoryApi.item(medicineId) });
  const transactions = useQuery({
    queryKey: ["transactions", medicineId],
    queryFn: () => medicineApi.transactions(medicineId),
  });
  const forecast = useQuery({
    queryKey: ["forecast", medicineId, 30],
    queryFn: () => forecastApi.forMedicine(medicineId, 30),
  });

  if (item.isPending) return <LoadingBlock rows={6} label="Loading medicine" />;
  if (item.isError) return <ErrorBlock error={item.error} onRetry={() => item.refetch()} />;
  if (!item.data) return <EmptyBlock title="Medicine not found" />;

  const record = item.data;
  const coverDays = record.dailyConsumption > 0 ? record.currentStock / record.dailyConsumption : null;
  const stockPct = Math.min(100, (record.currentStock / Math.max(record.reorderPoint * 2, 1)) * 100);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/inventory">
          <ArrowLeft className="h-4 w-4" /> Back to inventory
        </Link>
      </Button>

      <PageHeader
        eyebrow={record.category}
        title={`${record.medicineName} ${record.strength}`}
        description={`Supplied by ${record.supplierName} at ${formatCurrency(record.unitCost)} per unit.`}
        actions={<StockStatusBadge status={record.status} />}
      />

      <DecisionChain active="analytics" />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock position</CardTitle>
            <CardDescription>Against a reorder point of {formatNumber(record.reorderPoint)} units.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums">{formatNumber(record.currentStock)}</p>
            <Progress value={stockPct} />
            <p className="text-sm text-muted-foreground">
              Safety stock {formatNumber(record.safetyStock)} units · Stock value{" "}
              {formatCurrency(record.currentStock * record.unitCost, 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consumption</CardTitle>
            <CardDescription>Average daily dispensing rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-3xl font-semibold tabular-nums">{formatNumber(record.dailyConsumption)}</p>
            <p className="text-sm text-muted-foreground">
              {coverDays === null
                ? "Cover not available"
                : `About ${Math.round(coverDays)} days of cover remaining`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Earliest expiry</CardTitle>
            <CardDescription>First batch to expire under FEFO.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold">
              {record.earliestExpiry ? formatDate(record.earliestExpiry) : "No stock on hand"}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/expiry">Review expiry risk</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Demand outlook</CardTitle>
          <CardDescription>Model-generated 30-day forecast with transparency on how it was produced.</CardDescription>
        </CardHeader>
        <CardContent>
          {forecast.isPending ? (
            <LoadingBlock rows={3} label="Loading forecast" />
          ) : forecast.isError ? (
            <ErrorBlock error={forecast.error} onRetry={() => forecast.refetch()} />
          ) : forecast.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Forecast demand" value={`${formatNumber(forecast.data.totalForecastDemand)} units`} />
              <Metric label="Model" value={orNotAvailable(forecast.data.metrics.algorithm)} />
              <Metric label="MAPE" value={orNotAvailable(forecast.data.metrics.mape, "%")} />
              <Metric
                label="Last trained"
                value={
                  forecast.data.metrics.trainedAt ? formatDate(forecast.data.metrics.trainedAt) : "Not available"
                }
              />
              <div className="sm:col-span-2 lg:col-span-4">
                <Button asChild size="sm" variant="outline">
                  <Link to="/forecasting" search={{ medicine: record.medicineId } as never}>
                    Open full forecast
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock movement history</CardTitle>
          <CardDescription>Receipts, dispensing, adjustments and disposals.</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.isPending ? (
            <LoadingBlock label="Loading transactions" />
          ) : transactions.isError ? (
            <ErrorBlock error={transactions.error} onRetry={() => transactions.refetch()} />
          ) : (transactions.data ?? []).length === 0 ? (
            <EmptyBlock title="No recorded movements" detail="Transactions appear once stock is received or issued." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(transactions.data ?? []).map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{formatDate(tx.date)}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{tx.type}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(tx.quantity)}</TableCell>
                      <TableCell className="text-muted-foreground">{tx.batch}</TableCell>
                      <TableCell className="text-muted-foreground">{tx.reference}</TableCell>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-semibold text-foreground">{value}</p>
    </div>
  );
}
