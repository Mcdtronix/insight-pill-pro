import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { describeError } from "@/api/client";
import { reportApi, systemApi, type ReportRequest, type ReportResult, type ReportType } from "@/api/reportApi";
import { config } from "@/lib/config";
import { supplierApi } from "@/api/supplierApi";
import { DecisionChain } from "@/components/common/DecisionChain";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/utils/constants";
import { formatDate, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/reports")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reports — Pharma DSS" },
      {
        name: "description",
        content: "Generate inventory, forecast, reorder, supplier and expiry reports for any period.",
      },
      { property: "og:title", content: "Reports — Pharma DSS" },
      {
        property: "og:description",
        content: "Generate inventory, forecast, reorder, supplier and expiry reports for any period.",
      },
    ],
  }),
  component: ReportsPage,
});

const REPORT_TYPES: { value: ReportType; label: string; description: string }[] = [
  { value: "inventory", label: "Inventory status", description: "Stock on hand, reorder points and value by medicine." },
  { value: "stock_movement", label: "Stock movement", description: "Receipts, dispensing, adjustments and disposals." },
  { value: "demand_forecast", label: "Demand forecast", description: "Predicted consumption and model accuracy." },
  { value: "reorder", label: "Reorder decisions", description: "Recommendations raised, approved and rejected." },
  { value: "supplier_performance", label: "Supplier performance", description: "Delivery punctuality, lead times and quality." },
  { value: "expiry_risk", label: "Expiry risk", description: "Batches at risk and the value exposed." },
];

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function ReportsPage() {
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: supplierApi.list });

  const [type, setType] = useState<ReportType>("inventory");
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("all");
  const [supplierId, setSupplierId] = useState("all");
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [result, setResult] = useState<ReportResult | null>(null);

  // Default the period to the 30 days before the system's "today" (the demo date in demo mode).
  const health = useQuery({ queryKey: ["health"], queryFn: systemApi.health, enabled: !config.useMock });
  useEffect(() => {
    if (!health.data?.today) return;
    const end = new Date(`${health.data.today}T00:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    setTo(health.data.today);
    setFrom(start.toISOString().slice(0, 10));
  }, [health.data?.today]);

  const generate = useMutation({
    mutationFn: (payload: ReportRequest) => reportApi.generate(payload),
    onSuccess: (data) => {
      setResult(data);
      toast.success("Report generated", {
        description: `${formatNumber(data.rows)} rows ready to download.`,
      });
    },
    onError: (error) => {
      const { title, detail } = describeError(error);
      toast.error(title, { description: detail });
    },
  });

  const activeType = REPORT_TYPES.find((item) => item.value === type)!;
  const invalidRange = Boolean(from && to && from > to);

  const submit = () => {
    generate.mutate({
      type,
      from,
      to,
      category: category === "all" ? undefined : category,
      supplierId: supplierId === "all" ? undefined : supplierId,
      format,
    });
  };

  const download = () => {
    if (!result) return;
    let blob: Blob;
    let filename = `${type}-${from}-to-${to}.json`;
    if (result.contentBase64 && result.filename) {
      // Real CSV or PDF file built by the backend.
      const bytes = Uint8Array.from(atob(result.contentBase64), (c) => c.charCodeAt(0));
      blob = new Blob([bytes], { type: result.mimeType ?? "application/octet-stream" });
      filename = result.filename;
    } else {
      blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Reports"
        description="Export the evidence behind the decisions: stock positions, movements, forecasts, approvals, supplier reliability and expiry exposure."
        actions={<DecisionChain active="action" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Build a report</CardTitle>
            <CardDescription>{activeType.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="report-type">Report type</Label>
                <Select value={type} onValueChange={(value) => setType(value as ReportType)}>
                  <SelectTrigger id="report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-format">Output format</Label>
                <Select value={format} onValueChange={(value) => setFormat(value as "csv" | "pdf")}>
                  <SelectTrigger id="report-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV spreadsheet</SelectItem>
                    <SelectItem value="pdf">PDF document</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-from">From</Label>
                <Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-to">To</Label>
                <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="report-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-supplier">Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="report-supplier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All suppliers</SelectItem>
                    {(suppliers.data ?? []).map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {invalidRange ? (
              <p className="text-sm text-destructive">The start date must fall before the end date.</p>
            ) : null}

            <Button onClick={submit} disabled={generate.isPending || invalidRange || !from || !to}>
              {generate.isPending ? "Generating…" : "Generate report"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest output</CardTitle>
            <CardDescription>Generated reports stay available until you build another one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="rounded-lg border bg-surface/60 p-4 text-sm">
                  <p className="font-medium text-foreground">{activeType.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    {formatNumber(result.rows)} rows · generated {formatDate(result.generatedAt, "dd MMM yyyy HH:mm")}
                  </p>
                </div>
                <Button variant="outline" className="w-full" onClick={download}>
                  <Download className="h-4 w-4" /> Download {format.toUpperCase()}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No report generated yet. Choose a type and period, then select Generate report.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
