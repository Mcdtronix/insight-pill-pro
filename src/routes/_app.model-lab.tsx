import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { describeError } from "@/api/client";
import {
  labApi,
  type DemandContext,
  type DemandInputs,
  type ExpiryInputs,
  type LabModelCard,
  type ReorderInputs,
  type SupplierInputs,
} from "@/api/labApi";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/components/common/States";
import { Pill } from "@/components/common/StatusBadge";
import {
  ConfusionMatrix,
  ContributionBars,
  MetricTile,
  ModelCardPanel,
  Note,
  NumberField,
} from "@/components/lab/LabShared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatNumber } from "@/utils/formatting";

export const Route = createFileRoute("/_app/model-lab")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Model Lab — Pharma DSS" },
      {
        name: "description",
        content: "Run, explain and test each decision model with your own inputs.",
      },
    ],
  }),
  component: ModelLabPage,
});

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const SEASONS = ["Rainy Season", "Dry/Cold Season", "Transition Season"];

function ModelLabPage() {
  const cards = useQuery({
    queryKey: ["lab", "models"],
    queryFn: labApi.models,
    enabled: !config.useMock,
  });
  const card = (key: string) => cards.data?.find((c) => c.key === key);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Model Lab"
        description="Give each decision model your own inputs, see what it predicts and why, then re-test it on data it never saw during training."
      />
      {config.useMock ? (
        <Note>
          The Model Lab runs the real models, so it needs the Django backend. Turn off mock mode
          (VITE_USE_MOCK).
        </Note>
      ) : cards.isError ? (
        <ErrorBlock error={cards.error} onRetry={() => cards.refetch()} />
      ) : (
        <Tabs defaultValue="demand" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="demand">1. Demand forecast</TabsTrigger>
            <TabsTrigger value="reorder">2. Stockout risk</TabsTrigger>
            <TabsTrigger value="supplier">3. Supplier score</TabsTrigger>
            <TabsTrigger value="expiry">4. Expiry risk</TabsTrigger>
          </TabsList>
          <TabsContent value="demand" className="space-y-4">
            <DemandPanel card={card("demand")} />
          </TabsContent>
          <TabsContent value="reorder" className="space-y-4">
            <ReorderPanel card={card("reorder")} />
          </TabsContent>
          <TabsContent value="supplier" className="space-y-4">
            <SupplierPanel card={card("supplier")} />
          </TabsContent>
          <TabsContent value="expiry" className="space-y-4">
            <ExpiryPanel card={card("expiry")} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ helpers
function useMedicines() {
  return useQuery({ queryKey: ["lab", "medicines"], queryFn: labApi.medicines, staleTime: 60_000 });
}

function MedicineSelect({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const meds = useMedicines();
  return (
    <div className="space-y-1">
      <Label className="text-xs">Medicine</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder="Choose a medicine" />
        </SelectTrigger>
        <SelectContent>
          {(meds.data ?? [])
            .slice()
            .sort((a, b) => a.modelId - b.modelId)
            .map((m) => (
              <SelectItem key={m.modelId} value={String(m.modelId)}>
                {m.name} {m.strength}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const { title, detail } = describeError(error);
  return (
    <p className="text-sm text-destructive">
      {title}: {detail}
    </p>
  );
}

function Presets({ items }: { items: { label: string; run: () => void }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Scenarios:</span>
      {items.map((p) => (
        <Button key={p.label} size="sm" variant="outline" className="h-7 text-xs" onClick={p.run}>
          <Sparkles className="h-3 w-3" /> {p.label}
        </Button>
      ))}
    </div>
  );
}

type FormState<T> = {
  [K in keyof T]: T[K] extends boolean ? boolean : T[K] extends number ? number | string : T[K];
};

function toNumbers<T extends object>(form: FormState<T>): T {
  const out: Record<string, unknown> = {};
  Object.entries(form).forEach(([k, v]) => {
    out[k] =
      typeof v === "string" &&
      v !== "" &&
      !Number.isNaN(Number(v)) &&
      k !== "date" &&
      k !== "season"
        ? Number(v)
        : v;
  });
  return out as T;
}

// =============================================================== 1. Demand
const DEMAND_PRESETS = [
  { label: "Coartem, rainy-season peak", medicineId: 6, date: "2024-11-28" },
  { label: "TLD (ARV), steady demand", medicineId: 8, date: "2024-12-20" },
  { label: "Paracetamol on a Sunday", medicineId: 1, date: "2024-12-15" },
  { label: "Coartem during a stockout", medicineId: 6, date: "2024-12-16" },
];

function DemandPanel({ card }: { card: LabModelCard | undefined }) {
  const [medicineId, setMedicineId] = useState(6);
  const [date, setDate] = useState("2024-11-28");
  const [form, setForm] = useState<FormState<DemandInputs> | null>(null);
  const [context, setContext] = useState<DemandContext | null>(null);

  const load = useMutation({
    mutationFn: ({ id, d }: { id: number; d: string }) => labApi.demandContext(id, d),
    onSuccess: (ctx) => {
      const inputs: DemandInputs = {
        medicineId: ctx.medicineId,
        date: ctx.date,
        season: ctx.season,
        isPublicHoliday: ctx.isPublicHoliday,
        lag1: ctx.lag1,
        lag7: ctx.lag7,
        lag14: ctx.lag14,
        lag30: ctx.lag30,
        rollingMean7: ctx.rollingMean7,
        rollingMean30: ctx.rollingMean30,
        rollingStd7: ctx.rollingStd7,
      };
      setContext(ctx);
      setForm(inputs);
      predict.mutate(inputs);
    },
  });
  const predict = useMutation({
    mutationFn: (inputs: DemandInputs) => labApi.demandPredict(inputs),
  });

  useEffect(() => {
    load.mutate({ id: 6, d: "2024-11-28" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runPreset = (p: (typeof DEMAND_PRESETS)[number]) => {
    setMedicineId(p.medicineId);
    setDate(p.date);
    load.mutate({ id: p.medicineId, d: p.date });
  };
  const set = (k: keyof DemandInputs) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const result = predict.data;

  return (
    <>
      <ModelCardPanel card={card} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>
              Pick a medicine and a day in 2024. The recent demand values load from history and you
              can edit any of them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Presets
              items={DEMAND_PRESETS.map((p) => ({ label: p.label, run: () => runPreset(p) }))}
            />
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <MedicineSelect value={medicineId} onChange={setMedicineId} />
              <div className="space-y-1">
                <Label htmlFor="d-date" className="text-xs">
                  Day to forecast
                </Label>
                <Input
                  id="d-date"
                  type="date"
                  min="2024-01-31"
                  max="2024-12-31"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <Button
                variant="secondary"
                className="h-9"
                onClick={() => load.mutate({ id: medicineId, d: date })}
                disabled={load.isPending}
              >
                <RotateCcw className="h-4 w-4" /> Load history
              </Button>
            </div>
            <ErrorText error={load.error} />
            {form ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Season</Label>
                    <Select
                      value={form.season}
                      onValueChange={(v) => setForm({ ...form, season: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEASONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Switch
                      id="d-hol"
                      checked={form.isPublicHoliday}
                      onCheckedChange={(v) => setForm({ ...form, isPublicHoliday: v })}
                    />
                    <Label htmlFor="d-hol" className="text-xs">
                      Public holiday
                    </Label>
                  </div>
                  <NumberField
                    id="d-l1"
                    label="Demand yesterday"
                    value={form.lag1}
                    onChange={set("lag1")}
                  />
                  <NumberField
                    id="d-l7"
                    label="Demand 7 days ago"
                    value={form.lag7}
                    onChange={set("lag7")}
                  />
                  <NumberField
                    id="d-l14"
                    label="Demand 14 days ago"
                    value={form.lag14}
                    onChange={set("lag14")}
                  />
                  <NumberField
                    id="d-l30"
                    label="Demand 30 days ago"
                    value={form.lag30}
                    onChange={set("lag30")}
                  />
                  <NumberField
                    id="d-r7"
                    label="7-day average"
                    value={form.rollingMean7}
                    onChange={set("rollingMean7")}
                  />
                  <NumberField
                    id="d-r30"
                    label="30-day average"
                    value={form.rollingMean30}
                    onChange={set("rollingMean30")}
                  />
                  <NumberField
                    id="d-s7"
                    label="7-day variability (std)"
                    value={form.rollingStd7}
                    onChange={set("rollingStd7")}
                  />
                </div>
                <Button
                  onClick={() => predict.mutate(toNumbers<DemandInputs>({ ...form, date }))}
                  disabled={predict.isPending}
                >
                  <Play className="h-4 w-4" />{" "}
                  {predict.isPending ? "Predicting…" : "Predict demand"}
                </Button>
                <ErrorText error={predict.error} />
              </>
            ) : load.isPending ? (
              <LoadingBlock rows={3} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prediction</CardTitle>
            <CardDescription>
              {context
                ? `${context.medicineName} on ${formatDate(date, "EEEE d MMM yyyy")}`
                : "Run the model to see a result."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <MetricTile
                    label="Predicted demand"
                    value={`${formatNumber(result.prediction)}`}
                    hint="units"
                  />
                  <MetricTile
                    label="Actual that day"
                    value={result.actual ?? "—"}
                    hint={result.actual !== null ? "units dispensed" : "not in data"}
                  />
                  <MetricTile
                    label="Absolute error"
                    value={result.error !== null ? formatNumber(result.error) : "—"}
                    hint="units"
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Why this number?</p>
                  <ContributionBars
                    baseline={result.baseline}
                    baselineLabel="Average prediction (starting point)"
                    contributions={result.contributions}
                    format={(n) => formatNumber(n, 1)}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Starting point plus every bar equals the prediction exactly (tree path
                    decomposition).
                  </p>
                </div>
              </>
            ) : (
              <Note>
                Change any input, for example double "Demand yesterday", then predict again to see
                how the model reacts.
              </Note>
            )}
          </CardContent>
        </Card>
      </div>
      <DemandEvaluation medicineId={medicineId} />
    </>
  );
}

function DemandEvaluation({ medicineId }: { medicineId: number }) {
  const [run, setRun] = useState(false);
  const ev = useQuery({
    queryKey: ["lab", "demand-eval", medicineId],
    queryFn: () => labApi.demandEvaluate(medicineId),
    enabled: run,
  });
  const points = (ev.data?.series.points ?? []).map((p) => ({
    ...p,
    label: formatDate(p.date, "dd MMM"),
  }));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Test performance on unseen data</CardTitle>
          <CardDescription>
            Re-scores the model on the final 15% of every medicine's history (11 Nov – 31 Dec 2024).
          </CardDescription>
        </div>
        <Button
          variant="secondary"
          onClick={() => (run ? ev.refetch() : setRun(true))}
          disabled={ev.isFetching}
        >
          <FlaskConical className="h-4 w-4" /> {ev.isFetching ? "Testing…" : "Run test"}
        </Button>
      </CardHeader>
      <CardContent>
        {ev.isError ? <ErrorBlock error={ev.error} /> : null}
        {ev.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <MetricTile
                label="MAE (model)"
                value={ev.data.metrics.MAE}
                hint="units per day"
                tone="good"
              />
              <MetricTile
                label="MAE (naive)"
                value={ev.data.baseline.MAE}
                hint="yesterday's demand"
              />
              <MetricTile
                label="Error reduction"
                value={`${ev.data.improvementPct}%`}
                hint="vs naive"
                tone="good"
              />
              <MetricTile label="RMSE" value={ev.data.metrics.RMSE} />
              <MetricTile
                label="MAPE"
                value={`${ev.data.metrics.MAPE}%`}
                hint={`${ev.data.testRows} test days`}
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                Actual vs predicted: {ev.data.series.medicineName}
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={6} />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      stroke="var(--color-muted-foreground)"
                      dot={false}
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      name="Predicted"
                      stroke="var(--color-primary)"
                      dot={false}
                      strokeWidth={2}
                    />
                    {points
                      .filter((p) => p.stockout)
                      .map((p) => (
                        <ReferenceDot
                          key={p.date}
                          x={p.label}
                          y={p.actual}
                          r={4}
                          fill="var(--color-destructive)"
                          stroke="none"
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">
                Red dots mark stockout days, where true demand was hidden because nothing could be
                issued.
              </p>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Error by medicine category</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">MAE</TableHead>
                    <TableHead className="text-right">Average demand</TableHead>
                    <TableHead className="text-right">Error share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ev.data.byCategory.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className="text-right font-mono">{c.mae}</TableCell>
                      <TableCell className="text-right font-mono">{c.avgDemand}</TableCell>
                      <TableCell className="text-right font-mono">
                        {pct(c.mae / c.avgDemand, 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : !ev.isFetching ? (
          <Note>
            Press "Run test" to reproduce the accuracy reported in the dissertation, live.
          </Note>
        ) : (
          <LoadingBlock rows={3} />
        )}
      </CardContent>
    </Card>
  );
}

// =========================================================== 2. Stockout
function ReorderPanel({ card }: { card: LabModelCard | undefined }) {
  const [medicineId, setMedicineId] = useState(6);
  const [form, setForm] = useState<FormState<ReorderInputs> | null>(null);
  const [meta, setMeta] = useState<{ name: string; asOf: string; supplier: string | null } | null>(
    null,
  );

  const predict = useMutation({
    mutationFn: (inputs: ReorderInputs) => labApi.reorderPredict(inputs),
  });
  const load = useMutation({
    mutationFn: (id: number) => labApi.reorderContext(id),
    onSuccess: (ctx) => {
      const next = {
        medicineId: ctx.medicineId,
        currentStock: ctx.currentStock,
        avgDailyDemand: ctx.avgDailyDemand,
        demandStdDev: ctx.demandStdDev,
        leadTimeDays: ctx.leadTimeDays,
        leadTimeVariability: ctx.leadTimeVariability,
        reorderAlreadyPlaced: ctx.reorderAlreadyPlaced,
      };
      setForm(next);
      setMeta({ name: ctx.medicineName, asOf: ctx.asOf, supplier: ctx.supplierName });
      predict.mutate(next);
    },
  });

  useEffect(() => {
    load.mutate(6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof ReorderInputs) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const whatIf = (change: (f: FormState<ReorderInputs>) => FormState<ReorderInputs>) => {
    if (!form) return;
    const next = change(form);
    setForm(next);
    predict.mutate(toNumbers<ReorderInputs>(next));
  };
  const result = predict.data;

  return (
    <>
      <ModelCardPanel card={card} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>
              Load a medicine's position on {meta?.asOf ? formatDate(meta.asOf) : "the demo date"}{" "}
              from the database, then try what-if changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Presets
              items={[
                {
                  label: "Coartem today",
                  run: () => {
                    setMedicineId(6);
                    load.mutate(6);
                  },
                },
                {
                  label: "Ciprofloxacin (out of stock)",
                  run: () => {
                    setMedicineId(4);
                    load.mutate(4);
                  },
                },
                {
                  label: "TLD (well stocked)",
                  run: () => {
                    setMedicineId(8);
                    load.mutate(8);
                  },
                },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <MedicineSelect value={medicineId} onChange={setMedicineId} />
              <Button
                variant="secondary"
                className="h-9"
                onClick={() => load.mutate(medicineId)}
                disabled={load.isPending}
              >
                <RotateCcw className="h-4 w-4" /> Load position
              </Button>
            </div>
            <ErrorText error={load.error} />
            {form ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField
                    id="r-stock"
                    label="Current stock (units)"
                    value={form.currentStock}
                    onChange={set("currentStock")}
                    step="1"
                  />
                  <NumberField
                    id="r-dem"
                    label="Average daily demand"
                    value={form.avgDailyDemand}
                    onChange={set("avgDailyDemand")}
                    hint="last 30 days"
                  />
                  <NumberField
                    id="r-std"
                    label="Demand variability (std)"
                    value={form.demandStdDev}
                    onChange={set("demandStdDev")}
                  />
                  <NumberField
                    id="r-lead"
                    label="Supplier lead time (days)"
                    value={form.leadTimeDays}
                    onChange={set("leadTimeDays")}
                    step="1"
                    hint={meta?.supplier ? `fastest offer: ${meta.supplier}` : undefined}
                  />
                  <NumberField
                    id="r-lvar"
                    label="Lead time variability (days)"
                    value={form.leadTimeVariability}
                    onChange={set("leadTimeVariability")}
                  />
                  <div className="flex items-center gap-2 pt-5">
                    <Switch
                      id="r-placed"
                      checked={form.reorderAlreadyPlaced}
                      onCheckedChange={(v) => setForm({ ...form, reorderAlreadyPlaced: v })}
                    />
                    <Label htmlFor="r-placed" className="text-xs">
                      An order is already on the way
                    </Label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => predict.mutate(toNumbers<ReorderInputs>(form))}
                    disabled={predict.isPending}
                  >
                    <Play className="h-4 w-4" /> {predict.isPending ? "Scoring…" : "Predict risk"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      whatIf((f) => ({
                        ...f,
                        currentStock: Math.max(0, Number(f.currentStock) - 2000),
                      }))
                    }
                  >
                    Dispense 2,000 units
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      whatIf((f) => ({ ...f, leadTimeDays: Number(f.leadTimeDays) + 10 }))
                    }
                  >
                    Supplier 10 days slower
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      whatIf((f) => ({ ...f, currentStock: Number(f.currentStock) + 5000 }))
                    }
                  >
                    Receive 5,000 units
                  </Button>
                </div>
                <ErrorText error={predict.error} />
              </>
            ) : load.isPending ? (
              <LoadingBlock rows={3} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prediction</CardTitle>
            <CardDescription>{meta?.name ?? "Run the model to see a result."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-3xl font-semibold tabular-nums">{pct(result.probability)}</p>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      chance of stocking out before the next delivery
                    </p>
                    {result.alert ? (
                      <Pill tone="danger">Alert: reorder now ({result.riskLevel} risk)</Pill>
                    ) : (
                      <Pill tone="success">No alert (low risk)</Pill>
                    )}
                  </div>
                </div>
                <div className="relative h-3 rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-3 rounded-full",
                      result.alert ? "bg-destructive" : "bg-success",
                    )}
                    style={{ width: `${Math.max(1, result.probability * 100)}%` }}
                  />
                  <div
                    className="absolute -top-1 h-5 w-0.5 bg-foreground"
                    style={{ left: `${result.threshold * 100}%` }}
                    title={`Alert threshold ${pct(result.threshold)}`}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The black mark is the alert threshold ({pct(result.threshold)}). It was set so the
                  model catches at least 80% of real stockouts.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MetricTile
                    label="Days of stock left"
                    value={formatNumber(result.daysOfStockLeft, 1)}
                  />
                  <MetricTile
                    label="Stock days minus lead time"
                    value={formatNumber(result.leadTimeMargin, 1)}
                    tone={result.leadTimeMargin < 0 ? "bad" : "good"}
                    hint={
                      result.leadTimeMargin < 0
                        ? "stock runs out before delivery"
                        : "stock outlasts delivery"
                    }
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Why this risk?</p>
                  <ContributionBars
                    baseline={result.baseline}
                    baselineLabel="Average risk (starting point)"
                    contributions={result.contributions}
                    format={(n) => pct(n)}
                    upClass="bg-destructive/80"
                    downClass="bg-success/70"
                  />
                </div>
              </>
            ) : (
              <Note>Load a medicine to score its current stock position.</Note>
            )}
          </CardContent>
        </Card>
      </div>
      <ReorderEvaluation defaultThreshold={card?.threshold ?? 0.125} />
    </>
  );
}

function ReorderEvaluation({ defaultThreshold }: { defaultThreshold: number }) {
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [applied, setApplied] = useState<number | null>(null);
  const ev = useQuery({
    queryKey: ["lab", "reorder-eval", applied],
    queryFn: () => labApi.reorderEvaluate(applied ?? undefined),
    enabled: applied !== null,
  });
  useEffect(() => setThreshold(defaultThreshold), [defaultThreshold]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Test performance on unseen data</CardTitle>
        <CardDescription>
          The latest 900 risk checks (18 Oct – 12 Dec 2024). Move the threshold to see the trade-off
          between missed stockouts and false alarms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-64 space-y-1">
            <Label className="text-xs">Alert threshold: {pct(threshold)}</Label>
            <Slider
              min={0.02}
              max={0.9}
              step={0.005}
              value={[threshold]}
              onValueChange={(v) => setThreshold(v[0] ?? threshold)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => setApplied(threshold)}
            disabled={ev.isFetching}
          >
            <FlaskConical className="h-4 w-4" /> {ev.isFetching ? "Testing…" : "Run test"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setThreshold(defaultThreshold);
              setApplied(defaultThreshold);
            }}
          >
            Reset to deployed threshold
          </Button>
        </div>
        {ev.isError ? <ErrorBlock error={ev.error} /> : null}
        {ev.data ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <MetricTile
                  label="Recall"
                  value={pct(ev.data.metrics.recall)}
                  hint="real stockouts caught"
                  tone="good"
                />
                <MetricTile
                  label="Precision"
                  value={pct(ev.data.metrics.precision)}
                  hint="alerts that were real"
                />
                <MetricTile label="F1" value={ev.data.metrics.f1} />
                <MetricTile
                  label="PR-AUC"
                  value={ev.data.metrics.prAuc}
                  hint={`baseline ${ev.data.baseline.prAuc}`}
                  tone="good"
                />
                <MetricTile label="ROC-AUC" value={ev.data.metrics.rocAuc} />
                <MetricTile
                  label="Stockouts in test"
                  value={ev.data.positives}
                  hint={`of ${ev.data.testRows} checks`}
                />
              </div>
              <ConfusionMatrix {...ev.data.confusion} positive="stockout" negative="safe" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Stockouts caught by category</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Stockouts</TableHead>
                    <TableHead className="text-right">Caught</TableHead>
                    <TableHead className="text-right">Recall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ev.data.byCategory
                    .filter((c) => c.stockouts > 0)
                    .map((c) => (
                      <TableRow key={c.category}>
                        <TableCell>{c.category}</TableCell>
                        <TableCell className="text-right font-mono">{c.stockouts}</TableCell>
                        <TableCell className="text-right font-mono">{c.caught}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono",
                            c.recall === 0 && "text-destructive",
                          )}
                        >
                          {c.recall === null ? "—" : pct(c.recall, 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">
                Categories with no stockouts in the test period are hidden. A 0% row is a known
                blind spot.
              </p>
            </div>
          </div>
        ) : !ev.isFetching ? (
          <Note>Press "Run test" to reproduce the reported precision, recall and PR-AUC.</Note>
        ) : (
          <LoadingBlock rows={3} />
        )}
      </CardContent>
    </Card>
  );
}

// =========================================================== 3. Supplier
const BLANK_SUPPLIER: FormState<SupplierInputs> = {
  onTimeRate: 0.2,
  fulfillmentRate: 0.85,
  priceVariancePct: -3,
  defectRate: 0.015,
  orders: 200,
};

function SupplierPanel({ card }: { card: LabModelCard | undefined }) {
  const [form, setForm] = useState<FormState<SupplierInputs>>(BLANK_SUPPLIER);
  const ev = useQuery({ queryKey: ["lab", "supplier-eval"], queryFn: labApi.supplierEvaluate });
  const predict = useMutation({
    mutationFn: (inputs: SupplierInputs) => labApi.supplierPredict(inputs),
  });
  const set = (k: keyof SupplierInputs) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const startFrom = (name: string) => {
    const s = ev.data?.suppliers.find((x) => x.name === name);
    if (!s) return;
    const next = {
      onTimeRate: s.onTimeRate,
      fulfillmentRate: s.fulfillmentRate,
      priceVariancePct: s.priceVariancePct,
      defectRate: s.defectRate,
      orders: s.orders,
    };
    setForm(next);
    predict.mutate(next);
  };
  const result = predict.data;
  const ranked = useMemo(() => {
    if (!result) return [];
    const rows = [
      ...result.scorecard,
      {
        name: "Your candidate",
        score: result.score,
        tier: result.tier,
        orders: Number(form.orders),
        lowConfidence: result.lowConfidence,
      },
    ];
    return rows.sort((a, b) => b.score - a.score);
  }, [result, form.orders]);

  return (
    <>
      <ModelCardPanel card={card} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>
              Describe a supplier's track record, or start from one of the 12 existing suppliers and
              change it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Start from an existing supplier</Label>
              <Select onValueChange={startFrom}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={ev.isLoading ? "Loading…" : "Choose a supplier"} />
                </SelectTrigger>
                <SelectContent>
                  {(ev.data?.suppliers ?? []).map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                id="s-ot"
                label="On-time delivery rate (0–1)"
                value={form.onTimeRate}
                onChange={set("onTimeRate")}
                hint="share delivered on or before the promised date"
              />
              <NumberField
                id="s-ful"
                label="Order fulfilment rate (0–1)"
                value={form.fulfillmentRate}
                onChange={set("fulfillmentRate")}
                hint="share of ordered units delivered"
              />
              <NumberField
                id="s-pv"
                label="Price vs market (%)"
                value={form.priceVariancePct}
                onChange={set("priceVariancePct")}
                hint="negative = cheaper than market"
              />
              <NumberField
                id="s-def"
                label="Defect rate (0–1)"
                value={form.defectRate}
                onChange={set("defectRate")}
                hint="share of units rejected"
              />
              <NumberField
                id="s-n"
                label="Number of orders observed"
                value={form.orders}
                onChange={set("orders")}
                step="1"
                hint="under 150 = low confidence"
              />
            </div>
            <Button
              onClick={() => predict.mutate(toNumbers<SupplierInputs>(form))}
              disabled={predict.isPending}
            >
              <Play className="h-4 w-4" /> {predict.isPending ? "Scoring…" : "Score supplier"}
            </Button>
            <ErrorText error={predict.error} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>
              Weighted score (0 = worst observed, 1 = best observed) and K-Means tier.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <MetricTile label="Score" value={result.score.toFixed(3)} />
                  <MetricTile
                    label="Tier"
                    value={result.tier}
                    tone={
                      result.tier === "At-Risk"
                        ? "bad"
                        : result.tier === "Preferred"
                          ? "good"
                          : undefined
                    }
                  />
                  <MetricTile label="Rank" value={`${result.rank} of ${result.of}`} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {result.lowConfidence ? (
                    <Pill tone="warning">Low confidence: under 150 orders</Pill>
                  ) : null}
                  {result.outsideTrainingRange ? (
                    <Pill tone="info">Outside the range seen in training; score capped at 0–1</Pill>
                  ) : null}
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Score breakdown (weights 35 / 30 / 20 / 15)
                  </p>
                  <ContributionBars
                    baseline={0}
                    baselineLabel="Starting point"
                    contributions={result.contributions}
                    format={(n) => n.toFixed(3)}
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((r, i) => (
                      <TableRow
                        key={r.name}
                        className={cn(r.name === "Your candidate" && "bg-primary/10 font-medium")}
                      >
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>
                          {r.name}
                          {r.lowConfidence ? " *" : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono">{r.score.toFixed(3)}</TableCell>
                        <TableCell>
                          <TierPill tier={r.tier} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  * fewer than 150 orders. Tiers come from clustering all four measures, so a tier
                  can differ from score order.
                </p>
              </>
            ) : (
              <Note>Score a supplier to see where it would rank among the current 12.</Note>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Validation</CardTitle>
          <CardDescription>
            There is no "correct" supplier ranking to test against, so the model is checked for
            consistency and stability instead. Below, every score is recomputed live from the{" "}
            {ev.data ? formatNumber(ev.data.orders) : "6,000"} raw orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ev.isError ? <ErrorBlock error={ev.error} onRetry={() => ev.refetch()} /> : null}
          {ev.data ? (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricTile
                  label="Matches exported model"
                  value={ev.data.reproduced ? "Yes, all 12" : "No"}
                  tone={ev.data.reproduced ? "good" : "bad"}
                />
                <MetricTile
                  label="Agreement with hierarchical clustering"
                  value={ev.data.validation["adjusted_rand_index_vs_hierarchical"]}
                  hint="ARI, 1 = identical"
                />
                <MetricTile
                  label="Ranking stability"
                  value={ev.data.validation["mean_rank_correlation_under_weight_perturbation"]}
                  hint="weights changed ±30%"
                />
                <MetricTile
                  label="Silhouette (k=3)"
                  value={ev.data.validation["silhouette_score_k3"]}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Fulfilment</TableHead>
                    <TableHead className="text-right">Price vs market</TableHead>
                    <TableHead className="text-right">Defects</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Tier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ev.data.suppliers.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell>
                        {s.name}
                        {s.lowConfidence ? " *" : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono">{s.orders}</TableCell>
                      <TableCell className="text-right font-mono">{pct(s.onTimeRate)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {pct(s.fulfillmentRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{s.priceVariancePct}%</TableCell>
                      <TableCell className="text-right font-mono">{pct(s.defectRate, 2)}</TableCell>
                      <TableCell className="text-right font-mono">{s.score.toFixed(3)}</TableCell>
                      <TableCell>
                        <TierPill tier={s.tier} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Note>
                Supplier performance figures come from the simulated dataset. They are not real
                judgements of these companies.
              </Note>
            </>
          ) : (
            <LoadingBlock rows={4} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TierPill({ tier }: { tier: string }) {
  return (
    <Pill tone={tier === "Preferred" ? "success" : tier === "At-Risk" ? "danger" : "warning"}>
      {tier}
    </Pill>
  );
}

// ============================================================= 4. Expiry
function ExpiryPanel({ card }: { card: LabModelCard | undefined }) {
  const batches = useQuery({ queryKey: ["lab", "expiry-context"], queryFn: labApi.expiryContext });
  const [form, setForm] = useState<FormState<ExpiryInputs>>({
    batchStock: 3000,
    daysToExpiry: 60,
    monthlyConsumption: 900,
    unitCost: 0.35,
  });
  const [label, setLabel] = useState<string>("Custom batch");
  const predict = useMutation({
    mutationFn: (inputs: ExpiryInputs) => labApi.expiryPredict(inputs),
  });
  const ev = useQuery({
    queryKey: ["lab", "expiry-eval"],
    queryFn: labApi.expiryEvaluate,
    enabled: false,
  });
  const set = (k: keyof ExpiryInputs) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pick = (id: string) => {
    const b = batches.data?.find((x) => String(x.batchId) === id);
    if (!b) return;
    const next = {
      batchStock: b.batchStock,
      daysToExpiry: b.daysToExpiry,
      monthlyConsumption: b.monthlyConsumption,
      unitCost: b.unitCost,
    };
    setForm(next);
    setLabel(`${b.medicineName}, batch ${b.batchNumber}`);
    predict.mutate(next);
  };
  const result = predict.data;
  const days = Number(form.daysToExpiry);

  return (
    <>
      <ModelCardPanel card={card} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>
              Pick a batch in stock (earliest expiry first) or enter your own figures.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Batch in stock</Label>
              <Select onValueChange={pick}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={batches.isLoading ? "Loading…" : "Choose a batch"} />
                </SelectTrigger>
                <SelectContent>
                  {(batches.data ?? []).map((b) => (
                    <SelectItem key={b.batchId} value={String(b.batchId)}>
                      {b.medicineName} · {b.batchNumber} · {b.daysToExpiry} days left
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                id="e-stock"
                label="Units left in the batch"
                value={form.batchStock}
                onChange={set("batchStock")}
                step="1"
              />
              <NumberField
                id="e-days"
                label="Days until expiry"
                value={form.daysToExpiry}
                onChange={set("daysToExpiry")}
                step="1"
              />
              <NumberField
                id="e-use"
                label="Units used per month"
                value={form.monthlyConsumption}
                onChange={set("monthlyConsumption")}
                hint="whole medicine, last 30 days"
              />
              <NumberField
                id="e-cost"
                label="Unit cost (USD)"
                value={form.unitCost}
                onChange={set("unitCost")}
              />
            </div>
            <Button
              onClick={() => {
                setLabel("Custom batch");
                predict.mutate(toNumbers<ExpiryInputs>(form));
              }}
              disabled={predict.isPending}
            >
              <Play className="h-4 w-4" /> Check expiry risk
            </Button>
            <ErrorText error={predict.error} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>{label}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {result.atRisk ? (
                    <Pill tone="danger">At risk ({result.riskLevel})</Pill>
                  ) : (
                    <Pill tone="success">Will be used before expiry</Pill>
                  )}
                  <span className="text-sm text-muted-foreground">{result.explanation}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MetricTile
                    label="Units likely to expire"
                    value={formatNumber(result.unusedUnits)}
                    hint={pct(result.unusedShare, 0) + " of batch"}
                    tone={result.atRisk ? "bad" : "good"}
                  />
                  <MetricTile label="Value at risk" value={formatCurrency(result.valueAtRisk)} />
                  <MetricTile
                    label="Monthly use needed"
                    value={
                      result.monthlyUseNeeded !== null ? formatNumber(result.monthlyUseNeeded) : "—"
                    }
                    hint="to clear it in time"
                  />
                </div>
                {result.daysToDeplete !== null && days > 0 ? (
                  <div className="space-y-1 text-xs">
                    <TimelineBar
                      label="Days until the batch is used up"
                      value={result.daysToDeplete}
                      max={Math.max(result.daysToDeplete, days)}
                      className={result.atRisk ? "bg-destructive/70" : "bg-success/70"}
                    />
                    <TimelineBar
                      label="Days until it expires"
                      value={days}
                      max={Math.max(result.daysToDeplete, days)}
                      className="bg-muted-foreground/60"
                    />
                  </div>
                ) : null}
                {result.atRisk ? (
                  <Note>
                    Suggested action: dispense this batch first (FEFO), move stock to a busier site,
                    or reduce the next order.
                  </Note>
                ) : null}
              </>
            ) : (
              <Note>Choose a batch to check whether it will be used before it expires.</Note>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Test performance</CardTitle>
            <CardDescription>
              Checks the rule against all 6,000 labelled batches. The rule has no trained
              parameters, so every row is a fair test.
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={() => ev.refetch()} disabled={ev.isFetching}>
            <FlaskConical className="h-4 w-4" /> {ev.isFetching ? "Testing…" : "Run test"}
          </Button>
        </CardHeader>
        <CardContent>
          {ev.isError ? <ErrorBlock error={ev.error} /> : null}
          {ev.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid grid-cols-2 gap-2">
                <MetricTile label="Accuracy" value={pct(ev.data.metrics.accuracy, 2)} tone="good" />
                <MetricTile
                  label="Recall"
                  value={pct(ev.data.metrics.recall)}
                  hint="at-risk batches caught"
                />
                <MetricTile label="Precision" value={pct(ev.data.metrics.precision)} />
                <MetricTile label="F1" value={ev.data.metrics.f1} />
              </div>
              <ConfusionMatrix {...ev.data.confusion} positive="at risk" negative="safe" />
            </div>
          ) : !ev.isFetching ? (
            <Note>Press "Run test" to check the rule against the labelled batch data.</Note>
          ) : (
            <LoadingBlock rows={2} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TimelineBar({
  label,
  value,
  max,
  className,
}: {
  label: string;
  value: number;
  max: number;
  className: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{formatNumber(value)}</span>
      </div>
      <div className="h-2.5 rounded bg-muted">
        <div
          className={cn("h-2.5 rounded", className)}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
