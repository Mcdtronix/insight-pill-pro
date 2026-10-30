import { ChevronDown, Info } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Contribution, LabModelCard } from "@/api/labApi";
import { Pill } from "@/components/common/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Signed horizontal bars: how much each input pushed the prediction up or down. */
export function ContributionBars({
  baseline,
  baselineLabel,
  contributions,
  format,
  upClass = "bg-primary",
  downClass = "bg-muted-foreground/50",
}: {
  baseline: number;
  baselineLabel: string;
  contributions: Contribution[];
  format: (n: number) => string;
  upClass?: string;
  downClass?: string;
}) {
  const max = Math.max(...contributions.map((c) => Math.abs(c.contribution)), 1e-9);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{baselineLabel}</span>
        <span className="font-mono">{format(baseline)}</span>
      </div>
      {contributions.map((c) => {
        const width = `${(Math.abs(c.contribution) / max) * 50}%`;
        const up = c.contribution >= 0;
        return (
          <div
            key={c.feature}
            className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-2 text-xs"
          >
            <span className="truncate" title={c.label}>
              {c.label}
              {c.value !== null && c.value !== undefined ? (
                <span className="text-muted-foreground"> = {String(c.value)}</span>
              ) : null}
            </span>
            <div className="relative h-4 rounded bg-muted/50">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div
                className={cn("absolute inset-y-0.5 rounded", up ? upClass : downClass)}
                style={up ? { left: "50%", width } : { right: "50%", width }}
              />
            </div>
            <span
              className={cn(
                "text-right font-mono",
                up ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {up ? "+" : "−"}
              {format(Math.abs(c.contribution))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode | undefined;
  tone?: "good" | "bad" | undefined;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  step = "any",
  hint,
  error,
}: {
  id: string;
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  step?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className="h-9"
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const METRIC_LABELS: Record<string, string> = {
  MAE: "MAE",
  RMSE: "RMSE",
  MAPE: "MAPE %",
  precision: "Precision",
  recall: "Recall",
  f1: "F1",
  roc_auc: "ROC-AUC",
  pr_auc: "PR-AUC",
  silhouette_score_k3: "Silhouette (k=3)",
  adjusted_rand_index_vs_hierarchical: "Agreement with hierarchical (ARI)",
  mean_rank_correlation_under_weight_perturbation: "Rank stability (mean)",
  min_rank_correlation_under_weight_perturbation: "Rank stability (min)",
};

/** Model identity, how it was validated, and its known limitations. */
export function ModelCardPanel({ card }: { card: LabModelCard | undefined }) {
  const [open, setOpen] = useState(false);
  if (!card) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{card.name}</CardTitle>
            <CardDescription>{card.task}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="info">{card.version}</Pill>
            {card.trainedOn ? (
              <Pill>Trained {card.trainedOn}</Pill>
            ) : (
              <Pill tone="warning">Rule, not trained</Pill>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">Method: </span>
          {card.algorithm}
        </p>
        {Object.keys(card.testMetrics).length ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(card.testMetrics).map(([k, v]) => (
              <span key={k} className="rounded-md border bg-muted/40 px-2 py-1 text-xs">
                {METRIC_LABELS[k] ?? k}: <span className="font-mono font-medium">{v}</span>
              </span>
            ))}
            {card.testRows ? (
              <span className="px-1 py-1 text-xs text-muted-foreground">
                on {card.testRows} held-out rows
              </span>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-primary"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Hide" : "Show"} inputs and known limitations
        </button>
        {open ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold">Inputs ({card.features.length})</p>
              <p className="font-mono text-xs leading-relaxed text-muted-foreground">
                {card.features.join(", ")}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold">Known limitations</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {card.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ConfusionMatrix({
  tp,
  fp,
  fn,
  tn,
  positive,
  negative,
}: {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  positive: string;
  negative: string;
}) {
  const cell = "rounded-md p-3 text-center";
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5 text-xs">
      <span />
      <span className="text-center text-muted-foreground">Predicted {positive}</span>
      <span className="text-center text-muted-foreground">Predicted {negative}</span>
      <span className="self-center text-muted-foreground">Actual {positive}</span>
      <div className={cn(cell, "bg-success/15")}>
        <p className="text-lg font-semibold tabular-nums">{tp}</p>
        <p className="text-muted-foreground">caught</p>
      </div>
      <div className={cn(cell, "bg-destructive/12")}>
        <p className="text-lg font-semibold tabular-nums">{fn}</p>
        <p className="text-muted-foreground">missed</p>
      </div>
      <span className="self-center text-muted-foreground">Actual {negative}</span>
      <div className={cn(cell, "bg-warning/15")}>
        <p className="text-lg font-semibold tabular-nums">{fp}</p>
        <p className="text-muted-foreground">false alarm</p>
      </div>
      <div className={cn(cell, "bg-muted/60")}>
        <p className="text-lg font-semibold tabular-nums">{tn}</p>
        <p className="text-muted-foreground">correctly safe</p>
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
