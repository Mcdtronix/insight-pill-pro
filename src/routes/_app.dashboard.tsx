import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertOctagon,
  Boxes,
  CalendarClock,
  DollarSign,
  ShoppingCart,
  Truck,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { dashboardApi } from "@/api/dashboardApi";
import { inventoryApi } from "@/api/inventoryApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { KpiCard } from "@/components/common/KpiCard";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Pill, severityTone } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { formatCompactCurrency, formatNumber, formatPercent } from "@/utils/formatting";

export const Route = createFileRoute("/_app/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Pharma DSS" },
      { name: "description", content: "Pharmacy inventory health, demand outlook and decision alerts at a glance." },
      { property: "og:title", content: "Dashboard — Pharma DSS" },
      { property: "og:description", content: "Pharmacy inventory health, demand outlook and decision alerts." },
    ],
  }),
  component: DashboardPage,
});

const SLICE_COLORS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-1)", "var(--chart-5)"];

function DashboardPage() {
  const { user } = useAuth();
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: dashboardApi.kpis });
  const insights = useQuery({ queryKey: ["insights"], queryFn: dashboardApi.insights });
  const health = useQuery({ queryKey: ["inventory-health"], queryFn: inventoryApi.health });
  const trend = useQuery({ queryKey: ["inventory-trend"], queryFn: inventoryApi.trend });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decision overview"
        title={`Good to see you, ${user?.fullName.split(" ")[0] ?? "colleague"}`}
        description="Live inventory health, demand outlook and the decisions waiting on you today."
        actions={<DecisionChain active="decision" />}
      />

      {kpis.isPending ? (
        <LoadingBlock rows={2} label="Loading key metrics" />
      ) : kpis.isError ? (
        <ErrorBlock error={kpis.error} onRetry={() => kpis.refetch()} />
      ) : kpis.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Inventory value"
            value={formatCompactCurrency(kpis.data.inventoryValue)}
            delta={kpis.data.deltas["inventoryValue"]}
            sublabel="vs last month"
            icon={DollarSign}
            to="/inventory"
          />
          <KpiCard
            label="Medicines tracked"
            value={formatNumber(kpis.data.totalMedicines)}
            sublabel={`${formatNumber(kpis.data.activeSuppliers)} active suppliers`}
            icon={Boxes}
            to="/inventory"
          />
          <KpiCard
            label="Low stock items"
            value={formatNumber(kpis.data.lowStockItems)}
            delta={kpis.data.deltas["lowStockItems"]}
            deltaGoodWhen="down"
            sublabel={`${kpis.data.outOfStockItems} out of stock`}
            icon={AlertOctagon}
            tone="warning"
            to="/inventory"
          />
          <KpiCard
            label="Reorder decisions"
            value={formatNumber(kpis.data.reorderRecommendations)}
            sublabel={`${kpis.data.criticalReorders} critical`}
            icon={ShoppingCart}
            tone={kpis.data.criticalReorders > 0 ? "danger" : "neutral"}
            to="/recommendations"
          />
          <KpiCard
            label="Expected demand change"
            value={formatPercent(kpis.data.expectedDemandChangePct)}
            sublabel="next 30 days"
            icon={TrendingUp}
            to="/forecasting"
          />
          <KpiCard
            label="Expiry risk"
            value={formatNumber(kpis.data.medicinesAtExpiryRisk)}
            sublabel="batches needing action"
            icon={CalendarClock}
            tone="warning"
            to="/expiry"
          />
          <KpiCard
            label="Supplier score"
            value={kpis.data.avgSupplierScore.toFixed(1)}
            delta={kpis.data.deltas["avgSupplierScore"]}
            sublabel={`${kpis.data.lateDeliveries} late deliveries`}
            icon={Truck}
            to="/suppliers"
          />
          <KpiCard
            label="Pending orders"
            value={formatNumber(kpis.data.pendingOrders)}
            sublabel="awaiting delivery"
            icon={ShoppingCart}
            to="/suppliers"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stock value and movement</CardTitle>
            <CardDescription>Received vs dispensed units against total stock value.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {trend.isPending ? (
              <LoadingBlock rows={4} label="Loading stock trend" />
            ) : trend.isError ? (
              <ErrorBlock error={trend.error} onRetry={() => trend.refetch()} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data ?? []} margin={{ left: -12, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="stockValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="period" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="stockValue"
                    name="Stock value"
                    stroke="var(--chart-1)"
                    fill="url(#stockValue)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="dispensed"
                    name="Dispensed"
                    stroke="var(--chart-4)"
                    fill="transparent"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name="Received"
                    stroke="var(--chart-2)"
                    fill="transparent"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory health</CardTitle>
            <CardDescription>Distribution of items by stock status.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {health.isPending ? (
              <LoadingBlock rows={3} label="Loading inventory health" />
            ) : health.isError ? (
              <ErrorBlock error={health.error} onRetry={() => health.refetch()} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={health.data ?? []}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {(health.data ?? []).map((entry, index) => (
                      <Cell key={entry.status} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision intelligence</CardTitle>
          <CardDescription>
            What the data shows, why it matters, and the action recommended for each finding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {insights.isPending ? (
            <LoadingBlock label="Loading insights" />
          ) : insights.isError ? (
            <ErrorBlock error={insights.error} onRetry={() => insights.refetch()} />
          ) : (insights.data ?? []).length === 0 ? (
            <EmptyBlock title="No insights yet" detail="Insights appear as soon as analytics detect a pattern." />
          ) : (
            <ul className="space-y-3">
              {(insights.data ?? []).map((insight) => (
                <li key={insight.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{insight.title}</p>
                    <Pill tone={severityTone(insight.severity)}>{insight.severity}</Pill>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{insight.explanation}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <span className="text-sm">
                      <span className="text-muted-foreground">{insight.metricLabel}: </span>
                      <span className="font-semibold tabular-nums">{insight.metricValue}</span>
                    </span>
                    <span className="text-sm text-foreground">
                      <span className="text-muted-foreground">Recommended: </span>
                      {insight.recommendedAction}
                    </span>
                    <Button asChild size="sm" variant="outline" className="ml-auto">
                      <Link to={insight.link as "/"}>Review</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
