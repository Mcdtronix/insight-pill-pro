import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { forecastApi } from "@/api/forecastApi";
import { medicineApi } from "@/api/medicineApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatNumber, formatPercent, orNotAvailable } from "@/utils/formatting";

const HORIZONS = [7, 14, 30, 60, 90];

export const Route = createFileRoute("/_app/forecasting")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Demand Forecasting — Pharma DSS" },
      {
        name: "description",
        content: "Predicted medicine demand with confidence bands and model accuracy metrics.",
      },
      { property: "og:title", content: "Demand Forecasting — Pharma DSS" },
      {
        property: "og:description",
        content: "Predicted medicine demand with confidence bands and model accuracy metrics.",
      },
    ],
  }),
  component: ForecastingPage,
});

function ForecastingPage() {
  const medicines = useQuery({ queryKey: ["medicines"], queryFn: medicineApi.list });
  const [medicineId, setMedicineId] = useState<string>("");
  const [horizon, setHorizon] = useState(30);

  const selectedId = medicineId || medicines.data?.[0]?.id || "";

  const forecast = useQuery({
    queryKey: ["forecast", selectedId, horizon],
    queryFn: () => forecastApi.forMedicine(selectedId, horizon),
    enabled: Boolean(selectedId),
  });

  const series = (forecast.data?.series ?? []).map((point) => ({
    ...point,
    band:
      point.lower !== null && point.upper !== null ? [point.lower, point.upper] : undefined,
    label: formatDate(point.date, "dd MMM"),
  }));

  const metrics = forecast.data?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Forecast layer"
        title="Demand Forecasting"
        description="Statistical demand predictions with uncertainty bands, so reorder decisions rest on expected consumption rather than guesswork."
        actions={<DecisionChain active="forecast" />}
      />

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-6">
          <Select value={selectedId} onValueChange={setMedicineId}>
            <SelectTrigger className="w-72" aria-label="Select medicine">
              <SelectValue placeholder="Select a medicine" />
            </SelectTrigger>
            <SelectContent>
              {(medicines.data ?? []).map((medicine) => (
                <SelectItem key={medicine.id} value={medicine.id}>
                  {medicine.name} {medicine.strength}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(horizon)} onValueChange={(value) => setHorizon(Number(value))}>
            <SelectTrigger className="w-44" aria-label="Forecast horizon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  Next {days} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {medicines.isError ? (
        <ErrorBlock error={medicines.error} onRetry={() => medicines.refetch()} />
      ) : forecast.isPending ? (
        <LoadingBlock rows={6} label="Loading forecast" />
      ) : forecast.isError ? (
        <ErrorBlock error={forecast.error} onRetry={() => forecast.refetch()} />
      ) : forecast.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Forecast demand"
              value={`${formatNumber(forecast.data.totalForecastDemand)} units`}
              hint={`Over the next ${forecast.data.horizonDays} days`}
            />
            <MetricTile
              label="Change vs previous period"
              value={formatPercent(forecast.data.changeVsPreviousPeriodPct)}
              hint="Compared with the preceding window of equal length"
            />
            <MetricTile
              label="Model"
              value={orNotAvailable(metrics?.algorithm)}
              hint={`Version ${orNotAvailable(metrics?.version)}`}
            />
            <MetricTile
              label="Last trained"
              value={metrics?.trainedAt ? formatDate(metrics.trainedAt) : "Not available"}
              hint="Retraining is handled by the analytics backend"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{forecast.data.medicineName}</CardTitle>
              <CardDescription>
                Historical consumption against the predicted demand curve and its confidence interval.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} width={48} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="band"
                    name="Confidence interval"
                    stroke="none"
                    fill="hsl(var(--chart-2))"
                    fillOpacity={0.18}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual consumption"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model transparency</CardTitle>
              <CardDescription>
                Accuracy measured on held-out history. Lower error means the forecast can be trusted more when
                sizing reorder quantities.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <MetricTile
                label="MAE"
                value={metrics?.mae !== null && metrics?.mae !== undefined ? formatNumber(metrics.mae, 2) : "Not available"}
                hint="Mean absolute error, in units per day"
              />
              <MetricTile
                label="RMSE"
                value={metrics?.rmse !== null && metrics?.rmse !== undefined ? formatNumber(metrics.rmse, 2) : "Not available"}
                hint="Root mean squared error, penalises large misses"
              />
              <MetricTile
                label="MAPE"
                value={metrics?.mape !== null && metrics?.mape !== undefined ? `${metrics.mape.toFixed(1)}%` : "Not available"}
                hint="Mean absolute percentage error"
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1.5 text-xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
